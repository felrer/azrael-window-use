# Permission UI

Status: implemented for Windows x64; current-user visual acceptance pending.

Azrael Window Use presents separate frameless approval and settings windows. The approval names the exact executable, describes its scope and offers deny/session decisions, plus permanent app allowance for control requests only. The footer opens settings without cancelling the pending request and shows the real expiry time. Closing approval still denies pending requests. Settings are not an overlay or a replacement for the MCP connection.

Settings expose enabled, permission mode (observe, ask, full), whitelist and protected app lists, theme, Stop/resume and reset/done. Both list types support selecting an existing local executable or entering its path; validation runs in the main process. Reset restores enabled/ask/system and clears user lists; immutable self-protection remains. Policy changes continue to cancel pending approvals and revoke session grants. Protected apps cannot be whitelisted; adding protection removes a duplicate whitelist entry. Only a trusted settings renderer can change these values. Existing themes and Stop/resume behavior remain available.

`src/app-icons.cjs` asynchronously uses Electron `app.getFileIcon` for normalized local executable identities from trusted permission snapshots, including pending requests and both lists. Extraction never executes a target application. No renderer API accepts arbitrary icon paths. Four concurrent lookups and a 512-entry bounded cache avoid repeated extraction; failures are cached and use a generic icon. Cache lifetime is the MCP host lifetime. Missing, inaccessible and unsupported app icons are not guaranteed to extract. UNC paths are not queried. PNG data URLs are the only dynamic image format accepted by the renderer; CSP allows inline image data but still rejects remote content and network connections.

The renderer uses semantic listbox controls with keyboard navigation, focus indication, selection checks and outside/Escape dismissal. The scroll area has a thin thumb with no visible track/arrows. App icons appear in approval and settings lists. Production loads no preview HTML or Paint-specific fixture.

Owners: `src/main.cjs` (trusted IPC/snapshot/window lifecycle), `src/app-icons.cjs` (extraction/cache), `src/ui/` (rendering), `src/permissions.cjs` (existing policy and persistence).

Verification: `npm test` includes icon deduplication/concurrency/failure/disposal and existing permission/runtime guards. UI acceptance requires checking approval/settings, icons/fallbacks, keyboard picker behavior and light/dark appearance on Windows. No GPUI migration or first-display latency improvement is claimed.
