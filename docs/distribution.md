# Windows portable distribution

The release targets Windows x64 in a local interactive desktop session with the Windows .NET Framework 4.x runtime available. It includes a small console launcher, Electron, the production MCP SDK dependencies and the verified native window-control and multi-pointer helpers. The launcher uses the .NET Framework supplied on the verified Windows host; there is no NuGet or separately installed modern .NET dependency. Azrael, VS Code, a separately installed Node.js and developer tools are not required to run it. Linux, macOS, ARM64, remote/headless sessions, secure desktops and elevated applications are not accepted targets for this distribution.

## Run and configure a client

Extract the entire ZIP and keep its files together. Open `WindowUseMCP.exe` to show settings. Configure a stdio MCP client with an absolute path to the extracted executable:

```json
{
  "mcpServers": {
    "window-use": {
      "command": "C:\\Tools\\WindowUseMCP-win32-x64\\WindowUseMCP.exe",
      "args": ["--mcp"]
    }
  }
}
```

The MCP connection owns its permissions and temporary grants. The default **Ask** mode requests local approval before app control; **Observe** allows observation without control; **Full** allows control without additional app approvals. Protected applications remain excluded in every mode. Window Use's own settings and approval windows are always protected; desktop capture masks protected apps. Desktop input has separate permission requirements.

`WindowUseMCP.exe` is the console stdio entry point. It launches sibling `WindowUseHost.exe`, authenticates a randomly named duplex Windows pipe with a random startup token and forwards the client's standard input/output through that pipe. The pipe ACL permits only the current Windows user; no TCP listener is created. EOF initiates normal host shutdown. The launcher owns the MCP host process tree in a Windows Job before the host begins execution, so timeout or launcher exit cannot leave an unowned MCP host behind. Without `--mcp`, the launcher opens the settings host and returns. Do not configure an MCP client to invoke `WindowUseHost.exe` directly: a Windows GUI process does not provide the required reliable stdio boundary here.

No separately opened UI application is required: the MCP launcher starts its host, and app-control permission requests automatically open a small approval window even after all product windows have been closed. Closing settings releases its window; closing an approval denies the pending requests. The host and tray remain connected, and a later permission request recreates the approval window. A client-side tool approval must reach this MCP before its local permission window can appear.

Stop active control with **Ctrl+Alt+F12**, the tray menu or the Stop button. Resume manually in settings. If another application reserves the shortcut, use the tray or settings. Use the tray's Quit action to terminate the host; reconnect the MCP client to start it again.

Settings are stored in `%APPDATA%\Azrael Window Use MCP\permissions.json`. Diagnostic metadata is stored in `%APPDATA%\Azrael Window Use MCP\logs\window-use.log`, with one rotated `.1` file. Logs exclude screenshot pixels, UI text and raw tool arguments. An explicit absolute `--user-data-dir <directory>` selects a separate settings/log profile. Extracting the portable application does not make its user data portable.

For a failed tool, correlate `mcp/request_failed` by outer `requestId`, `connectionId`, tool and UTC timestamp. `diagnostic` carries `window_use.native_failure`, native `requestId`, method, semantic action when applicable, elapsed milliseconds, response correlation and an HRESULT when available. `act` and `actionPoint` distinguish semantic control from cursor preparation. Keep `mutationOutcome` separate: `unknown` never permits automatic replay. Native diagnostics are also returned to the client; use only the needed record rather than exporting the whole profile. Historical releases that discarded HRESULT cannot recover it retrospectively. Source logging changes can be exercised with the development launcher and standard SDK; an already packaged immutable release still contains its prior code, and a reconnect alone does not update that package. This independent server does not require replacing VS Code or Azrael.

## Build a release

