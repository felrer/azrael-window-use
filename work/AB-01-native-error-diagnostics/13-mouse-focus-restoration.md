# Mouse focus restoration and buffered keyboard delivery

## Scope and execution

Authorized: extend cooperative Windows x64 mouse click/drag/scroll to reuse the existing keyboard reservation, original foreground/focused HWND restoration, held-key reconstruction and ordered buffered delivery. Standalone MCP only; no Azrael application build or remote push. Preserve unrelated diagnostics edits.

Single owner: root. Validate mouse parameters/path before reservation and activation; reuse the existing completion and error cleanup path. Batch steps reuse their outer reservation without extending its deadline. Click/scroll reserve 1000ms; drag reserves durationMs + 1000ms (maximum 3000ms). Public batch budgets stay unchanged at 100–1000ms. Pure pointer presentation and observations do not reserve input.

Existing Win32 restoration does not pin DOM elements, caret selection, or IME composition. Same-window semantic focus restoration and real physical-device concurrency require explicit verification; do not claim those from buffered fixture events.

Verification preparation and deployment outputs: task-owned disposable `artifacts/local/mouse-focus-build/` (frozen native inputs, CMake output, logs and one-off runner); delete after handoff. Installed product output: `artifacts/local/mouse-focus-connected/runtime/{window-control,multi-pointer}` plus minimum build evidence, retained as the active MCP runtime. Reuse unchanged verified window-control from image-input-connected; rebuild changed multi-pointer from frozen inputs. Update the existing MCP runtime-directory only after checks pass, then reconnect.

Checks: native queue, live focus/caret/delivery and destroyed-origin refusal; actual broker mouse operation restoring focus with ordered buffered keys; curve/batch/startup and JavaScript regression checks. No additional durable test unless a concrete future omission remains uncovered. Start: 2026-11-14 (Asia/Seoul).

## Verification and correction

Compilation and native interruption/reservation/batch/curve/startup/cursor-guard/raw-origin checks passed (exit 0). JavaScript image-coordinate/runtime/switched-default checks: 16 passed, exit 0. Initial live native check passed application assertions but failed returning to the pre-test external foreground. Rerunning the unchanged live check under an owned foreground host passed completely (exit 0): original EDIT/caret, ordered buffered delivery, held Shift reconstruction, zeroized records and destroyed-origin refusal. Buffer entries were supplied directly; this does not prove physical hook arrival.

Actual SDK mouse checks first exposed click restoration being undone after return. Added 50ms settling after synthetic release, before restoration, on the broker thread while the UI hook keeps buffering. Recompiled the changed C++ component (second attempt); no unchanged Rust rebuild. Native checks passed again. Actual SDK click, 2000ms drag and scroll then passed with original EDIT focus independently observed; each reservation reported restored=true, pending=false. Actual SDK batch acceptance passed unchanged, including four completed steps and text/button application effects (exit 0). The first SDK attempt had also failed to establish the owned foreground; test-only activation was corrected without weakening product activation policy.

50ms is bounded scheduling allowance, not proof of application dispatch. HWND identity validation and per-event destination validation remain mandatory. No DOM/IME guarantees added. Existing native live and SDK checks were reused as one-off verification; no new durable test or permanent test framework was added. Rebuild was required only for the observed asynchronous click/focus race. Native README changed after the first freeze; the complete frozen input inventory is retained in product build evidence, with the documentation-only delta distinguished from unchanged compilation inputs.

Product receipt: `artifacts/local/mouse-focus-connected/build-evidence.json` contains exact frozen hashes, compiler/check exits and compact acceptance results. Window-control manifest eafdcda183570883365515a77e00dabebbcc5727ad299424da16350b83991be9 is reused unchanged. Multi-pointer manifest c55b135fb32db5c54598b76d22a5e9a646aa467c05fa782fb4710a107ae68421.

## Handoff and cleanup

Updated the existing `window_use_public` configuration runtime-directory from image-input-connected to mouse-focus-connected. Reconnected successfully (`window_use_public=true`) and actual MCP `context` returned normally. Aggregate reload readiness remains false only because unrelated `laio` is unavailable. No remote push or full Azrael installation. The current runtime and compact receipt are persistent product outputs, not a temporary user-check bundle.

Task-owned build inputs, CMake outputs, raw logs, one-off runners/fixtures and isolated Electron test profiles under `artifacts/local/mouse-focus-build/` were removed with ordinary deletion and absence verified after test consumers ended; no remaining task-owned scratch. Existing unrelated dirty files and previous runtime ownership remain unchanged. End: 2026-11-14 (Asia/Seoul); physical keyboard/IME real-use coverage remains unverified.
