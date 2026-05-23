use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Emitter, Manager, RunEvent,
};

// Files queued by macOS (via Finder double-click or `open -a Caret …`) before
// any webview is ready to receive them. Drained by the frontend on mount and
// in response to `caret:drain_paths` nudges.
#[derive(Default)]
struct PendingPaths(Mutex<Vec<String>>);

#[tauri::command]
fn take_pending_paths(state: tauri::State<PendingPaths>) -> Vec<String> {
    let mut guard = state.0.lock().expect("pending paths mutex poisoned");
    std::mem::take(&mut *guard)
}

fn enqueue_and_nudge(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    {
        let state = app.state::<PendingPaths>();
        let mut guard = state.0.lock().expect("pending paths mutex poisoned");
        guard.extend(paths);
    }
    // Wake whichever webview is up so it pulls the queue. If none exists yet
    // (cold launch), the frontend will drain on mount.
    let windows = app.webview_windows();
    let target = windows
        .iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .or_else(|| windows.iter().next());
    if let Some((label, _)) = target {
        let _ = app.emit_to(label.as_str(), "caret:drain_paths", ());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(PendingPaths::default())
        .invoke_handler(tauri::generate_handler![take_pending_paths])
        .setup(|app| {
            let new_file = MenuItemBuilder::with_id("new_file", "New File")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;
            let new_window = MenuItemBuilder::with_id("new_window", "New Window")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?;
            let open_file = MenuItemBuilder::with_id("open_file", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let save_file = MenuItemBuilder::with_id("save_file", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;
            let save_as_file = MenuItemBuilder::with_id("save_as_file", "Save As...")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "Caret")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_file)
                .item(&new_window)
                .separator()
                .item(&open_file)
                .separator()
                .item(&save_file)
                .item(&save_as_file)
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .separator()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let event_name = match event.id().as_ref() {
                "new_file" => "menu:new_file",
                "new_window" => "menu:new_window",
                "open_file" => "menu:open_file",
                "save_file" => "menu:save_file",
                "save_as_file" => "menu:save_as_file",
                _ => return,
            };
            // Route to the focused window so per-window state (current path,
            // dirty buffer) is acted on by the right document. `emit` would
            // broadcast to every listener — Tauri targets events globally
            // unless you use `emit_to` with a specific label.
            for (label, w) in app.webview_windows() {
                if w.is_focused().unwrap_or(false) {
                    let _ = app.emit_to(label.as_str(), event_name, ());
                    return;
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        if let RunEvent::Opened { urls } = event {
            let paths: Vec<String> = urls
                .into_iter()
                .filter_map(|u| u.to_file_path().ok())
                .filter_map(|p| p.to_str().map(|s| s.to_string()))
                .collect();
            enqueue_and_nudge(app, paths);
        }
    });
}
