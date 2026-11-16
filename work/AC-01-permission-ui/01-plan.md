# Permission UI web preview

Status: design preview; runtime approval UI unchanged.

## Scope and settled decisions

- User requested a web preview for fast iterative permission-dialog design, before considering GPUI migration.
- Windows x64 is the current product scope. This HTML is a browser design artifact, not a native implementation or performance measurement.
- Reuse approved app icon and current permission categories/decisions. No real permission IPC, grant writes or requests.
- Deliver preview.html with light/dark, control/observation/desktop, long path, density and mock button feedback.
- Retain this requested editable design artifact for subsequent discussion. No product build, installation or GitHub publication.

## Verification

- Static verification passed (Node, exit 0): inline JS parsing, unique IDs, static DOM target references, app-icon existence, no external/persistence/permission API.
- Rendered browser inspection was blocked: in-app browser is unavailable; Chrome Browser policy rejected file:// navigation (HTTP/HTTPS only) and explicitly forbids workarounds. No alternate serving surface was used to bypass this denial.
- Pending user visual review and rendered interactions, including narrow viewport, light/dark, scope switching and mock decisions. No browser pass is claimed.
- Fixed expiration is explicitly marked as a preview; no backend performance claims.
- UI direction remains proposed and subject to user review.
- No disposable files, build outputs or background server were created. The HTML and this record are requested editable design deliverables.

## Revision 2

- Removed requester line and its preview setting, capability-list row, and redundant execution-status footer sentence.
- App-control heading now asks whether to temporarily allow control of this app. Other request types retain their distinct headings.
- Static JS/DOM-reference verification passed, exit 0. Visual browser verification remains blocked as described above.
- App icon question investigated: the preview uses a static monitor SVG; the runtime renderer has no target-app icon, and permission records carry name/executable only. Actual executable icon extraction is not implemented by this revision.

## Revision 3: settings preview

- User requested heading "앱의 제어를 잠시 허용할까요?", replacement of the bottom-left waiting label with a gear settings button, and a security/whitelist settings window.
- Scope remains this interactive design preview. Production permissions, IPC and persisted policy are unchanged.
- Added native HTML modal with accessible title, close/done controls and return focus. Security controls reuse current enabled/ask/observe/full concepts.
- Added in-memory whitelist and protected-app lists, path entry, duplicate checks, protection precedence, current-demo-app shortcut and reset. Self-protection is displayed as a fixed row.
- No actual executable picker or file access is performed; this is a design simulation. Production app-icon integration and performance work remain outside this revision.
- Rendered inspection remains blocked by the browser policy previously recorded. Focus trapping/keyboard and actual light/dark rendering need user review.
- One-off Node DOM harness passed, exit 0: script syntax/references, modal open/close, invalid path, add/duplicate/remove, protection precedence, current-app shortcut, mode and reset. This simulates DOM events only and does not establish visual or production approval correctness. No permanent test or temporary file created.

## Revision 4: naming and standalone settings view

- Preview display name is Azrael Window Use throughout. Product/package identity remains unchanged until production integration is requested.
- Footer gear button has a 28px hit area and equal 6px top/bottom/left gaps.
- Added settings to the preview screen selector. Gear navigates to this same standalone settings preview; close/done/Escape return to app-control preview. Settings preview remains scrollable and supports theme changes.
- Corrected flow representation: production main.cjs creates a separate non-modal settings BrowserWindow, not an overlay modal over approval. Preview now displays settings alone in its stage; it does not create an OS window or reproduce all production settings persistence/file-picker behavior.
- Browser visual verification remains unavailable under the recorded policy; user screenshots confirm previous version rendered, not acceptance of this revision.

## Revision 5: target app icons

- User requested executable app icons on approval targets and settings lists. Applied to preview; production integration remains pending design acceptance.
- Extracted actual installed Microsoft.Paint_11.2609.401.0_x64__8wekyb3d8bbwe/PaintApp/mspaint.exe icon via System.Drawing.Icon.ExtractAssociatedIcon (exit 0). Retained paint-icon.png (32x32) is a requested preview asset, not a disposable probe.
- Visually inspected extracted PNG; Paint palette icon is present. Approval target, whitelist and protected rows reuse preview icon mapping. Paint is labeled 그림판; unknown app paths use a generic fallback; image-load failure restores fallback. Fixed self-protection row uses the approved Azrael Window Use app icon.
- Arbitrary browser-entered executable paths do not read local files; production Electron main-process app.getFileIcon(path) is available in installed Electron declarations for later integration. Preview uses the extracted fixture only, not live extraction on each list edit.

## Revision 6: settings simplification

- Removed body settings heading, introductory description, security section heading and preview-only note. Dialog retains its accessible name using the existing title-bar text.
- Settings scrollbar uses a 5px rounded thumb, transparent track, no arrow buttons, plus thin-scrollbar fallback for non-WebKit browsers. Reset button has a transparent border/background with keyboard focus styling preserved.
- Node static checks passed (exit 0): JS syntax, unique IDs, DOM references and accessible title. Rendered scrollbar/light/dark inspection remains for user review because of the recorded browser restriction.
- Preview scope only; production UI is unchanged. No new temporary material.

## Revision 7: permission mode picker

