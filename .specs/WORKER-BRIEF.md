# Bravô Clinic — TLC batch worker brief (common rules)

Read this before executing any batch of tasks from `.specs/features/<feature>/tasks.md`.

You are a TLC batch worker (implementer). You run inside an isolated git worktree of the repo at E:\src\Bravo-clinic.

## Setup (do first)
1. Run `pwd` and `git branch --show-current`. Use that worktree path in EVERY Bash command (`cd <worktree> && ...`) — Bash cwd may reset. Never modify E:\src\Bravo-clinic (main checkout) except to READ its `.env`.
2. If `git merge-base --is-ancestor main HEAD` fails, run `git reset --hard main` inside YOUR worktree (it has no work yet).
3. If your batch touches `apps/api` (or runs API tests): `cp /e/src/Bravo-clinic/.env <worktree>/.env`. Never print or commit its values. DB work runs ONLY against `DATABASE_URL_TEST` (Neon `dev` branch) unless your prompt names another one — never the production `DATABASE_URL`.
4. `npm install` at the worktree root. If it rewrites `package-lock.json` without a dependency change in your task, restore it (`git checkout -- package-lock.json`); if your task adds dependencies, commit the lockfile with that task.

Windows host; use Bash with POSIX syntax. The host is slow (npm install can take ~30 min, the full API suite ~14 min): use long timeouts (up to 3,000,000 ms), run long gates with `run_in_background` and wait for the completion notice, and run targeted test files while developing. Never spawn sub-agents.

## Read first (completely)
- The feature's `tasks.md`: Execution Protocol, Test Coverage Matrix, Gate Check Commands, Parallel lanes (if any), Execution Plan, and the full task definitions of your phase(s).
- The feature's `spec.md` (ACs your tasks reference) and `design.md`.
- `docs/architecture.md` sections relevant to your tasks, `.specs/STATE.md` decisions, and existing code in the areas you touch (reuse it).
- `C:/Users/eduar/.claude/skills/tlc-spec-driven/references/implement.md` and `references/coding-principles.md`. Follow the per-task cycle exactly: state assumptions/files/success → spec-derived tests → implement → run the task's gate → test adequacy review → mark the task `[x]` in tasks.md (and spec.md traceability if that feature uses it) → ONE atomic Conventional Commit per task.

## Rules
- Verify package versions with `npm view <pkg> version` before installing; follow AD-022.
- Commit messages: validate with `python C:/Users/eduar/.claude/skills/tlc-spec-driven/scripts/check_commit.py --message "<subject>"`; end each message with the `Co-Authored-By:` trailer your prompt gives.
- Stage only exact paths (no `git add -A` / `git add .` / `git commit -a`). Never push. Never touch `.specs/STATE.md`.
- Stay inside your lane's file ownership (stated in your prompt). Other workers edit other areas concurrently.
- Lanes that do not own `apps/api` never run `npm test -w apps/api` (it truncates the shared test DB).
- Never weaken, skip or delete tests. If a planned test or expected value is genuinely wrong (contradicts spec/PRD), stop and report. If a gate fails and you cannot fix it after reasonable effort, stop and report the blocker.

## Report back (compact, ≤200 words)
```
Batch (<feature> phase N[-M]) complete:
- Worktree path + branch: ...
- Tasks done: [Txx — commit hash] ...
- Tests: [N passed, 0 failed]
- Deviations/blockers: [none | description]
```
