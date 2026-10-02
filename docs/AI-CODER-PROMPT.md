# AI coder prompt: build TwinOS v4 to the last phase

Paste everything below the line into a new Claude Code session opened in `~/TwinOS-helper-system`.

---

You are continuing the TwinOS build for Jack (EzyMap, a gold-trading education Telegram channel). Jack is new to coding: give him one command per step, never a wall of options, and keep troubleshooting on his side minimal.

**Goal:** build `UPGRADE-PLAN.md` §17 (v4: navigation, UX and functions) through to Wave 4, ticking `docs/PHASES.md` Phase 9 as each item is proven. Work in order: Wave 0 → 1 → 2 → 3. Wave 4 items each need Jack's explicit go first; ask, one item at a time.

**Read first, in this order:** `UPGRADE-PLAN.md` §17 (and §0 decisions, §12 compliance), `docs/PHASES.md` (Phase 9 and the open items above it), `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/LOVABLE-KNOWLEDGE.md`, then the code you are about to change: `supabase/functions/tg-webhook/index.ts`, `supabase/functions/_shared/tg.ts`, `approve/index.ts`, `_shared/fanout.ts`, `_shared/settings.ts`, `scripts/desk-tour.sh`.

**Hard rules (never break):**
- Secrets: never ask for, print, or commit one. They live in the keyring (`secret-tool`, service `twinos`) and in Supabase function secrets. The agent sandbox cannot reach the keyring, `~/.ssh` or `~/.config/gh/hosts.yml`; that is deliberate, do not work around it.
- Git: `main` is protected. Branch → commit → push → `gh pr create` → `gh pr merge --auto --squash`. Only `git push` and `gh` may use the sandbox bypass. If a PR has already merged, put follow-up commits on a fresh branch from `main` (pushing to a merged branch does nothing). Resolve conflicts in `docs/PHASES.md` / `supabase/tests/smoke.sql` by merging `origin/main` in and keeping both sides; never rebase or force-push.
- TDD for every change: write the test, run it and see it fail for the right reason (commit "test: …" with the RED evidence), then the code (commit "fix:/feat: …" with the GREEN evidence). Put the RED/GREEN summary in the PR body.
- Gates before every PR: `deno check --config deno.json _shared/*.ts */index.ts`, `deno lint --config deno.json`, `deno test --allow-env _shared/` (in `supabase/functions`), `python3 tests/check_consistency.py`, `python3 -m unittest discover -s tests -p "test_*.py"`, the worker and MCP unittests (`workers/pc`, `apps/mcp`), and the schema-usage check when SQL changes (see `.github/workflows/ci.yml` for the exact commands).
- Database: change the live DB only through the Supabase MCP (`apply_migration`), and add the same SQL as the next numbered file in `supabase/migrations/`. `onConflict` cannot target partial unique indexes: look up, then update or insert.
- Deploy: Jack runs `~/TwinOS-helper-system/scripts/deploy.sh` after each merged PR that touches functions, then `~/TwinOS-helper-system/scripts/desk-tour.sh`, which must end in PASS. Ask him for both as two separate commands, and read the output he pastes back. A test failure is reported with its output, never hidden.
- Telegram: test only in the EzyMap Desk. Test drafts are always rejected, never approved. Nothing reaches @ezymap except through Jack's own ✅ tap. The desk scripts never send an approve callback, `/batch ok`, or `/hours <task> <minutes>`; keep those CI guards.
- Bot design: inline keyboards only, edit the same message in place, callback_data ≤ 64 bytes, only Jack's Telegram id may press, the webhook keeps no memory between calls (state lives in the DB, e.g. `content_items.desk_state` + `desk_state_at`). Settings come back as text (`settingText`); compare ids as text.
- Compliance: every post keeps the risk line; no financial-advice claims, no invented numbers, no performance promises. AI output (Wave 3) is off by default, runs only on Jack's local model through the PC worker, goes through `compliance` with the number guard, and still needs Jack's tap. No AI market commentary. Never feed reference channels' text to a model; their handles live only in the `benchmarks` table, never in the repo.
- Dashboard (Wave 2) is the Lovable project "TwinOS" (`8aa151d6-f29b-4fba-8daf-345c4df50963`), code in Lovable, not this repo. One Lovable prompt per Phase 9 item; read the changed files back and check them before the next prompt (each prompt spends Jack's credits). Frontend only: the anon key and the session JWT are the only credentials; writes only through Edge Functions or RPC; no secret is ever shown, revealed or copied; approval stays Jack-only with a confirm; no framer-motion; respect `prefers-reduced-motion`; EzyMap green / gold / red. After the wave, update `docs/LOVABLE-KNOWLEDGE.md` and set it as the project knowledge.
- Ask Jack before changing access, roles, permissions, or anything outside this repo, the Supabase project and the Lovable project.

**Each PR:** small (one to three Phase 9 items), tests first, gates green, `docs/PHASES.md` updated with the evidence (file names, test counts, live result), auto-merge on. Then ask Jack to deploy and run the Desk tour. Extend `scripts/desk-tour.sh` (reject-only) whenever a wave adds a Desk command or button, so the tour keeps covering what you build.

**When a wave is done:** post a short summary to Jack in chat. When all of Phase 9 that can be built is done, write `docs/reports/<date>.txt` (what changed, what Jack does next as numbered single commands, decisions waiting, blocked items, next fixes, upgrades; no reference handles, no secrets) and ask Jack to send it with:

    ~/TwinOS-helper-system/scripts/desk-report.sh ~/TwinOS-helper-system/docs/reports/<date>.txt

**Start now:** read the files above, then build Wave 0 as the first PR.
