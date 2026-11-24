# Veto Agents — delivery goal

## Original request and scope

This fork adds urgency grouping, manually ordered chat pins, and native Goals.

Reference: supplied screenshots show a Goals sidebar entry, searchable grouped goal list, new-goal action, detail page with title, done criteria, activity timeline, owner/session links, files, counters, waiting-on-user question/answer panel and pause control. The Goals implementation uses native workspace storage and transport, not a remote Goals API.

## Done criteria

1. GitHub fork and feature branch contain source, tests and reproducible build instructions.
2. Urgency grouping shows Urgent / High / Medium / Low / Triage, handles existing numeric Priority labels, preserves session families, search, pagination and collapse persistence.
3. Pin/unpin and manual ordering persist across reloads and are independent of flags and urgency; pinned chats remain readily accessible.
4. Goals is a native sidebar destination with create, search/group list, detail, done criteria and evidence, append-only activity, owner-session/file links, waiting question and answer, user pause/resume/stop and accurate counters/state.
5. Goals state is authoritative server-side; agents cannot self-certify independent verification or impersonate user controls. Verification is separate from owner work, restart behavior is honest, caps prevent uncontrolled work, and any unsupported automatic execution is explicitly disclosed rather than simulated.
6. Automated tests and typechecks pass for changes; actual rendered app flows are exercised. macOS arm64 build is produced and launched in an isolated profile without replacing the running Craft Agents installation or altering its live workspace.

## Constraints

Use synthetic data, a disposable home and workspace, and a loopback model for acceptance. Do not copy credentials, migrate live workspaces, or replace the upstream app. GitHub fork/source publication is requested; keep user data and local QA fixtures out of commits. Preserve upstream license and clearly distinguish the fork.

## Build and local installation

On macOS arm64, install the repository dependencies with `bun install --frozen-lockfile`, then run:

```sh
bun run typecheck:all
bun scripts/build-veto-mac.ts --dir
codesign --verify --deep --strict "apps/electron/release-veto/mac-arm64/Veto Agents.app"
```

The local package is ad-hoc signed, not notarized. It uses bundle ID `com.tryveto.agents`, config `~/.veto-agents`, its own Electron user data, and protocol `vetoagents`. Upstream automatic updates are disabled. Install as a separate app; do not replace Craft Agents. LaunchServices discovery does not prove that searching in Raycast opens the installed bundle.

## Integration checkpoint

- Source includes urgency, independent pin order, ordinary manual order, scoped owner and verifier Goal sessions, Documents, Favorites, sidebar customization, Inbox, read-only Reviews, chat routing and title changes, picker cleanup, composer focus, account switching, a configurable startup mode, and moving chat families between projects.
- Scheduled Goal agents start in Execute mode but are limited to their assigned Goal tools, generated goal record and evidence files. They cannot use shell commands, connected sources or project editing tools. The verifier has a separate identity. The scheduler runs only while the host is open and does not automatically resume interrupted goals.
- Earlier packaged tests with synthetic data exercised urgency, pins, the sidebar, routing across restart and both model menus. Those observations do not certify later binaries, authenticated provider use, or Raycast launch.
- Isolated acceptance requires an explicit disposable profile, the background desktop guard (clipboard writes and native notifications blocked, audio muted, windows hidden until opacity is set), a loopback-only main-process guard, and a network watcher. Never type with a menu open. A prior synthetic Share test demonstrated that Chromium proxy flags alone do not contain Node networking; the share was revoked and safeguards were added.

## macOS candidate verification

- The integrated build passed `bun run typecheck:all` and 213 focused tests. Full-suite failures observed on this machine during earlier integration also reproduced on the upstream baseline; this is not a full-suite pass.
- Inspected the ad-hoc signed arm64 package in a disposable profile. Both QA guards logged active; the watcher recorded no off-loopback sockets. Rendered checks passed for starting, pausing, resuming, and stopping a Goal and preserving it after reload; the server denied another workspace's access. The release candidate also passed urgency grouping, pin/unpin, pinned reorder and persistence, and short-title smoke. These were synthetic model responses, not live provider usage.
- Copied the same signed bundle to the user's Applications directory without launching it there. Actual Raycast selection is not verified; it requires an isolated agent desktop. Ordinary manual drag, real two-account switching, authenticated Reviews, and the full live verifier workflow are not certified by this package smoke.
