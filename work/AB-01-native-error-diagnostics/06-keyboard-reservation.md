# Keyboard reservation and one-call batches

## Authorized behavior and implementation

2026-11-13, Windows x64 local interactive Default desktop. User approved buffering physical keyboard input during short model click/key batches and returning it to the original user window, using the existing waiting visual.

- `batch` supports 1–16 click/text/press steps, one target/pointer and operation ID; default 750ms, accepted 100–1000ms, total text <=1024 UTF-16 units. Entire definition and coordinates are checked before application input. Native FIFO does not interleave another participant within the batch.
- Cooperative press/text also reserve the keyboard. Physical hook edges are counted and buffered; held physical keys are neutralized and restored. Exact original process/root/focused child is pinned and checked before replay. Consumed event contents are zeroized. No raw key content enters logs or responses.
- Chords/text use one Windows insertion per packet; public batch uses one MCP actuation call. Expected savings come from fewer model/API/UI round trips; no end-to-end latency benchmark is claimed.
- Existing waiting cursor is active throughout reservation. Foreign injection, Stop/disconnect and target validation remain. Deadline/high-water requests synchronized abort; permanently hung broker and finite-buffer overflow limitations are documented.
- Existing physical mouse readiness remains required. No global config, installation or immutable published runtime was replaced.

Root owned broker/acceptance/docs; keyboard_reservation owned hook/buffer/focus fixture; batch_adapter owned schema/provider/projection/SDK runner. Parallel owners preserved prior uncommitted diagnostic changes. Final source is one functional commit; no push.

## Actual verification

Final frozen native input SHA256: `2675ed8f11a7f50917eb004900bd690048ecdc17ed9cdebab4e062cb970e4408`.
MSVC x64 Release, Visual Studio 18 2026 CMake generator. Final run 2026-11-13 13:10:31–13:10:49 UTC (18.473 seconds total, including test preparation).

| Executed scope | Actual exit |
| --- | --- |
| CMake configure / C++ compile | 0 / 0 |
| Batch validation / operation-ID selftest | 0 |
| Keyboard buffer/order/interruption/high-water/overflow selftest | 0 |
| Existing keyboard interruption / preparation wait / cursor guard / Raw Input origin checks | 0 each |
| Real Win32 EDIT focus/caret replay, held Shift neutralization/restoration, destroyed-origin rejection and pre-test focus restoration | 0 |
| JS package suite `node --test tests/*.test.cjs` | 0, 24/24 |
| Standard MCP SDK connection / tool discovery / new batch request forwarding | Connected; request reached native |
| SDK batch application effects and physical concurrency | Exit 1, capability_blocked; not passed |

The Win32 fixture uses real SendInput and real EDIT controls but feeds its buffered test edges directly; it does not prove physical low-level hook arrival. The SDK run received zero external mouse/keyboard events during twelve readiness observations, remained awaiting_relative_motion, and returned native capability_pending before any application input: actionExecuted=false, deliveredInputs=0, applicationInputs=0. Actual click/text batch effects, physical concurrent replay, waiting visual rendering during a real reservation, IME and remapping-driver compatibility remain unverified. No input was replayed to bypass readiness.

Native build attempts 1–4 compiled and passed unit checks but encountered fixture environment problems: first foreground activation refused; subsequent hidden-launch runs found invisible fixture or failed character assertion. Registered ordinary fixture windows, explicit owned-window show/enable and a visible interactive test launch resolved the setup. The same frozen attempt-3/4 executables passed live when launched visibly. Final attempt-5 passed all stages. No product input guard was relaxed to address fixture failures. Final SDK used attempt-5 verified runtime; this evidence does not claim a packaged release.

Terminal records: final native `1794575431020271-49944-33660`; JS `1794575263392827-49944-33463`; SDK `1794575473881762-49944-33679`. Raw task logs were consumed into this report before cleanup.

Retained checks address specific later omissions: adding batch actions without updating strict nested validation/admission/serialization; dropping post-call authorization guards or privacy projection; simplifying keyboard hook interruption and reintroducing epoch cancellation inside reservations; changing focus reconstruction while queue-only checks still pass. Existing input checks were reused. Fixture native live test remains an explicit interactive flag; ordinary build selftests do not seize foreground.

## Check handoff and cleanup

Minimal outstanding user-check bundle: `work/AB-01-native-error-diagnostics/keyboard-check/runtime/`, owner AB-01-keyboard-check, containing verified window-control + multi-pointer runtime only (1,779,677 bytes). Purpose: rerun real SDK `--batch` with actual mouse readiness and physical keyboard activity. No source/build tree, test app, profile or backup is required. Exact manifests and size are recorded in the accompanying `work/AB-01-native-error-diagnostics/keyboard-check.json`. After normal operation is confirmed, release this reference, delete runtime and its handoff record normally and verify absence.

Cleanup actual result: all five frozen build/run trees, SDK batch-run-live fixture/profile, build helper, both raw unit logs and the newly generated dev-launcher were normally deleted; absence verified, exit 0. Consumers had reached terminal results and a fresh CIM observation found no task-path consumer. No force options, attribute/ACL changes or archive relocation were used. Cleanup terminal record `1794575718361874-49944-34124`. Only the announced runtime/check record remains for user verification.

The installed release/config remain unchanged. Whole-task real-device acceptance and handoff cleanup are pending; source implementation and the listed automated checks are complete.
