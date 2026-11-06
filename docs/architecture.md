# Window Use MCP

Status: partial. The independent package, permission UI, real UI Automation input and self-protection are verified on Windows x64. Physical-coordinate input acceptance is pending. Execution evidence belongs in the work record.

## Product boundary

An independent Windows x64 interactive-desktop MCP server ships with its native window-control engine, cooperative input broker and Electron runtime. MCP clients launch the executable with `--mcp` using stdio. Launching it without that flag opens settings. Azrael, VS Code and a separately installed Node runtime are not required. No network listener is exposed.

A console launcher owns Windows standard input/output and relays messages through a random current-user named pipe to the GUI host. The host authenticates with a one-time random token before any protocol bytes are forwarded. The pipe does not grant app authority. Electron's GUI process does not own public stdio. The launcher removes inherited Node-mode environment settings, and the packaged host disables RunAsNode. EOF closes the pipe, cancels pending approvals and releases owned input.

## Permission owner

The main process owns settings, connection identities and grants. MCP arguments and client-provided names never grant authority. Each process assigns a random connection identity; temporary grants apply only to that connection. App approvals name the exact normalized executable and permission. Desktop control expires on disconnect or process exit. Denial, expiry, Stop and changed policy cancel waiting approvals and invalidate observations. No unknown input is replayed.

The enabled switch gates managed operations. Observation mode denies mutations. Ask mode requests app control permission on first use; full mode skips those prompts but retains protected apps, target checks and Stop. App observation is allowed while enabled except protected apps. Protected apps remain unobservable and uncontrollable, with masking for whole-desktop captures. Settings permit user-managed protected and permanently allowed apps. Permission requests automatically open a compact approval window; only trusted local UI actions can answer them.

## UI and self-protection

A frameless compact settings window and tray expose enable/mode, protected apps, saved grants and Stop. Approval windows state the app, executable, requested scope and expiry. Light/dark themes reuse Azrael's semantic colors, settings rows and permission labels. The window retains an application drag region and accessible close/minimize controls.

Every own executable identity is an immutable entry in the same protected-app list passed to native masking and checked before semantic or coordinate input. Own settings and approval windows cannot be unblocked, observed or controlled through this MCP, including in full mode. The preload exposes only named operations, authenticates the exact top-frame sender and validates arguments in main. Node integration and remote content are disabled. UI permissions are server guardrails, not OS isolation from other programs running as the same user.

## Reused execution

Pinned Azrael policy and native sources retain exact window lifetime identities, stale-observation rejection, bounded UI Automation queries, password withholding, window occupancy, masked desktop capture and cooperative physical input rules. A standalone adapter supplies settings, approvals, connection context and input callbacks without fabricating Codex metadata. Native executables and payloads are verified from content manifests before launch.

## Data and failures

Settings live under the product's own user-data directory and are revision-checked and atomically persisted. Corrupt settings fail closed. Logs record lifecycle, request names, correlation IDs, outcome and duration without screenshot data, UI text, typed text or credentials. Logs are bounded. Runtime failure, failed IPC or missing UI never creates a grant. Disconnect releases owned input and pending requests without closing user applications.
