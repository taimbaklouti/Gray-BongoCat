use gilrs::{EventType, Gilrs};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime, command};

static IS_LISTENING: AtomicBool = AtomicBool::new(false);

/// Seuil sous lequel le bruit des sticks (xinput notamment) est ignoré :
/// sans ça, chaque micro-variation émet un event Tauri → saccades.
const AXIS_DEADZONE: f32 = 0.05;

/// Fréquence de polling du gamepad (~200 Hz : réactif sans brûler un cœur).
const POLL_INTERVAL: Duration = Duration::from_millis(5);

#[derive(Debug, Clone, Serialize)]
pub enum GamepadEventKind {
    ButtonChanged,
    AxisChanged,
}

#[derive(Debug, Clone, Serialize)]
pub struct GamepadEvent {
    kind: GamepadEventKind,
    name: String,
    value: f32,
}

#[command]
pub async fn start_gamepad_listing<R: Runtime>(app_handle: AppHandle<R>) -> Result<(), String> {
    if IS_LISTENING.load(Ordering::SeqCst) {
        return Ok(());
    }

    IS_LISTENING.store(true, Ordering::SeqCst);

    let mut gilrs = Gilrs::new().map_err(|err| err.to_string())?;

    // Thread dédié (et non boucle sur le runtime async) : la boucle d'avant
    // ne cédait jamais la main et brûlait 100 % d'un cœur, même sans manette.
    std::thread::spawn(move || {
        // Dernier état émis par (kind, name) : déduplique les répétitions.
        let mut last_values: std::collections::HashMap<(u8, String), f32> =
            std::collections::HashMap::new();

        while IS_LISTENING.load(Ordering::SeqCst) {
            while let Some(event) = gilrs.next_event() {
                let gamepad_event = match event.event {
                    EventType::ButtonChanged(button, value, ..) => GamepadEvent {
                        kind: GamepadEventKind::ButtonChanged,
                        name: format!("{:?}", button),
                        value,
                    },
                    EventType::AxisChanged(axis, value, ..) => GamepadEvent {
                        kind: GamepadEventKind::AxisChanged,
                        name: format!("{:?}", axis),
                        value,
                    },
                    _ => continue,
                };

                let kind_id = match gamepad_event.kind {
                    GamepadEventKind::ButtonChanged => 0,
                    GamepadEventKind::AxisChanged => 1,
                };

                // Deadzone avec snap à zéro : le bruit autour de zéro devient
                // un vrai 0 émis UNE fois (le retour au neutre est signalé,
                // les répétitions ensuite sont dédupliquées ci-dessous).
                let value = if kind_id == 1 && gamepad_event.value.abs() < AXIS_DEADZONE {
                    0.0
                } else {
                    gamepad_event.value
                };

                // Dédupe : n'émet que si la valeur a réellement changé.
                let key = (kind_id, gamepad_event.name.clone());

                if last_values.get(&key) == Some(&value) {
                    continue;
                }

                last_values.insert(key, value);

                let _ = app_handle.emit(
                    "gamepad-changed",
                    GamepadEvent {
                        value,
                        ..gamepad_event
                    },
                );
            }

            std::thread::sleep(POLL_INTERVAL);
        }
    });

    Ok(())
}

#[command]
pub async fn stop_gamepad_listing() {
    if !IS_LISTENING.load(Ordering::SeqCst) {
        return;
    }

    IS_LISTENING.store(false, Ordering::SeqCst);
}
