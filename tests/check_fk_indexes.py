#!/usr/bin/env python3
"""Every foreign key must have an index whose leading column is its first column.

    python3 tests/check_fk_indexes.py fks.json     # dump from tests/fk_dump.sql

Why this exists: an unindexed FK makes a cascade delete scan the whole child
table, and makes the join every screen does (`signal_posts` by `variant_id`,
`inbox_items` by `variant_id`, …) a sequential scan the planner cannot avoid.
Twenty of them shipped that way because nothing looked.

Two ways to make this pass:

  1. create the index — `create index if not exists idx_<table>_<column>
     on public.<table> (<column>);`
  2. add the constraint to ALLOW, with a one-line reason

ALLOW is deliberate. A skip nobody wrote down is a skip that survives forever,
so the list is short, explicit, and every entry names why. Today it is empty:
each of the twenty is a join or cascade path that grows with the product.
"""
import json
import sys

# conname -> reason. Keep this empty unless an FK genuinely does not need an
# index; a lookup table that will never carry more than a hundred rows is the
# only shape that qualifies.
ALLOW = {}


def main(path: str) -> int:
    try:
        schema = json.load(open(path))
    except (OSError, ValueError) as err:
        print(f"cannot read the schema dump {path}: {err}")
        return 2

    fks = schema.get("fks") or []
    indexes = schema.get("indexes") or []

    # table -> set of leading column names that some index covers
    leading = {}
    for index in indexes:
        cols = index.get("cols") or []
        if cols:
            leading.setdefault(index["t"], set()).add(cols[0])

    offenders, allowed = [], []
    for fk in fks:
        cols = fk.get("cols") or []
        if not cols:
            continue  # an expression FK cannot be matched by name; not ours to judge
        if cols[0] in leading.get(fk["t"], set()):
            continue
        entry = (fk["t"], fk["name"], ", ".join(cols))
        if fk["name"] in ALLOW:
            allowed.append(entry)
        else:
            offenders.append(entry)

    print(f"{len(fks)} foreign keys, {len(fks) - len(offenders) - len(allowed)} indexed, "
          f"{len(allowed)} allowed without one, {len(offenders)} without a leading index")

    for table, name, cols in sorted(allowed):
        print(f"  allowed  {table}.{name} ({cols}) — {ALLOW[name]}")

    if offenders:
        print("\nThese need `create index if not exists idx_<table>_<column> on public.<table> (<column>);`")
        print("or an ALLOW entry with a reason:\n")
        for table, name, cols in sorted(offenders):
            print(f"  MISSING  {table}.{name} ({cols})")
        return 1

    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
