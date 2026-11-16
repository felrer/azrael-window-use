# macOS selected-window helper

Requires macOS 14 or newer, on arm64 or x64, and a same-user logged-in console session. Build on the target architecture with Xcode Command Line Tools:

```sh
node scripts/build-macos.cjs --output artifacts/runtime/window-control
node scripts/verify-macos-native.cjs artifacts/runtime/window-control
```

The build ad-hoc signs `azrael-window-control-macos` and writes its size/SHA-256 manifest. A different host, source change, signing operation, or architecture requires rebuilding the manifest. Ad-hoc signing is for local testing; distribution signing/notarization is not implemented here.

The helper accepts one JSON object per newline, `{id,method,params}`, and emits `{id,result}` or `{id,error:{code,message,mutationOutcome?}}`. Standard output contains protocol replies only. Requests are bounded to 16 MiB; an oversized line is drained before reading the next request.

## Supported operations

- `capabilities`: no permission prompt; reports actual Accessibility, Screen Recording, and same-user GUI session facts, plus implementation support.
- `listWindows`, `status`: Core Graphics window metadata and `NSRunningApplication` executable/launch identity. IDs and launch timestamps are hexadecimal strings. Internal helper windows are excluded.
- `inspect`: AX summary/find/task/read, bounded traversal, queries and scoped retained references. `changes` currently returns a fresh summary fallback rather than a delta.
- `act`: AX press/invoke, checkbox toggle, writable string value, selectable element, expand and collapse when explicitly exposed by the provider. No application activation or synthetic key/pointer fallback.
- `observe`: desktop-independent selected-window ScreenCaptureKit screenshot, PNG, no cursor or shadow. Output dimensions are logical points represented as image pixels at `dpi:96`. This avoids claiming a native Retina pixel scale or mixing screen coordinates with image coordinates.
- `actionPoint`: validates a retained observation and optional AX element ancestry/bounds; returns the selected window or clipped element center in global logical screen coordinates. This supplies a visual Agent marker only and posts no input.
- `restore`, `resize`: AX minimized/size attributes. A successful provider call acknowledges delivery; it does not prove that the application honored a requested size.
- `shutdown`: exits after acknowledgement.

Core Graphics IDs are verified against PID, executable path and process launch date. Semantic operations additionally map one AX window by geometry/title, reject ambiguous mappings, retain the AX window object, recheck ancestry and geometry before acting, and consume the observation. Protected text fields return no names/values/actions and are not traversed or acted on. Mutations with failed provider delivery or failed post-delivery identity checks report an unknown outcome.

## Permissions and exclusions

Accessibility is required for semantic inspection/actions and window resize/restore; Screen Recording is required for screenshots. The helper never requests either permission implicitly. A session owned by another console user returns `permission_denied`. Missing or ambiguous window metadata fails closed.

Desktop capture/redaction, desktop control, coordinate input actions, synthetic keyboard input, switched input, independent pointers, native overlays and approval notifications are unsupported. There is no shared-cursor fallback. No Windows virtualization parity is claimed. Platform capability wiring must keep unavailable operations disabled.

`verify-macos-native.cjs` proves manifest integrity, request correlation, unsupported operations, invalid descriptors, session gating and shutdown without touching applications. It does **not** validate GUI capture or semantic delivery. Those require an explicitly permitted local GUI fixture with the relevant OS permissions. Missing GUI validation must remain visible in acceptance results.

API references: [ScreenCaptureKit single image capture](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager/captureimage(contentfilter:configuration:completionhandler:)), [bounded AX array retrieval](https://developer.apple.com/documentation/applicationservices/1462060-axuielementcopyattributevalues).
