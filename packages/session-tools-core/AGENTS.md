# Session tools core

Use `src/tool-defs.ts` as the canonical catalog. Keep handlers transport-agnostic; tools that need host authority take callbacks on `SessionToolContext`, not a dependency on shared or server-core.

## Goals

- Expose Goals tools only with `getSessionToolDefs({ goalRole })` (or the matching JSON Schema helper). Derive `goalRole` from the actual assigned session on the host; never accept it as model input. Role filtering advertises capabilities, but only the host can authorize each action.
- Inject `ctx.goals` from the actor-bound service for that session and workspace. Never attach renderer actions, list unrelated goals, or let tool arguments select the actor. `goal_get` is Explore-safe; all state/evidence changes and verification requests are blocked in Explore.
- Re-read `goal_get` on revision conflict. A verifier submits evidence-backed results for every stable criterion; the owner can request, but cannot submit, a verdict.

Run `bun run --cwd packages/session-tools-core typecheck` and `bun test packages/session-tools-core/src` from the repository root.
