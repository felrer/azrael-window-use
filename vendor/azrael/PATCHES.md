# Standalone adaptations

`SOURCE.json` records the original imported bytes. Local adaptations are reviewed separately:

- `window-control-runtime.cjs` validates the independent native payload without Azrael host/engine paths.
- `window-control-policy.cjs` permits the native `inspect/read` response to contain only requested fields plus identity/password metadata. Summary scans still require name and control type. Password value/text are withheld before property validation, including native null redaction placeholders.
- `window-switched-input.cjs` serializes desktop-retarget HWND and process creation time with the native broker's required `0x` prefixes, retaining the original exact identity internally.
- `window-control-errors.cjs` retains bounded interference counters, event categories and activation metadata for diagnosing interrupted input. It does not expose typed keys, text, device identifiers or raw pointer tags.

The read adjustment preserves bounded field retrieval and prevents a future host refactor from rejecting valid partial native descriptors or exposing password fields. Release verification exercises the real native `fields:["value"]` path.
