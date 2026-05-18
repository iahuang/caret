use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
