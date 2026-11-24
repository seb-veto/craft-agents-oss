# Native Documents + workspace Favorites

## Request and reference lock

The feature adds a native Documents sidebar and a workspace Favorites group. Screenshots are the primary visual target: compact header; Recent / My documents / Shared with me pills; five 160×200 previews; time-grouped rows; breadcrumb, star and actions; centered 720px rich editor. Preserve the host's semantic theme tokens, not Linear branding/assets. Use the existing Tiptap editor (slash menu, formatted text, images, code, Mermaid/math).

## Implementation

- Canonical local documents: `packages/shared/src/documents`, one atomically replaced JSON record per UUID under the configured workspace's `documents/` directory. Validated inputs; revision conflicts reject stale saves; guarded record paths/symlinks.
- RPC module: `packages/server-core/src/handlers/rpc/documents.ts`, registered by the combined-fork protocol owner. Uses existing workspace lookup and typed push routing.
- Renderer: `DocumentsHome`, scoped CSS, serialized `DocumentSaveQueue`. Debounced autosave flushes on navigation; local recovery drafts survive a failed save. Conflicts remain sticky; export or save-copy retains the draft without replacing a newer document.
- Workspace Favorites: `useDocumentFavorites(workspaceId)` supplies only starred documents in stable title order; subscriptions refresh rename/unstar/delete from another connected window. AppShell integration is owned by the Goals/navigation workstream, not duplicated here.
- Import Markdown, export Markdown, duplicate, project association, document search/filter/sort and confirmed deletion.
- Sharing is explicitly local: copy internal link or export. No external publication, Linear synchronization, ACLs, or real-time collaboration. “Shared with me” has an honest empty state. My documents lists the local user's workspace documents, not a fabricated multi-user ownership system.

## Verification so far

- 16 storage/autosave/Favorites tests passed, including disk round-trip, workspace isolation, traversal/symlink rejection, invalid inputs, optimistic conflicts, failed-save recovery, in-flight serialization, navigation flush and stable Favorites filtering.
- With transport integration: 26 focused feature + routing exhaustiveness + API-map parity tests passed (1,925 assertions). Electron and server-core TypeScript checks both passed.
- Actual `DocumentsHome` rendered using the native Vite config against the real storage functions in an ephemeral temp workspace. Synthetic content only; no user workspace was modified.
- Browser action: open document → star → rename → edit rich-text body. Independent disk read confirmed `favorite: true`, new title, inserted body text, revision 4.
- Visual QA identified preview titles collapsing under large content; fixed nonshrinking headers and bounded previews. Removed nested interactive controls from preview cards.
- Initial Electron typecheck found missing protocol methods and one queue status narrowing error; both are fixed in the protocol companion.
- Browser Favorites filter verified exactly one starred result out of five synthetic documents; returning from the editor retained the renamed title and star. Library/editor screenshots were inspected; this verifies the feature component, not the actual AppShell.

## Integration / remaining proof

The fork sidebar uses `useDocumentFavorites` and native navigation. Internal links now use `vetoagents://workspace/{workspaceId}/documents/document/{uuid}`; the integration owner confirmed fork parser support.

Remaining release acceptance: full-app sidebar favorites update/open/unstar, route/deep-link runtime check, renderer build, packaged arm64 side-by-side verification. No isolated full-app endpoint was available at handoff; integration owner will provide one after combined startup passes. The parent is building distinct **Veto Agents**, with separate identity/profile and disabled upstream updater. Do not replace/restart the live Craft Agents app, copy credentials, or use live workspace data for QA.
