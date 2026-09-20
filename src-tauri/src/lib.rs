mod core;
mod utils;

use core::{
    device::start_device_listening,
    gamepad::{start_gamepad_listing, stop_gamepad_listing},
    prevent_default, setup,
};
use tauri::{Manager, WindowEvent, generate_handler};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_custom_window::{
    MAIN_WINDOW_LABEL, PREFERENCE_WINDOW_LABEL, show_preference_window,
};
use utils::fs_extra::copy_dir;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();

            let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
                eprintln!("BongoCat: main window not found, skipping setup");

                return Ok(());
            };

            let Some(preference_window) = app.get_webview_window(PREFERENCE_WINDOW_LABEL) else {
                eprintln!("BongoCat: preference window not found, skipping setup");

                return Ok(());
            };

            setup::default(&app_handle, main_window.clone(), preference_window.clone());

            // S-2, filet de sécurité : la fenêtre main démarre masquée
            // (visible:false) et c'est le frontend qui l'affiche à la première
            // frame (+ timer de secours). Si le frontend meurt avant, on
            // l'affiche quand même après 12s pour ne jamais laisser l'app
            // invisible. Hors macOS (nspanel géré par le plugin dédié).
            #[cfg(not(target_os = "macos"))]
            {
                let fallback_window = main_window.clone();

                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(12));

                    if let Ok(visible) = fallback_window.is_visible() {
                        if !visible {
                            let _ = fallback_window.show();
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(generate_handler![
            copy_dir,
            start_device_listening,
            start_gamepad_listing,
            stop_gamepad_listing
        ])
        .plugin(tauri_plugin_admin_status::init())
        .plugin(tauri_plugin_custom_window::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_pinia::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(prevent_default::init())
        .plugin(tauri_plugin_single_instance::init(
            |app_handle, _argv, _cwd| {
                show_preference_window(app_handle);
            },
        ))
        .plugin(
            tauri_plugin_log::Builder::new()
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .filter(|metadata| !metadata.target().contains("gilrs"))
                // Console masquée en release Windows (windows_subsystem) :
                // les logs restent consultables dans le dossier de logs OS.
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("BongoCat".into()),
                    },
                ))
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_locale::init())
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();

                api.prevent_close();
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            show_preference_window(app_handle);
        }
        _ => {
            let _ = app_handle;
        }
    });
}
