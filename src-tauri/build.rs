fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "snapshot",
            "command",
            "start_dragging",
            "ui_health",
        ]),
    ))
    .expect("Tauri build configuration");
}
