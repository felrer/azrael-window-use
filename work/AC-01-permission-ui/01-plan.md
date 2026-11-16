# Permission UI web preview

Status: design preview; runtime approval UI unchanged.

## Scope and settled decisions

- User requested a web preview for fast iterative permission-dialog design, before considering GPUI migration.
- Windows x64 is the current product scope. This HTML is a browser design artifact, not a native implementation or performance measurement.
- Reuse approved app icon and current permission categories/decisions. No real permission IPC, grant writes or requests.
- Deliver preview.html with light/dark, control/observation/desktop, client name, long path, density and mock button feedback.
- Retain this requested editable design artifact for subsequent discussion. No product build, installation or GitHub publication.

## Verification

- Static verification passed (Node, exit 0): inline JS parsing, unique IDs, static DOM target references, app-icon existence, no external/persistence/permission API.
- Rendered browser inspection was blocked: in-app browser is unavailable; Chrome Browser policy rejected file:// navigation (HTTP/HTTPS only) and explicitly forbids workarounds. No alternate serving surface was used to bypass this denial.
- Pending user visual review and rendered interactions, including narrow viewport, light/dark, scope switching and mock decisions. No browser pass is claimed.
- Fixed expiration is explicitly marked as a preview; no backend performance claims.
- UI direction remains proposed and subject to user review.
- No disposable files, build outputs or background server were created. The HTML and this record are requested editable design deliverables.
