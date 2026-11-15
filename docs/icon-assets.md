# Window Use icon and Agent cursor

Status: implemented for the independent Windows x64 MCP. This does not replace
Azrael's separate application icon or install its bundled native runtime.

`src/assets/cursor-geometry.cjs` owns the Fluent-derived Agent outline: radius
1.2, unchanged leg angle, and one closed tangent-continuous cubic contour. Every
Agent palette entry and presentation state uses the generated native `modelBody`.
The physical/system user cursor is unchanged. `CURSOR-NOTICES.md` owns attribution.

`scripts/generate-cursor-assets.cjs` writes the native model vector, logo study's
shared path and `src/assets/app-icon.svg`. The approved 256-unit layout is front
center (118,146), rear (170,103), height139, rear scale100%, rear opacity50%, total
scale100%; purple #A78BFA, mint #34D399, white outline0.9 source units, dark #242426
tile with radius56. Opacity applies to the rear fill and outline together.

The cubic contour replaces SVG circular-arc stroke joins that can render tiny
inward artifacts. Tangency and crown boundary monotonicity are verification
criteria. Regenerate PNG/ICO using `node scripts/render-app-icon.cjs ABSOLUTE_PROFILE`
with a task-owned disposable profile. It uses installed Chrome and Playwright,
4x supersampling and downsampling. No runtime browser or external asset fetch is
required. ICO contains 16/20/24/32/40/48/64/128/256 pixel PNG frames.

Electron's tray uses ICO, BrowserWindow uses PNG256, and the local titlebar uses
PNG32. Development and release launchers embed ICO via the .NET `/win32icon`
option; packaged Electron host receives the same ICO via packager. Development
launcher identities hash source and ICO so running instances are not overwritten.

Verification: `node --test tests/cursor-assets.test.cjs`, JS suite, actual Chromium
small/large rendering, Electron asset loading, native render selftest including
light/dark and DPI anchoring. Installed independent MCP acceptance is recorded in
the work plan; clean-machine packaged acceptance is separate.
