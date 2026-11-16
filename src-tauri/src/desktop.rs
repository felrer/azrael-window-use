use crate::{layout::Layout, native, overlay::Overlays, worker::Worker};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    ffi::OsString,
    sync::{atomic::Ordering, Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub struct Desktop {
    pub worker: Arc<Worker>,
    pub overlays: Mutex<Overlays>,
    health: Mutex<HashMap<String, Instant>>,
}

fn local_ui(url: &tauri::Url) -> bool {
    ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost")))
        && url.path() == "/ui/index.html"
        && url.query().is_none()
        && url.fragment().is_none()
}

fn trusted_view(window: &WebviewWindow) -> Result<String, String> {
    let label = window.label();
    if !matches!(label, "settings" | "approval")
        || !local_ui(&window.url().map_err(|e| e.to_string())?)
    {
        return Err("Untrusted Window Use UI sender".into());
    }
    Ok(label.into())
}

#[tauri::command]
async fn snapshot(
    window: WebviewWindow,
    state: tauri::State<'_, Desktop>,
) -> Result<Value, String> {
    let view = trusted_view(&window)?;
    state
        .health
        .lock()
        .unwrap()
        .insert(view.clone(), Instant::now());
    state.worker.request("snapshot", &view, json!({})).await
}

#[tauri::command]
async fn command(
    window: WebviewWindow,
    state: tauri::State<'_, Desktop>,
    action: String,
    payload: Value,
) -> Result<Value, String> {
    let view = trusted_view(&window)?;
    if !payload.is_object() {
        return Err("Command payload must be an object".into());
    }
    let result = state
        .worker
        .request("command", &view, json!({"action":action,"payload":payload}))
        .await?;
    // The service validates every action and its exact fields before local effects.
    match action.as_str() {
        "minimize" => window.minimize().map_err(|e| e.to_string())?,
        "close" => window.close().map_err(|e| e.to_string())?,
        _ => (),
    }
    Ok(result)
}

#[tauri::command]
fn start_dragging(window: WebviewWindow) -> Result<(), String> {
    trusted_view(&window)?;
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn ui_health(
    window: WebviewWindow,
    state: tauri::State<'_, Desktop>,
    failed: bool,
) -> Result<(), String> {
    let view = trusted_view(&window)?;
    state
        .health
        .lock()
        .unwrap()
        .insert(view.clone(), Instant::now());
    if failed {
        stop(&window.app_handle().clone());
        let worker = state.worker.clone();
        tauri::async_runtime::spawn(async move {
            let _ = worker.request("closed", &view, json!({})).await;
        });
    }
    Ok(())
}

pub fn stop(app: &AppHandle) {
    let worker = app.state::<Desktop>().worker.clone();
    tauri::async_runtime::spawn(async move {
        let _ = worker.request("stop", "settings", json!({})).await;
    });
}

pub fn shutdown(app: &AppHandle) {
    let worker = app.state::<Desktop>().worker.clone();
    if worker.stopping.swap(true, Ordering::AcqRel) {
        return;
    }
    // Never block the GUI thread: native app dialogs and worker cleanup need it.
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = worker.send(json!({"id":0,"method":"shutdown","view":"settings","params":{}}));
        for _ in 0..200 {
            if worker.exited.load(Ordering::Acquire) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if !worker.exited.load(Ordering::Acquire) {
            eprintln!("Window Use service did not finish shutdown within 10 seconds");
            worker.terminate();
            for _ in 0..40 {
                if worker.exited.load(Ordering::Acquire) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            worker.exiting.store(true, Ordering::Release);
            app.exit(1);
        } else {
            worker.exiting.store(true, Ordering::Release);
            app.exit(0);
        }
    });
}

pub fn show(app: &AppHandle, view: &str) -> Result<(), String> {
    if !matches!(view, "settings" | "approval") {
        return Err("Unknown window view".into());
    }
    if app
        .state::<Desktop>()
        .worker
        .stopping
        .load(Ordering::Acquire)
    {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window(view) {
        window.unminimize().map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    app.state::<Desktop>()
        .health
        .lock()
        .unwrap()
        .insert(view.into(), Instant::now());
    let window = WebviewWindowBuilder::new(app, view, WebviewUrl::App("ui/index.html".into()))
        .title("Azrael Window Use")
        .decorations(false)
        .visible(false)
        .inner_size(440.0, if view == "approval" { 460.0 } else { 720.0 })
        .min_inner_size(400.0, if view == "approval" { 380.0 } else { 520.0 })
        .resizable(true)
        .devtools(false)
        .disable_drag_drop_handler()
        .on_navigation(local_ui)
        .on_web_resource_request(|request, response| {
            // Keep the existing renderer filename. Tauri's MIME fallback for
            // unknown .cjs assets is text/html, which WebViews reject as script.
            if request.uri().path() == "/ui/renderer.cjs" {
                response.headers_mut().insert(
                    tauri::http::header::CONTENT_TYPE,
                    tauri::http::HeaderValue::from_static("text/javascript; charset=utf-8"),
                );
            }
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_permission_request(|_, _| tauri::webview::PermissionResponse::Deny)
        .on_download(|_, _| false)
        .on_page_load(|window, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                if !local_ui(payload.url()) {
                    stop(window.app_handle());
                    return;
                }
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    let app_handle = app.clone();
    let view = view.to_owned();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { .. } => {
            let worker = app_handle.state::<Desktop>().worker.clone();
            if !worker.stopping.load(Ordering::Acquire) {
                let view = view.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = worker.request("closed", &view, json!({})).await;
                });
            }
        }
        tauri::WindowEvent::Destroyed => {
            app_handle
                .state::<Desktop>()
                .health
                .lock()
                .unwrap()
                .remove(&view);
        }
        _ => (),
    });
    Ok(())
}

fn on_message(app: &AppHandle, message: Value) {
    match message["event"].as_str() {
        Some("snapshot") => {
            let Some(view) = message["view"]
                .as_str()
                .filter(|v| matches!(*v, "settings" | "approval"))
            else {
                return;
            };
            if let Some(window) = app.get_webview_window(view) {
                let snapshot = &message["snapshot"];
                let theme = match snapshot["theme"].as_str() {
                    Some("dark") => Some(tauri::Theme::Dark),
                    Some("light") => Some(tauri::Theme::Light),
                    _ => None,
                };
                let _ = window.set_theme(theme);
                let _ = window.emit("window-use:changed", snapshot);
                if view == "approval" && snapshot["approvals"].as_array().is_some_and(Vec::is_empty)
                {
                    let _ = window.hide();
                }
            }
            if let Some(tray) = app.tray_by_id("window-use") {
                let snapshot = &message["snapshot"];
                let tooltip = if snapshot["connection"]["stopped"] == true {
                    "Azrael Window Use · 중지됨"
                } else if snapshot["connection"]["connected"] == true {
                    "Azrael Window Use · 연결됨"
                } else {
                    "Azrael Window Use"
                };
                let _ = tray.set_tooltip(Some(tooltip));
            }
        }
        Some("show") => {
            if let Some(view) = message["view"].as_str() {
                if let Err(error) = show(app, view) {
                    eprintln!("Window Use UI failed: {error}");
                    stop(app);
                }
            }
        }
        Some("shutdown") => shutdown(app),
        Some("nativeRequest") => native::request(app, message),
        Some("overlay") => {
            if let Err(error) = app
                .state::<Desktop>()
                .overlays
                .lock()
                .unwrap()
                .handle(app, &message)
            {
                eprintln!("Window Use cosmetic overlay unavailable: {error}");
            }
        }
        Some("workerPipeClosed") => {
            if !app
                .state::<Desktop>()
                .worker
                .stopping
                .load(Ordering::Acquire)
            {
                eprintln!("Window Use worker protocol disconnected");
                stop(app);
                shutdown(app);
            }
        }
        _ => (),
    }
}

pub fn run(layout: Layout, arguments: Vec<OsString>) -> Result<(), String> {
    let (worker, output) = Worker::spawn(&layout, &arguments)?;
    let setup_worker = worker.clone();
    let mut output = Some(output);
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        stop(app);
                    }
                })
                .build(),
        )
        .register_uri_scheme_protocol("window-use-overlay", |_, request| {
            crate::overlay::page(request.uri())
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            command,
            start_dragging,
            ui_health
        ])
        .manage(Desktop {
            worker: worker.clone(),
            overlays: Mutex::new(Overlays::default()),
            health: Mutex::new(HashMap::new()),
        })
        .setup(move |app| {
            let settings =
                tauri::menu::MenuItem::with_id(app, "settings", "설정", true, None::<&str>)?;
            let stop_item = tauri::menu::MenuItem::with_id(
                app,
                "stop",
                "중지 (Ctrl/Cmd+Alt+F12)",
                true,
                None::<&str>,
            )?;
            let quit = tauri::menu::MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&settings, &stop_item, &quit])?;
            tauri::tray::TrayIconBuilder::with_id("window-use")
                .icon(tauri::image::Image::from_bytes(include_bytes!(
                    "../../src/assets/app-icon-64.png"
                ))?)
                .tooltip("Azrael Window Use")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "settings" => {
                        if let Err(error) = show(app, "settings") {
                            eprintln!("{error}");
                            stop(app);
                        }
                    }
                    "stop" => stop(app),
                    "quit" => shutdown(app),
                    _ => (),
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if show(tray.app_handle(), "settings").is_err() {
                            stop(tray.app_handle());
                        }
                    }
                })
                .build(app)?;
            app.global_shortcut().register("CommandOrControl+Alt+F12")?;
            let handle = app.handle().clone();
            let reader_handle = handle.clone();
            let reader_worker = setup_worker.clone();
            let output = output.take().ok_or("Worker output already consumed")?;
            std::thread::spawn(move || {
                reader_worker.read(output, move |message| {
                    let app = reader_handle.clone();
                    let dispatch = app.clone();
                    let _ = app.run_on_main_thread(move || on_message(&dispatch, message));
                })
            });
            let monitor_handle = handle.clone();
            let monitor_worker = setup_worker.clone();
            setup_worker.clone().monitor(move |code| {
                if !monitor_worker.stopping.load(Ordering::Acquire) {
                    eprintln!("Window Use service exited unexpectedly ({code})");
                    monitor_worker.exiting.store(true, Ordering::Release);
                    monitor_handle.exit(if code == 0 { 1 } else { code });
                }
            });
            // Tauri has no portable web-content-process crash notification. A private
            // heartbeat detects a silent renderer failure and revokes grants via Stop.
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    let state = handle.state::<Desktop>();
                    if state.worker.stopping.load(Ordering::Acquire) {
                        break;
                    }
                    let failed = state
                        .health
                        .lock()
                        .unwrap()
                        .values()
                        .any(|last| last.elapsed() > Duration::from_secs(30));
                    if failed {
                        stop(&handle);
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .map_err(|e| {
            worker.terminate();
            format!("Tauri bootstrap failed: {e}")
        })?;
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
            if !app
                .state::<Desktop>()
                .worker
                .exiting
                .load(Ordering::Acquire)
            {
                api.prevent_exit();
                // Closing the last settings/approval window keeps the service alive.
                if code.is_some() {
                    shutdown(app);
                }
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_packaged_ui_document_is_trusted() {
        for url in [
            "tauri://localhost/ui/index.html",
            "http://tauri.localhost/ui/index.html",
        ] {
            assert!(local_ui(&url.parse().unwrap()));
        }
        for url in [
            "https://example.com/ui/index.html",
            "file:///ui/index.html",
            "tauri://localhost/ui/other.html",
            "http://tauri.localhost/ui/index.html?view=settings",
        ] {
            assert!(!local_ui(&url.parse().unwrap()));
        }
    }
}
