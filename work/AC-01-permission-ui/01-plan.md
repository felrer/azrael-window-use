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
