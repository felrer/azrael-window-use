# Platform backends

Status: `partial`. Tauri 0.2.0 Windows x64 passed packaged UI/MCP and real coordinate-input acceptance. macOS arm64 passed native/Rust builds, non-GUI MCP, JavaScript, package/signature and Azrael consumer checks; GUI acceptance awaits a same-user desktop and Screen Recording permission. Linux x64 passed native staging, Rust build/tests, JavaScript, package/archive integrity and actual packaged MCP checks; Linux GUI acceptance remains pending. The published 0.1.0 portable release is the older Electron Windows package. A successful source build is not GUI acceptance.

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
| Cosmetic semantic-action cursor | Current native cursor | Tauri overlay; GUI acceptance pending | Tauri overlay on unscaled displays; live acceptance pending | Not available |

Multiple cosmetic cursors do not imply independent native input pointers. macOS points are global logical screen coordinates and capture pixels use logical-size output. X11 native points use root pixels; the cosmetic overlay is disabled when any Linux display has scale factor other than 1. Wayland does not guess global coordinates. Coordinate-dependent tools remain unavailable until their platform backend is implemented and verified.

## macOS

Intended targets: macOS 14+ on arm64 or x64. Actual 0.2.0 build/protocol verification: macOS 26.7.2 arm64 over the saved `laio-dev-mac` SSH route. Intel and GUI actions remain unverified. Accessibility and Screen Recording are separate macOS permissions. A same-user logged-in GUI session is required for desktop operations; SSH access alone does not supply it. The backend checks session and permission state without prompting during model requests.

```sh
npm ci
node scripts/build-macos.cjs
node scripts/verify-macos-native.cjs
node --test tests/platform-runtime.test.cjs tests/unix-launch.test.cjs tests/macos-backend.test.cjs
```

Then prepare resources, compile the Tauri host, stage the signed app and package it through the [Tauri host procedure](tauri-host.md). A Rust build alone does not produce the complete app and bundled Node resources.

Xcode Command Line Tools and Node/npm are development prerequisites. The helper is ad-hoc signed. [Native details](../native/macos/README.md) describe AX mapping, identity and capture safety. Packaged macOS distribution is not Developer ID signed or notarized; production distribution and clean-machine acceptance require separate verification.

## Linux

The source backend needs system Python 3, PyGObject with AT-SPI 2/Gtk 3, Pillow and the user session accessibility bus. X11 capture additionally needs libX11 and libXcomposite. The staging command checks dependencies and does not install system packages or request root privileges.

```sh
npm ci
node scripts/build-linux.cjs
```

The Tauri host additionally needs Rust, WebKitGTK 4.1 and GTK 3/AppIndicator development dependencies; the Ubuntu build also uses `librsvg2-dev`. Prepare resources and compile/package through the [Tauri host procedure](tauri-host.md). Runtime machines need the platform WebKitGTK dependencies, even though Node and the native backend are bundled.

Wayland is detected even when Xwayland supplies `DISPLAY`. It uses retained AT-SPI frame handles and semantic actions, with explicit refusal of capture, window resize/restore and coordinate input. Portal/libei coordinate input and ScreenCast capture are future backend work. The 0.2.0 Linux x64 build was verified on Ubuntu 24.04 WSL using task-local extracted development/runtime libraries and Node 24.19/Rust 1.98. Rust tests passed 4/4, JavaScript 74 passed/2 skipped, and actual packaged MCP passed 5/5. No real desktop interaction was verified. The ELF has no build-prefix RPATH/RUNPATH; runtime machines still need WebKitGTK/GTK system dependencies. These checks do not establish Linux GUI acceptance.

## Launch and packaging

Unix uses a private mode-0700 socket directory and authenticated stdio adapter. A disconnected adapter releases only its session. Tauri owns native windows and the tray on all three platforms; its lightweight launcher uses bundled Node for MCP and shared-service discovery. There is no Electron RunAsNode fuse in the Tauri package. `scripts/package.cjs` owns the current package format; `scripts/package-unix.cjs` is a compatibility entry point that delegates to it. The macOS bundle ID is `com.azrael.window-use`.

The existing Windows v0.1.0 release and Azrael's own platform acceptance matrix are unchanged. These source additions do not activate the Azrael built-in adapter on macOS/Linux automatically.
