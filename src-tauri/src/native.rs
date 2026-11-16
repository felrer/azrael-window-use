use crate::desktop::Desktop;
use base64::Engine;
use serde_json::{json, Value};
use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

fn local_path(value: &str) -> bool {
    if cfg!(windows) {
        let bytes = value.as_bytes();
        bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'\\' | b'/')
    } else {
        Path::new(value).is_absolute()
    }
}

fn icon(executable: &str) -> Option<String> {
    if !local_path(executable) {
        return None;
    }
    let icon = file_icon_provider::get_file_icon(executable, 32).ok()?;
    if icon.width == 0
        || icon.height == 0
        || icon.width > 512
        || icon.height > 512
        || icon.pixels.len() != (icon.width * icon.height * 4) as usize
    {
        return None;
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, icon.width, icon.height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .ok()?
            .write_image_data(&icon.pixels)
            .ok()?;
    }
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

pub fn request(app: &AppHandle, message: Value) {
    let Some(id) = message.get("id").cloned() else {
        return;
    };
    let worker = app.state::<Desktop>().worker.clone();
    if worker.stopping.load(std::sync::atomic::Ordering::Acquire) {
        let _ = worker.send(json!({"nativeResponse":id,"error":{"code":"host_closing","message":"Window Use host is closing"}}));
        return;
    }
    // These requests only originate in the trusted Node worker, never the UI.
    // On Linux the system icon library requires GTK's main thread.
    match message["method"].as_str() {
        Some("getFileIcon") => {
            let result = message["params"]["executable"].as_str().and_then(icon);
            let _ = worker.send(json!({"nativeResponse":id,"result":result}));
        }
        Some("pickApp") if message["view"].as_str() == Some("settings") => {
            let Some(window) = app.get_webview_window("settings") else {
                let _ = worker.send(json!({"nativeResponse":id,"result":null}));
                return;
            };
            let title = if message["params"]["action"] == "addProtectedApp" {
                "보호할 앱 선택"
            } else {
                "허용할 앱 선택"
            };
            let picker = app.dialog().file().set_title(title).set_parent(&window);
            #[cfg(windows)]
            let picker = picker.add_filter("Windows 앱", &["exe"]);
            picker.pick_file(move |selection| {
                let result = selection
                    .and_then(|file| file.into_path().ok())
                    .filter(|path| path.is_absolute())
                    .map(|path| path.to_string_lossy().into_owned());
                let _ = worker.send(json!({"nativeResponse":id,"result":result}));
            });
        }
        _ => {
            let _ = worker.send(json!({"nativeResponse":id,"error":{"code":"invalid_arguments","message":"Unsupported native host request"}}));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn icons_reject_nonlocal_paths_without_querying_the_system() {
        assert!(!local_path("relative.exe"));
        assert!(!local_path("https://example.com/app.exe"));
        #[cfg(windows)]
        {
            assert!(!local_path(r"\\server\share\app.exe"));
            assert!(!local_path(r"\\?\C:\app.exe"));
            assert!(local_path(r"C:\Windows\System32\notepad.exe"));
        }
    }
}
