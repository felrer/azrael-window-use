#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod desktop;
mod layout;
mod native;
mod overlay;
mod worker;

fn main() {
    let arguments: Vec<_> = std::env::args_os().skip(1).collect();
    let result = layout::Layout::resolve().and_then(|layout| {
        // This branch must precede any Tauri context/event-loop/WebView creation.
        if layout::is_stdio(&arguments) || !arguments.iter().any(|arg| arg == "--shared-service") {
            layout.run_stdio(&arguments)
        } else {
            desktop::run(layout, arguments).map(|_| 0)
        }
    });
    match result {
        Ok(code) => std::process::exit(code),
        Err(error) => {
            eprintln!("Window Use host failed: {error}");
            std::process::exit(1);
        }
    }
}
