# Pinned Azrael source

SOURCE.json records the original absolute paths, SHA-256 hashes and sizes of every copied source. Copies are taken from the current working tree, preserving its local edits. Native targets and build outputs are excluded.

The Rust native window-control crate, C++ multi-pointer broker and JavaScript policy/control modules were initially imported at the paths and hashes in SOURCE.json. Current local adaptations and dependency relocations are recorded in PATCHES.md. window-control-runtime.cjs is a standalone integrity-verifier adapter; it validates every native payload member and provenance and has no VS Code/engine dependency. The standalone runtime injects settings and approval owners instead of invoking lazy Azrael defaults.

The optional virtual-input driver and retired child-session host are not included. Existing desktop capture, masked capture, UI Automation and switched shared input remain implemented by the pinned native source. native/vendor/json contains only the JSON header and its MIT notice needed by multi-pointer. Native notices are retained and packaged in each runtime. The original repository license is distributed at the standalone repository root.
