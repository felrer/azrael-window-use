# UIA cursor visibility

## Agreed scope

Windows x64, local interactive standalone MCP. Keep semantic UIA execution and
the real user cursor unchanged. Reuse the existing actionPoint/present_pointer
route for direct element actions and each freshly resolved task macro step.
Show model activity immediately, retain it for 1000ms after completion, then fade
over 200ms to the existing 32% idle opacity. Reduced motion keeps the hold without
the fade. Stop, removal and disconnect override the hold. No input reservation,
foreground work or tool-response delay is added for this presentation.

Project-specific macro storage remains deferred. Builtin Azrael is outside scope.
Preserve the pre-existing diagnostics changes in shared files.

## Execution and verification

1. Reuse existing UIA action visualization (already wired for direct actions and
   macros); retain tests covering semantic delivery, fresh targets, and cosmetic
   calls without pointer input.
2. Change native CursorPresentation activity lifetime and deterministic render
   checks for immediate visibility, hold, repeated idle, new activity, reduced
   motion, and removal.
3. Freeze selected C++ inputs under artifacts/uia-cursor-run-20261116 (owner:
   standalone-uia-cursor). Compile and run native render and relevant regression
   selftests; run JS suite. Build outputs, images and raw logs belong to this run.
4. Publish an identified runtime under artifacts/local/uia-cursor-connected with
   compact evidence; reuse unchanged verified window-control runtime. Refresh the
   independent MCP after updating its exact runtime path. Commit scoped changes.
5. Reconcile and remove disposable run material through its owner after required
   evidence is retained. Active runtime is a deliverable, not disposable material.

## Results

- Existing UIA wiring was confirmed for direct invoke/set_value/press_key,
  toggle/select/expand/collapse/scroll and freshly resolved macro steps. It was
  preserved; no UIA action was replaced with a mouse event.
- Frozen C++ configure/compile exited 0. Nine native checks exited 0: render,
  keyboard-interruption, keyboard-reservation, batch, curve, autonomous-startup,
  cursor-guard, input-safety-live and raw-origin. Render check passed 86 assertions
  including actual hidden layered-window upload and DPI anchoring. Light/dark
  rendered frames were inspected; foreground remained unchanged. User physical
  motion was observed and was not treated as a failure or reset.
- JS: 31 passed, 0 failed, exit 0. The initial new test incorrectly required an
  idle notification after a semantic error, although existing failure guards
  correctly retire the cursor session; its assertion now accepts verified release.
- Actual owned WinForms fixture, new native runtime and real UIA backend: direct
  invoke/set_value plus a two-step macro passed (exit 0). Four semantic actions
  generated eight cosmetic active/idle calls at distinct button/input positions;
  collaboration remained unrequested, button count was 2 and value readback
  matched. All owned helpers and the fixture were disposed before cleanup.
- Compiled from one immutable input snapshot. Unchanged window-control binary is
  reused from input-safety-connected, verified by its existing content manifest.
- Runtime prepared at artifacts/local/uia-cursor-connected. Minimum verification
  and generated light/dark frame evidence remain with this deliverable. Raw build
  material will be removed after registration and reference reconciliation.

- Implementation commit: `848676eb9777ad364dfdcc74351b24587f3cde56`.
- Changed only the exact standalone runtime argument in
  C:/Users/felre/.azrael-ex/config.toml to uia-cursor-connected. Reconnected
  az_window_use; server readiness and context availability were true. Overall
  reload readiness remained false because the unrelated laio server is unavailable.
- Active deliverable registered as uia-cursor-runtime-848676e,
  1,895,918 bytes, with explicit MCP consumer and verification references.
- Disposable group uia-cursor-run-20261116 (11,886,357 logical bytes) was reviewed
  and deleted through project_cleanup_apply. Decision
  bad962e9e205051179d2fb5790f1ab44378cc558f030f623873dafb9b5531df6
  reports deleted, remaining:false, no error. Physical root absence also checked.
- Builtin Azrael and clean-machine packaged acceptance were not exercised.
  Older pre-existing protected artifacts and diagnostics changes were preserved.

Status: implementation, verification, independent MCP refresh and cleanup complete.
