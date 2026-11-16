use serde_json::Value;
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub struct Overlays {
    entries: HashMap<String, Entry>,
    next: u64,
}
struct Entry {
    label: String,
    updated: Instant,
}

#[derive(Clone, Copy, Debug)]
struct Display {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale: f64,
}

fn overlay_position(point: (f64, f64), displays: &[Display], logical: bool) -> Option<(i32, i32)> {
    if !point.0.is_finite() || !point.1.is_finite() {
        return None;
    }
    let bounds = |d: &Display| {
        let scale = if logical { d.scale } else { 1.0 };
        (d.x / scale, d.y / scale, d.width / scale, d.height / scale)
    };
    let display = displays
        .iter()
        .find(|display| {
            let (x, y, width, height) = bounds(display);
            point.0 >= x && point.0 < x + width && point.1 >= y && point.1 < y + height
        })
        .or_else(|| {
            displays.iter().min_by(|a, b| {
                let distance = |d: &Display| {
                    let (x, y, width, height) = bounds(d);
                    (point.0 - point.0.clamp(x, x + width)).powi(2)
                        + (point.1 - point.1.clamp(y, y + height)).powi(2)
                };
                distance(a).total_cmp(&distance(b))
            })
        })?;
    let (x, y, width, height) = bounds(display);
    let left = (point.0 - 10.0).clamp(x, x + (width - 150.0).max(0.0));
    let top = (point.1 - 4.0).clamp(y, y + (height - 64.0).max(0.0));
    let factor = if logical { display.scale } else { 1.0 };
    Some((
        (display.x + (left - x) * factor).round() as i32,
        (display.y + (top - y) * factor).round() as i32,
    ))
}

fn available(app: &AppHandle) -> Result<Vec<Display>, String> {
    if cfg!(target_os = "windows") {
        return Ok(Vec::new());
    }
    if cfg!(target_os = "linux")
        && (std::env::var_os("WAYLAND_DISPLAY").is_some_and(|v| !v.is_empty())
            || std::env::var("XDG_SESSION_TYPE")
                .is_ok_and(|value| value.eq_ignore_ascii_case("wayland")))
    {
        return Ok(Vec::new());
    }
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    if cfg!(target_os = "linux")
        && monitors
            .iter()
            .any(|m| (m.scale_factor() - 1.0).abs() > f64::EPSILON)
    {
        return Ok(Vec::new());
    }
    Ok(monitors
        .iter()
        .map(|m| Display {
            x: m.position().x as f64,
            y: m.position().y as f64,
            width: m.size().width as f64,
            height: m.size().height as f64,
            scale: m.scale_factor(),
        })
        .collect())
}

