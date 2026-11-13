# Standalone adaptations

- Keyboard reservation and `batch`: native cooperative key/text and single-call click/text/press batches buffer physical keys, restore the pinned user focus/state and reuse the waiting cursor. Public schemas, operation identity and safe metadata projection preserve one execution/no-replay; no keyboard contents are logged. Focus/device/IME limitations remain explicit in architecture and native documentation.

`SOURCE.json` records the original imported bytes. Local adaptations are reviewed separately:

- `window-control-runtime.cjs` validates the independent native payload without Azrael host/engine paths.
- `window-control-policy.cjs` permits the native `inspect/read` response to contain only requested fields plus identity/password metadata. Summary scans still require name and control type. Password value/text are withheld before property validation, including native null redaction placeholders.
- `window-switched-input.cjs` serializes desktop-retarget HWND and process creation time with the native broker's required `0x` prefixes, retaining the original exact identity internally.
- `window-control-errors.cjs` retains bounded interference counters, event categories and activation metadata for diagnosing interrupted input. It does not expose typed keys, text, device identifiers or raw pointer tags.

The read adjustment preserves bounded field retrieval and prevents a future host refactor from rejecting valid partial native descriptors or exposing password fields. Release verification exercises the real native `fields:["value"]` path.
- Removed unreachable DLL `virtual_input` policy/schema branches; Switched shared-foreground input and its release/stop guards remain the sole cooperative input provider. JSON headers and notices now live under `native/vendor/json`; `SOURCE.json` retains the original import paths and hashes.
- `window-switched-input.cjs` requests collaboration enabled by default once per real input session, including replacements after errors or release. Explicit session opt-out is preserved; cosmetic-only rendering never enables interception. Readiness and keyboard limitations remain native runtime behavior.
- Native virtualized mouse operations observe physical keyboard input without routing failure or epoch interruption; model keyboard operations, foreign injection and explicit Stop retain interruption semantics.
- Autonomous startup removes physical-motion waiting and suppressed-Raw probing entirely. Device registration and cursor/guard initialization return ready synchronously without user events; actual runtime faults, Stop and explicit disable remain enforced. Initialization does not fabricate physical Raw Input survival evidence.
