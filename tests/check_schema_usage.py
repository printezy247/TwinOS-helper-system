#!/usr/bin/env python3
"""Every table, view, column, RPC and ON CONFLICT target the Edge Functions use
must exist in the schema the migrations build.

The functions talk to Postgres through supabase-js, so a wrong column name is a
runtime error that `deno check` cannot see. This reads the code, reads the real
schema (JSON from tests/schema_dump.sql) and reports every mismatch.

    python3 tests/check_schema_usage.py schema.json
"""
import glob, json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "supabase", "functions")
schema = json.load(open(sys.argv[1]))
TABLES, FNS = schema["tables"], set(schema["fns"] or [])
UNIQUE = {}
for u in schema["unique"] or []:
    UNIQUE.setdefault(u["t"], []).append(frozenset(u["cols"]))


def chain_end(s, i):
    """End of one query chain: the next top-level `;` or `,`, or an unmatched `)`/`]`."""
    depth, quote, j = 0, None, i
    while j < len(s):
        c = s[j]
        if quote:
            if c == "\\":
                j += 2
                continue
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth < 0:
                return j
        elif c in ";," and depth <= 0:
            return j
        j += 1
    return j


def object_keys(s, start):
    """Top-level keys of the object literal starting at s[start] == '{'."""
    depth, quote, cur, parts, i = 0, None, "", [], start
    while i < len(s):
        c = s[i]
        if quote:
            cur += c
            if c == "\\":
                cur += s[i + 1]
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
            cur += c
        elif c in "([{":
            depth += 1
            if depth > 1:
                cur += c
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                parts.append(cur)
                break
            cur += c
        elif c == "," and depth == 1:
            parts.append(cur)
            cur = ""
        elif depth >= 1:
            cur += c
        i += 1
    keys = []
    for part in parts:
        part = part.strip()
        if part and not part.startswith("..."):
            m = re.match(r"""^["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*(:|$)""", part)
            if m:
                keys.append(m.group(1))
    return keys


problems = set()
for path in sorted(glob.glob(ROOT + "/**/*.ts", recursive=True)):
    if path.endswith("_test.ts"):
        continue
    src, rel = open(path).read(), os.path.relpath(path, ROOT)
    for m in re.finditer(r"""\.from\(\s*["']([a-z_0-9]+)["']\s*\)""", src):
        table = m.group(1)
        chain = src[m.start():chain_end(src, m.end())]
        line = src.count("\n", 0, m.start()) + 1
        if table not in TABLES:
            problems.add((rel, line, table, "table or view does not exist"))
            continue
        cols = TABLES[table]

        def need(col, why):
            if col not in cols:
                problems.add((rel, line, table, f"no column {col!r} ({why})"))

        for sm in re.finditer(r"""\.select\(\s*["'`]([^"'`]*)["'`]""", chain):
            depth, tok, toks = 0, "", []
            for c in sm.group(1):
                depth += (c == "(") - (c == ")")
                if c == "," and depth == 0:
                    toks.append(tok)
                    tok = ""
                else:
                    tok += c
            toks.append(tok)
            for t in (x.strip() for x in toks):
                if t and t != "*" and "(" not in t:
                    need(t.split(":")[-1].strip(), "select")
        for fm in re.finditer(r"""\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|overlaps|order|not)\(\s*["']([A-Za-z_0-9]+)["']""", chain):
            need(fm.group(2), fm.group(1))
        for om in re.finditer(r"\.(insert|update|upsert)\(\s*(\[\s*)?\{", chain):
            for key in object_keys(chain, chain.index("{", om.start())):
                need(key, om.group(1))
        for oc in re.finditer(r"""onConflict:\s*["']([^"']+)["']""", chain):
            target = frozenset(c.strip() for c in oc.group(1).split(","))
            if not any(target == u for u in UNIQUE.get(table, [])):
                problems.add((rel, line, table, f"ON CONFLICT ({oc.group(1)}) matches no non-partial unique index"))
    for m in re.finditer(r"""\.rpc\(\s*["']([a-z_0-9]+)["']""", src):
        if m.group(1) not in FNS:
            problems.add((rel, src.count("\n", 0, m.start()) + 1, "rpc", f"function {m.group(1)} does not exist"))

for p in sorted(problems):
    print("%-26s line %-4d %-18s %s" % p)
print(f"schema usage: {len(problems)} problem(s)")
sys.exit(1 if problems else 0)
