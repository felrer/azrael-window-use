# Standalone adaptations

- Curved drag: bounded physical `points` paths use native centripetal Catmull-Rom alpha 0.5, approximate arc-length delivery and whole generated-path bounds preflight. Native/host schemas, desktop observation bounds and exact first-point target resolution preserve single-operation no-replay; original endpoint drag remains available.

- Keyboard reservation and `batch`: native cooperative key/text and single-call click/text/press batches buffer physical keys, restore the pinned user focus/state and reuse the waiting cursor. Public schemas, operation identity and safe metadata projection preserve one execution/no-replay; no keyboard contents are logged. Focus/device/IME limitations remain explicit in architecture and native documentation.

`SOURCE.json` records the original imported bytes. Local adaptations are reviewed separately:

- `window-control-runtime.cjs` validates the independent native payload without Azrael host/engine paths.
- `window-control-policy.cjs` permits the native `inspect/read` response to contain only requested fields plus identity/password metadata. Summary scans still require name and control type. Password value/text are withheld before property validation, including native null redaction placeholders.
- `window-switched-input.cjs` serializes desktop-retarget HWND and process creation time with the native broker's required `0x` prefixes, retaining the original exact identity internally.
- `window-control-errors.cjs` retains bounded interference counters, event categories and activation metadata for diagnosing interrupted input. It does not expose typed keys, text, device identifiers or raw pointer tags.
- `window-control-backend.cjs` and `window-control-errors.cjs` preserve allowlisted native method/action, native request UUID, UTC failure time, elapsed time, response correlation and exact HRESULT into the standalone logger and MCP response. Original imported hashes in SOURCE.json remain provenance of the original bytes. Raw native/provider messages and tool arguments remain excluded; unknown delivery and user-stop behavior are unchanged.

The read adjustment preserves bounded field retrieval and prevents a future host refactor from rejecting valid partial native descriptors or exposing password fields. Release verification exercises the real native `fields:["value"]` path.
- Removed unreachable DLL `virtual_input` policy/schema branches; Switched shared-foreground input and its release/stop guards remain the sole cooperative input provider. JSON headers and notices now live under `native/vendor/json`; `SOURCE.json` retains the original import paths and hashes.
- `window-switched-input.cjs` requests collaboration enabled by default once per real input session, including replacements after errors or release. Explicit session opt-out is preserved; cosmetic-only rendering never enables interception. Readiness and keyboard limitations remain native runtime behavior.
- Native virtualized mouse operations observe physical keyboard input without routing failure or epoch interruption; model keyboard operations, foreign injection and explicit Stop retain interruption semantics.
- Autonomous startup removes physical-motion waiting and suppressed-Raw probing entirely. Device registration and cursor/guard initialization return ready synchronously without user events; actual runtime faults, Stop and explicit disable remain enforced. Initialization does not fabricate physical Raw Input survival evidence.

- Optional capture includeUIA (default false) reuses bounded UIA summary retrieval and retains pixel geometry and semantic references under one fresh observation; no change to input consumption, protected targets or geometry guards.

- Add an independent suppression guard with a non-extendable ten-second ceiling, shared physical-Esc consumption, exact-helper termination fallback and conservative model-input release; preserve shorter operation budgets and no replay of uncertain user buffers.
