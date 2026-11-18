# Shared Window Use service

Status: `partial` — shared-service and connection-adapter source integration is implemented. Windows x64 has the standalone 0.1.0 release; installed Azrael UI and real-input takeover acceptance remain separate gates. Standalone Unix transport and platform backends are described in [platform support](platforms.md), with native GUI acceptance tracked separately. This contract does not activate additional Azrael built-in platforms.

## Identity and ownership

Azrael Window Use has one service implementation, distributed either with Azrael or as the independent MCP package. Installation origin does not determine permissions or start a second service. A service belongs to one operating-system user, login session and desktop. It owns the tray, settings, native runtime lifecycle and active client sessions. Each client uses a connection adapter; adapters may remain as processes without creating additional trays or input owners.

The MCP server identity remains `az_window_use`. MCP configuration keys and tool namespaces remain client routing identities; equal names alone do not share a service. Private authenticated local IPC performs service discovery and connection. No network listener or model-facing service administration tools are introduced. Same-user IPC is an application boundary, not isolation from arbitrary code already running as that user.

## Sessions and UI

Each authenticated connection receives isolated session identities, observations, temporary permissions, cursor identity and occupancy ownership. A client-supplied display name or conversation ID grants no authority. Closing one connection cancels its requests and releases its owned resources, without exiting the service or revoking other clients' grants. Persistent settings, protected apps, saved app grants and the global Stop state belong to the shared service.

Azrael connects through a trusted local adapter. Its existing native permission-profile checks, conversation tool ceilings, approval lifetime and cancellation checks remain additional restrictions. The adapter presents that connection's requests in its owning chat and accepts replies only through the existing trusted approval route. Other MCP clients use the service's local approval UI. A request is owned by one presentation route; attaching an Azrael UI never accepts an unrelated external request. Losing the approval route cancels its request rather than granting permission or replaying input.

Service enabled/mode/protected-app/Stop rules apply to every route. Azrael-specific restrictions may further deny an operation. A permission accepted in one client does not become another client's temporary grant. Persistent app grants remain an explicit user setting. Service restart requires fresh temporary authority and observations.

## Installed versions and transition

An installation registers its version, private protocol and settings compatibility, executable and content identity when invoked. Discovery considers registered installations whose files still match that identity; it does not search arbitrary executables or download updates. The running compatible service remains selected on equal versions. Newer incompatible versions do not replace it.

A newer compatible candidate schedules replacement. The service stops admitting new calls, waits for active calls, approval callbacks and native cleanup, releases session/native/tray ownership and then starts its successor. It does not forcibly interrupt a gesture to make an upgrade faster. If safe draining or cleanup cannot be confirmed, replacement does not claim success. Global Stop survives replacement; restarting never constitutes Resume.

Windows input cleanup distinguishes unconfirmed process termination from a confirmed abnormal exit with unverified input restoration. Both retain the session and block replacement. A native startup rejection reporting `actionExecuted:false` before any correlated command reply, followed by confirmed unsignaled process exit, permits removal of that session's unchanged target allowlist and directory. The originating operation remains failed; cleanup never replays it or turns it into successful input. Post-startup crashes receive no such exception.

Broker failures preserve the initial stage, method and native code separately from cleanup diagnostics. The existing rotating application log records `input/broker_failed` when a broker call fails, even if the broker subsequently exits cleanly. If termination is unconfirmed or the exit is abnormal, cleanup emits an additional record; correlate by native PID when available. Records carry the observed termination/exit/signal and up to eight structured native stderr event/code/Win32-error records. Raw stderr, input text, target titles and tool arguments are excluded. Observation and temporary permission renewal remain required after service replacement. A failed drain in an older immutable service cannot be repaired by editing a newer source checkout; its supported shutdown/recovery must finish before takeover.

Connection adapters remain the MCP-facing endpoint. They reconnect for subsequent operations after replacement. A dispatched operation whose reply is lost returns an unknown outcome and is never automatically resent. UIA and capture references, selected-window handles and temporary grants from the old generation are not accepted by the successor. The caller must discover/capture again and obtain any necessary approval. An idle connection does not keep an old service version active indefinitely.

## Distribution

The independent package owns the implementation and private protocol. Azrael packages that same verified portable service and the matching shared client, rather than maintaining a second Windows control service. The Azrael host loads a relocatable verified service manifest and may also discover another compatible registered installation. It can retain the same chat UI integration when service distribution is removed from Azrael in a future product change.

Source integration, portable package validation, installed-host rendering and real physical-input acceptance are separate evidence scopes. A pre-service executable must be replaced and reconnected; it cannot acquire the private protocol through a namespace rename.
