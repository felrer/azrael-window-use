# Concurrent cursor presentation

Scope: independent MCP, Windows x64 local interactive logon session. User authorized distinct concurrent cursor colors and locale-independent Agent N names. Existing native palette, Windows named objects and GDI+ are reused; input routing/permissions are unchanged.

Plan: reserve number/color handles across broker processes; retain reservations through overlay fading, release automatically on exit/crash; render measured English labels; compile frozen C++ sources, verify concurrent allocation/release and render frames; publish a separate pointer runtime, reuse the verified recordable window-control runtime, reconnect this MCP. Other live sessions require their own reconnect and must not be terminated.

Automatic allocation uses 72 registered colors, preferring different hue families. Exhaustion and explicit duplicate custom colors fail visibly instead of duplicating. Lowest free Agent number may be reused after an overlay disappears. User cursor label is User.

## Verification

Windows x64 MSVC Release, frozen full native SHA256 `3ae7741fd4e9c03553918067514b42f0de98f4520a92ec5c3c32682ed730565b`. Configure (4.395s), compile (10.817s), curve/batch/keyboard reservation/keyboard interruption/autonomous startup checks, native render (80 checks) and probe compilation all exited 0. No rebuild occurred. JavaScript switched-default and virtualization tests: 20 passed, exit 0.

One-off probe directly exercised CursorIdentity in 12 simultaneous independent processes: unique numbers/colors, exact Agent N strings, duplicate custom-color refusal, automatic release after process crash and normal exit all passed, exit 0 (UTC 2026-11-13 16:07:22.148–22.387). No application input. Rendered light/dark native frames visually reviewed, including Agent 4096; names fit. Existing render fixture now includes multiple palette colors and longer Agent labels so future painter/font edits continue exercising the changed presentation; one-off process probes are not retained as test machinery.

Published `artifacts/local/agent-cursor-connected/runtime/`: new multi-pointer manifest SHA256 `30f1b762b8aa8df8fe53cf81ecc4dcf5c93fb84ba8689ac884acdc867f34243e`; reused unchanged recordable window-control manifest `c2ececc9626a8be377ddf4696b1f92098de8fe9d14782ace8323759352749d81`. Both runtime integrity verifiers passed. Independent minimal receipt: `artifacts/local/agent-cursor-connected/build-evidence.json` (commands, inputs, exits, identity results). Active runtimes are retained as deployed product resources. Prior live runtimes/keyboard acceptance material belong to earlier work and are unchanged.

Handoff: reconnect this MCP to the new runtime; other live connections must reconnect themselves. Cross-process allocator and renderer were verified separately; multiple real client sessions showing cursors together remain a user real-use check. Build scratch `artifacts/local/agent-cursor-build/` is disposable after handoff; remove normally after producer termination, preserve the minimal receipt above.

Handoff completed: `window_use_public` ready:true after reconnect, context available:true and list_windows successful. Host PID 52184 and native window-control PID 77096 resolve to the new deployment. Other live connections were not restarted. Aggregate reload ready:false is caused by unrelated laio readiness, not this MCP. After all compiler/test/probe processes ended and no scratch consumer remained, ordinary deletion removed the frozen source/build/log/probe/frame directory above; absence verified. Minimal receipt retains independently readable outcomes. Implementation commit: `6570b0f`.
