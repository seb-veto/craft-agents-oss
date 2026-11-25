# Agent rules

These rules apply to every coding agent working in this repo (Codex, Claude Code, Craft Agents and the rest). The team's source of truth is `agents/rules.md` in TryVeto/operations.

## Swarm rules

From Hugging Face's 1,000-agent swarm report (Nov 2026).

1. **Beat main before you merge.** Run the change against the repo's shared tests. It must score at least as well as main. Put `Score vs main: before X / after Y on <tests>` in the PR description. No green, no merge.
2. **Push, don't poll.** Agents get pinged when something needs them (mentions, assignments, webhooks). Don't loop checking for work.
3. **Least privilege.** Use only the access the job needs. Never approve your own PR, and never trade review approvals with another agent.

## Simplify pass

From PufferLib's SKILL_ISSUES guide. Run it after the change works, before you call it done.

1. Inline any function used only once; tighten the call site.
2. Flatten nesting: early returns, merge and invert conditionals.
3. Co-optimize shared helpers with their callers.
4. Keep code in fewer files. Don't split without a reason, and don't add shims only for tests.
5. Delete dead code and unused options.
6. Re-read the diff: could it be shorter and still do the job? It must still pass swarm rule 1.

This repo doesn't handle money, so the whole checklist applies. Still keep validation and error handling at system edges (user input, external APIs). In Veto product code (money, payee checks, fraud signals), never remove defensive checks.
