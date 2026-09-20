#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Sur Wayland natif, le protocole interdit le « always on top » :
    // GTK ignore `set_keep_above` et le chat passe derrière les fenêtres.
    // On force le backend X11 (XWayland), où GNOME honore cet état.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some() && std::env::var_os("GDK_BACKEND").is_none() {
        // Safety : appelé au tout début de `main`, avant tout autre thread.
        unsafe { std::env::set_var("GDK_BACKEND", "x11") };
    }

    bongo_cat_lib::run()
}
