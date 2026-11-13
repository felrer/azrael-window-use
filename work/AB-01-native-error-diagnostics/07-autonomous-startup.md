# Autonomous input startup

## Result and scope

User authorized removing every preparation state that requires user input. Windows x64 local interactive Default desktop. `awaiting_relative_motion` and `probing_suppressed_raw` and their 250ms startup suppression probe are removed, including timers/counters/held-input admission logic. Device snapshot and Raw Input registration, replacement cursor and guard initialize synchronously, then return ready. No synthetic physical event or fabricated probe success is used. Actual registration failures, unsupported devices, target/foreground validation, delivery/hook watchdogs, keyboard reservations and Stop remain.

The phase set is off/ready/failed. Compatibility `capability_pending` is always false; initialization/delivery failure uses an actual error rather than a pending user-input wait. Readiness describes initialization, not proof that physical Raw Input already survived suppression. No installed release or global MCP registration was changed.

## Actual verification

Frozen native source SHA256: `5f6ed52879b52e4ea02bbfe894bbde03a8201c760c77fadc2fbf4515b97cfaff`.
Windows x64 MSVC Release / Visual Studio 18 2026 CMake. Single build, no failed attempt/rerun. Start/end 2026-11-13 13:28:46.552–13:29:10.630 UTC, 24.078 seconds including all native checks. Native README wording-only corrections after this snapshot did not change compiler inputs; no duplicate compilation.

| Executed check | Actual result |
| --- | --- |
| CMake configure / compile | exit 0 / 0 |
| Real Raw Input registration, synchronous ready with zero received RAW packets/suppressed events, model begin before any packet, disable and null-controller failure | exit 0 |
| Batch, keyboard reservation/interruption, cursor guard, Raw Input origin checks | exit 0 each |
| Real EDIT focus/caret replay, held Shift restoration, destroyed-origin rejection and original foreground restoration | exit 0 |
| JS package suite | 25/25, exit 0 |
| Standard MCP SDK `--batch` against fresh isolated runtime | exit 0, startupReady=true, effectsPassed=true |

The first approved SDK status was ready with enabled=true, capability_pending=false and startup suppression=false. Physical mouse packets had already arrived by that SDK observation, so zero-event startup is established by the dedicated native check rather than inferred from this SDK run. The four-step batch (click edit, Ctrl+A, text, click button) completed all steps; exact UIA value and fixture click increase matched. Native returned restored=true, pending=false, keyboard buffer/replay count 0. External mouse delta during the call was 141, external keyboard delta 0. This is not physical concurrent-keyboard acceptance, and no IME/remapping-driver acceptance is claimed. Existing waiting visual is wired but no rendered waiting-state screenshot is claimed.

Root owned native integration/build/report; existing adapter owner removed 12×800ms readiness polling and added immediate-ready acceptance. The new native test replaces the obsolete preparation-wait test because the protected waiting/probe contract is retired by this request. It is retained to prevent later startup edits accidentally reintroducing a physical-event dependency. The tiny SDK verdict test catches later acceptance changes that allow a not-ready initial state to pass on eventual effects.

Terminal evidence: native `1794576526246553-49944-35208`; JS `1794576545513721-49944-35242`; SDK `1794576556481913-49944-35258`. Task raw logs are reduced to these independently readable results before deletion. Source changes are one functional commit; no push.

## Handoff and cleanup

The earlier check runtime/record from 06-keyboard-reservation is superseded by the verified autonomous runtime. Only `work/AB-01-native-error-diagnostics/keyboard-check-autonomous/runtime/` (1,779,165 bytes) and accompanying `keyboard-check-autonomous.json` remain for the inherited physical-keyboard/IME check; manifests and exact source identity are in that record. User confirmation of normal operation releases this minimal check reference and authorizes its ordinary deletion, with no separate cleanup request. Automated autonomous-startup and batch acceptance are complete; inherited real-device check and check-bundle cleanup remain pending.

Cleanup actual result: the native frozen/build tree, SDK profile/fixture, build helper, newly generated dev-launcher and superseded keyboard-check runtime/record were normally deleted and absence verified, exit 0. Before superseded deletion the replacement was content-verified, unchanged window-control manifest matched, and the old check reference was explicitly released as superseded by the changed requirement. Fresh CIM found no task-path consumer; reparse checks passed. No force, ACL/attribute changes or archive relocation. Cleanup terminal record `1794576729708211-49944-35368`.