- Ordered permission options: observe, ask, full. Default remains ask.
- Replaced OS-native menu in this picker with a themed rounded listbox, selected checkmark, subtle hover/focus states and shadow. Other preview selectors remain unchanged.
- Supports pointer selection, arrows, Home/End, native button Enter/Space, Escape, focus departure and outside-click dismissal. Accessible label, expanded state, listbox relationship and selected option are exposed.
- Static syntax/DOM/order check and one-off picker DOM simulation passed, exit 0: selected-value focus, arrows, selection, Escape and outside dismissal. No temporary test files retained. Actual browser rendering and screen-reader behavior remain unverified under recorded restrictions.

## Revision 8: approval copy

- Removed the approval note about protected apps being blocked regardless of permission; connection-expiration note remains. Preview text only; protection behavior unchanged.
- Reviewed exact one-line HTML change and whitespace check. No behavior test required for this text-only edit; rendered review remains pending.

## Production integration

### Follow-up: settings glyph

- Replaced the font-dependent gear character with a shared rounded-stroke SVG silhouette. Both production and preview use the same asset via a theme-colored CSS mask.
- Kept the 28px button target, 6px footer gaps and accessible settings label; glyph is centered at 18px with neutral foreground/hover treatment.
- No permission behavior change. Rendered visual acceptance remains user-owned under the existing browser limitation.

### Follow-up: prioritized and persistent icons

- User authorized approval-first icon scheduling, persistent extracted icons and loading placeholders.
- Priority starts from permission change before window creation; approval snapshot identities precede list icons. Default four-worker scheduling reserves one slot for approval jobs and promotes queued matches.
- Added optional bounded atomic disk cache under existing product userData/cache/app-icons. Reuse validates source size/mtime/ctime; in-memory entries revalidate on access after 30 seconds. Corrupt or unwritable storage never prevents approval or grants authority.
- Added spinner for extraction/cache loading and image decoding, accessible loading label and reduced-motion treatment; errors restore generic fallback.
- Focused icon checks: 4 passed, exit 0, including priority capacity/promotion, restart reuse, changed executable and corrupt-cache recovery. Generated test fixture directory deleted by the test owner and absence asserted.
- Persistent product cache is explicitly requested application data, not a task temporary artifact. No native build or unrelated source changes needed.
- Final verification: npm test 38 passed/0 failed, exit 0; main/renderer syntax checks exit 0; targeted icon recheck passed after final disposal guard. One-off renderer DOM simulation passed loading-through-decode, success/error and unavailable fallbacks. Visual timing improvement is not measured; user acceptance remains required for perceived speed and appearance.

### Follow-up: 60-second expiry

- User requested changing the default approval timeout to 60 seconds and sending an Obsidian control request.
- Changed PermissionService default to 60000ms; explicit test timeout overrides remain unchanged. Permission tests: 6 passed, exit 0. Independent MCP refreshed ready:true (unrelated laio still unavailable).
- Sent Obsidian control request via same-size resize (1197x825 physical pixels at 144 DPI, 798x550 DIP). User approved; returned state ready and unchanged dimensions. No text input or document modification. Source and documentation change committed together.

Status: implementation committed; independent MCP refreshed; real approval shown; awaiting user visual acceptance.

- User authorized applying the agreed preview to production, all-app icon extraction, MCP refresh and a real approval request for user verification.
- Applied naming, approval copy/layout/footer gear, independent settings UI, mode ordering/custom picker, thin scrollbar, text-only reset and whitelist/protected list editing. Preserved real expiry, fail-closed approvals, self-protection, theme and Stop/resume.
- Added asynchronous bounded local-executable icon cache and trusted snapshot enrichment for approval and settings. Uses Electron app.getFileIcon; failures retain generic icon. No renderer path-reading bridge or remote lookup.
- Existing unrelated local edits in architecture/distribution/logger/MCP/vendor diagnostics are preserved and excluded from this unit's commit.
- Verification: node --check main and renderer exit 0; npm test 36 passed, 0 failed, exit 0. Icon cache tests retained to prevent duplicate/unbounded extraction or post-shutdown callbacks during future UI changes. Native binaries unchanged; no native compilation needed.
- Detailed contract: docs/permission-ui.md. No publication/push or GPUI migration authorized by this step.
- Integration commit: 6d982f5. Production renderer DOM simulation also passed (exit 0): approval/settings snapshots, PNG source, mode command, icon-refresh draft preservation, real expiry footer and open-settings command. This does not substitute for user visual acceptance.
- Reconnected only configured az_window_use_2 (standalone). It reports ready:true and context enabled:true/control:ask. Overall reload ready:false is from unrelated laio:false, not this MCP.
- Opened a blank Paint for requested user verification. Requested resize to its existing 1689x1284 physical size / 144 DPI (1126x856 DIP), to trigger app approval without changing its content or size. Product log confirms approval_window_created and approval_window_shown with no renderer failure in the observed tail.
- Live request ended approval_timeout after the normal 50-second window, actionExecuted:false. No approval was granted and no resize executed; no automatic retry. User visual acceptance remains pending.
- No task-owned build, profile, backup or disposable file was created. Product's regular bounded logs remain under its existing owner; preview sources/assets remain the requested editable design artifacts. Earlier primary-checkout maintenance cleanup blockage is separate and unchanged.
