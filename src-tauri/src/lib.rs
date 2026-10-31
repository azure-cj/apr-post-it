//! APG Post-It's Rust shell.
//!
//! Rust does only what the WebView can't (docs/plans/TAURI-PLAN.md §2). Every rule —
//! the posting-text split, the checks, the cooldown, queues — is TypeScript, so it can
//! move to a Cloud Function as it is. What lives here:
//!
//! - `save_photos`: photos from Google Drive into `Downloads\APG Post-It\<listing>`.
//! - `read_key` / `write_key`: the person's key, kept by the OS credential store.
//! - The plugins, each scoped in `capabilities/default.json`: the clipboard (write
//!   only), HTTP (Google only), the file system (the app's own folders only),
//!   dialogs, opening links and the photo folders, one window per PC, the
//!   window's place and size, and a small settings store.

mod hosts;
mod key;
mod names;
mod photos;

use tauri::Manager;

#[cfg(desktop)]
use tauri_plugin_window_state::StateFlags;

/// The one window, as labelled in `tauri.conf.json`.
const MAIN_WINDOW: &str = "main";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder
            // Registered first, as the plugin requires: a second launch hands over
            // to the first and exits, and the first comes to the front.
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                bring_to_front(app);
            }))
            // Restores the window's place, size and maximised state before it is
            // shown, so it never opens in one place and jumps to another.
            .plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_state_flags(
                        StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                    )
                    .build(),
            );
    }

    builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            photos::save_photos,
            key::read_key,
            key::write_key,
        ])
        .setup(|app| {
            // The window starts hidden (tauri.conf.json) so it can be put back
            // where it was first. Its background is the theme's, so showing it
            // before the page has painted is dark, not a white flash.
            bring_to_front(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("APG Post-It could not start");
}

fn bring_to_front<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    // Only when minimised: restoring a window that isn't would un-maximise it.
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    let _ = window.set_focus();
}
