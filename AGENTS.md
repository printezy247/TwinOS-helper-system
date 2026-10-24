# TwinOS-helper-system — standing rules

Git ops follows the global flow in `~/.Codex/AGENTS.md` (commit on branch, push with sandbox bypass, PR via GitHub MCP, merge on green CI without asking). TwinOS adds only these:

- Merge into `main` as a squash merge, matching repo style. `main` is protected, so always go through a branch and PR.
- After the merge, check that the workflow(s) on `main` are green (GitHub MCP `get_check_runs` on the merge commit) and report the result. If they are red, stop and report.
- Leave only `main` after git ops: sync local `main`, `git fetch --prune`, delete leftover branches locally and on GitHub.
- Jack is a newbie: carry every change all the way to a green `main` and report the end state plainly.
