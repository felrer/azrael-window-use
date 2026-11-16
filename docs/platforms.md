# Platform backends

Status: `partial`. Windows x64 has the 0.1.0 portable release. macOS and Linux source backends share the MCP and permission UI but have different capabilities. A successful source build is not GUI acceptance.

## Common contract

One shared service owns settings, Stop, approvals and cosmetic Agent cursors. Connections retain separate observations, approvals and window leases. Native helpers use bounded JSON-lines, verified platform/architecture manifests and file hashes. No failed or uncertain mutation is replayed. Executable identities are case-preserving absolute POSIX paths on Unix; Windows keeps its existing normalization and input engine.

`context.capabilities` reports native features and OS permission/session readiness. Model-visible tool schemas stay consistent; unsupported operations return typed failures before input. `inspect` reads accessibility data, while `capture` is image-only unless `includeUIA:true` is supplied. Capture and accessibility use the same observation contract. Password content and stale identities remain excluded.

| Feature | Windows | macOS | Linux X11 | Linux Wayland |
| --- | --- | --- | --- | --- |
| Native API | UIA | AXUIElement | AT-SPI/X11 | AT-SPI |
| Semantic inspect/actions | Implemented | Implemented; GUI acceptance pending | Implemented; live acceptance pending | Implemented; live acceptance pending |
| Selected-window capture | Implemented | ScreenCaptureKit, macOS 14+ | XComposite | Not available in this backend |
| Independent coordinate input | Current virtualized engine | Not available | Not available | Not available |
| Desktop capture/control | Current protected engine | Not available | Not available | Not available |
| Cosmetic semantic-action cursor | Current native cursor | Electron overlay; GUI acceptance pending | Overlay on unscaled displays; live acceptance pending | Not available |

Multiple cosmetic cursors do not imply independent native input pointers. macOS points are global logical screen coordinates and capture pixels use logical-size output. X11 native points use root pixels; the cosmetic overlay is disabled when any Linux display has scale factor other than 1. Wayland does not guess global coordinates. Coordinate-dependent tools remain unavailable until their platform backend is implemented and verified.

## macOS

Intended targets: macOS 14+ on arm64 or x64. Actual build/protocol verification: macOS 26.7.2 arm64 over the saved `laio-dev-mac` SSH route. Intel and GUI actions remain unverified. Accessibility and Screen Recording are separate macOS permissions. A same-user logged-in GUI session is required for desktop operations; SSH access alone does not supply it. The backend checks session and permission state without prompting during model requests.

```sh
npm ci
node scripts/build-macos.cjs
node scripts/verify-macos-native.cjs
node --test tests/platform-runtime.test.cjs tests/unix-launch.test.cjs tests/macos-backend.test.cjs
npm start
npm run mcp
node scripts/package-unix.cjs
```

Xcode Command Line Tools and Node/npm are development prerequisites. The helper is ad-hoc signed. [Native details](../native/macos/README.md) describe AX mapping, identity and capture safety. Packaged macOS distribution is not Developer ID signed or notarized; production distribution and clean-machine acceptance require separate verification.

## Linux

The source backend needs system Python 3, PyGObject with AT-SPI 2/Gtk 3, Pillow and the user session accessibility bus. X11 capture additionally needs libX11 and libXcomposite. The staging command checks dependencies and does not install system packages or request root privileges.

```sh
npm ci
node scripts/build-linux.cjs
node scripts/launch.cjs --mcp
node scripts/package-unix.cjs
```

Wayland is detected even when Xwayland supplies `DISPLAY`. It uses retained AT-SPI frame handles and semantic actions, with explicit refusal of capture, window resize/restore and coordinate input. Portal/libei coordinate input and ScreenCast capture are future backend work. There is no Linux desktop available in the current verification environment, so syntax/fixture tests do not establish Linux product support.

## Launch and packaging

Unix uses a private mode-0700 socket directory and authenticated stdio adapter. A disconnected adapter releases only its session. Windows retains the C# launcher. The Unix portable command uses its bundled Electron in Node mode, so Unix packaging deliberately requires the RunAsNode fuse; it does not copy Windows' disabled-fuse policy. The macOS bundle ID is `com.azrael.window-use`.

The existing Windows v0.1.0 release and Azrael's own platform acceptance matrix are unchanged. These source additions do not activate the Azrael built-in adapter on macOS/Linux automatically.