Maintainers need Windows x64, Node.js/npm, pinned dependencies from `npm ci`, the installed .NET Framework compiler at `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, Rust and MSVC for `npm run build:native`, and existing verified native runtimes. After source and acceptance inputs are stable, run `npm run package`. The packaging command never builds the full Azrael application.

The owner records planned outputs before execution, snapshots selected source and native runtimes, installs production dependencies from the frozen lockfile with `npm ci --omit=dev --ignore-scripts`, and packages an ASAR with `@electron/packager` **20.3.0** and Electron **45.2.3**. Native runtime resources are copied outside ASAR to `resources/runtime/{window-control,multi-pointer}`. Root native sources, tests, work records, build caches and development dependencies are excluded from the application.

Electron's installed `checksums.json` supplies the pinned distribution SHA-256. A matching Electron ZIP in the existing local Electron cache is reused after hashing. Otherwise `@electron/get` acquires and validates the ZIP in the current build's owned cache. Packager's `electronZipDir` points at the validated ZIP directory; its filenames follow `electron-v45.2.3-win32-x64.zip`. The installed packager contract states that `electronZipDir` bypasses `download` settings; `download.cacheRoot` is the alternative when letting packager own retrieval. This script validates acquisition itself instead of bypassing ZIP integrity checks.

The frozen `launcher/Program.cs` is compiled as an x64 console executable and copied alongside the Electron host; source, compiler and executable hashes are recorded. The supported `@electron/fuses` tool disables and rereads the **RunAsNode** fuse on `WindowUseHost.exe`. The launcher also removes inherited `ELECTRON_RUN_AS_NODE` from its child environment. This prevents a client's environment from replacing the application entry point. Node CLI inspection remains at Electron's existing value for packaged acceptance; no other fuse is changed. Exact resulting fuse values are recorded in `build-info.json`.

For source-only verification, the launcher accepts `--host <absolute Electron executable> --app <absolute project directory>` in addition to `--mcp`. Those two development options are consumed by the launcher; normal host arguments such as `--user-data-dir <absolute directory>` and `--remote-debugging-port=<port>` are forwarded. Packaged clients need no overrides. The launcher reserves `--mcp-pipe` for its authenticated internal transport and does not forward `--mcp` to the GUI host.

Each invocation creates a new immutable release identity:

```text
artifacts/releases/0.1.0-<build-id>/
  WindowUseMCP-win32-x64/
    WindowUseMCP.exe
    WindowUseHost.exe
    resources/app.asar
    resources/runtime/window-control/
    resources/runtime/multi-pointer/
  WindowUseMCP-0.1.0-win32-x64.zip
  SHA256SUMS.txt
  build-info.json
```

Packaging verifies exact ASAR contents, both native manifests and every ZIP member against the unpacked package, then rejects changed selected inputs or outputs. The manifest records source/runtime hashes, dependency contents, tool versions, fuse values and ZIP identity. `SHA256SUMS.txt` covers the ZIP, build information and unpacked files. Detailed logs and frozen inputs belong to `artifacts/logs/package-<build-id>` and `artifacts/build/package-<build-id>`; the command prints only its compact result summary. Existing release identities are never overwritten. These disposable build groups must be retired through the project artifact owner after acceptance and evidence handoff.

## Acceptance and publication status

Content-integrity proof does not establish successful desktop interaction. Each exact packaged build still needs settings/approval UI, stdio MCP and native desktop acceptance. The packaging manifest initially marks that behavior acceptance as pending. Live notification and overlay fixtures excluded from ordinary unit tests remain separate acceptance checks.

The current package has passed standard SDK stdio discovery, real approval/denial and UI Automation input, light/dark rendering, immutable self-protection, desktop masking, physical coordinate input with an observed button-click postcondition, Stop/resume and EOF shutdown on the current Windows x64 desktop. The work record preserves the exact package identity and result. This local acceptance does not establish a clean-machine install or individual third-party MCP client compatibility; those remain unverified.

This distribution is unsigned: no Authenticode certificate, installer, public upload, release publication or automatic updater is included. Windows may show an unknown-publisher or reputation prompt. SHA-256 manifests detect differences relative to the supplied build records; they do not replace publisher authentication. Publish only after explicit release authority and exact-package acceptance.