impl Overlays {
    pub fn handle(&mut self, app: &AppHandle, event: &Value) -> Result<(), String> {
        let data = &event["data"];
        match event["action"].as_str() {
            Some("dispose") => {
                for (_, entry) in self.entries.drain() {
                    if let Some(window) = app.get_webview_window(&entry.label) {
                        let _ = window.destroy();
                    }
                }
            }
            Some("release") => {
                if let Some(entry) = data["id"].as_str().and_then(|id| self.entries.remove(id)) {
                    if let Some(window) = app.get_webview_window(&entry.label) {
                        let _ = window.destroy();
                    }
                }
            }
            Some("visualize") => {
                let displays = available(app)?;
                if displays.is_empty() {
                    return Ok(());
                }
                let id = data["id"].as_str().ok_or("Invalid overlay identity")?;
                let point = (
                    data["point"]["x"].as_f64().ok_or("Invalid overlay x")?,
                    data["point"]["y"].as_f64().ok_or("Invalid overlay y")?,
                );
                let position = overlay_position(point, &displays, cfg!(target_os = "macos"))
                    .ok_or("Invalid overlay position")?;
                if !self.entries.contains_key(id) {
                    self.next += 1;
                    let label = format!("agent-overlay-{}", self.next);
                    let url = format!(
                        "window-use-overlay://localhost/index.html?agent={}",
                        self.next
                    )
                    .parse()
                    .map_err(|_| "Overlay URL")?;
                    let window =
                        WebviewWindowBuilder::new(app, &label, WebviewUrl::CustomProtocol(url))
                            .title("Azrael Agent cursor")
                            .decorations(false)
                            .transparent(true)
                            .shadow(false)
                            .inner_size(150.0, 64.0)
                            .resizable(false)
                            .visible(false)
                            .focused(false)
                            .focusable(false)
                            .skip_taskbar(true)
                            .always_on_top(true)
                            .visible_on_all_workspaces(true)
                            .devtools(false)
                            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                            .on_permission_request(|_, _| tauri::webview::PermissionResponse::Deny)
                            .on_navigation(|url| {
                                (url.scheme() == "window-use-overlay"
                                    && url.host_str() == Some("localhost")
                                    || url.scheme() == "http"
                                        && url.host_str() == Some("window-use-overlay.localhost"))
                                    && url.path() == "/index.html"
                            })
                            .build()
                            .map_err(|e| e.to_string())?;
                    // If pass-through cannot be established, never display the window.
                    if let Err(error) = window.set_ignore_cursor_events(true) {
                        let _ = window.destroy();
                        return Err(error.to_string());
                    }
                    self.entries.insert(
                        id.into(),
                        Entry {
                            label,
                            updated: Instant::now(),
                        },
                    );
                }
                let entry = self.entries.get_mut(id).unwrap();
                entry.updated = Instant::now();
                let label = entry.label.clone();
                if let Some(window) = app.get_webview_window(&label) {
                    window
                        .set_position(tauri::PhysicalPosition::new(position.0, position.1))
                        .map_err(|e| e.to_string())?;
                    let active = data["phase"].as_str().unwrap_or("active") == "active";
                    let _ = window.eval(if active {
                        "document.body.style.opacity='1'"
                    } else {
                        "document.body.style.opacity='.4'"
                    });
                    window.show().map_err(|e| e.to_string())?;
                    if active {
                        let app = app.clone();
                        let updated = entry.updated;
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(Duration::from_secs(1)).await;
                            let owner = app.state::<crate::desktop::Desktop>();
                            let overlays = owner.overlays.lock().unwrap();
                            if overlays
                                .entries
                                .values()
                                .any(|entry| entry.label == label && entry.updated == updated)
                            {
                                if let Some(window) = app.get_webview_window(&label) {
                                    let _ = window.eval("document.body.style.opacity='.4'");
                                }
                            }
                        });
                    }
                }
            }
            _ => return Err("Unknown cosmetic overlay event".into()),
        }
        Ok(())
    }
}

pub fn page(uri: &tauri::http::Uri) -> tauri::http::Response<Vec<u8>> {
    let agent = uri
        .query()
        .and_then(|query| query.strip_prefix("agent="))
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let hue = ((agent as f64 * 137.50776405 + 240.0) % 360.0).round() as u16;
    let html = include_str!("overlay.html")
        .replace("{{agent}}", &agent.to_string())
        .replace("{{hue}}", &hue.to_string());
    tauri::http::Response::builder().header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'")
        .body(html.into_bytes()).expect("Static overlay response")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn logical_points_map_to_target_display_pixels_and_clamp() {
        let displays = [
            Display {
                x: 0.0,
                y: 0.0,
                width: 2880.0,
                height: 1800.0,
                scale: 2.0,
            },
            Display {
                x: -1920.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
                scale: 1.0,
            },
        ];
        assert_eq!(
            overlay_position((100.0, 100.0), &displays, true),
            Some((180, 192))
        );
        assert_eq!(
            overlay_position((-1800.0, 100.0), &displays, true),
            Some((-1810, 96))
        );
        assert_eq!(
            overlay_position((1439.0, 899.0), &displays, true),
            Some((2580, 1672))
        );
        assert_eq!(overlay_position((f64::NAN, 1.0), &displays, true), None);
    }
}
