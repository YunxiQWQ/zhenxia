use once_cell::sync::Lazy;
use std::str::FromStr;
use std::sync::Mutex;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool,AtomicU64,Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const WIN_V_BRIDGE_SHORTCUT: &str = "Win+Alt+V";

#[derive(Clone, Default, PartialEq, Eq)]
struct ShortcutConfiguration {
    hotkey: Option<String>,
    replace_win_v: bool,
    screenshot_hotkey: Option<String>,
    pin_hotkey: Option<String>,
    extra: BTreeMap<String,String>,
}

static CURRENT_CONFIGURATION: Lazy<Mutex<ShortcutConfiguration>> =
    Lazy::new(|| Mutex::new(ShortcutConfiguration::default()));

#[derive(Clone, serde::Serialize)]
pub struct HotkeyStartupNotice {
    pub kind: String,
    pub requested_hotkey: String,
    pub active_hotkey: Option<String>,
}

static STARTUP_NOTICE: Lazy<Mutex<Option<HotkeyStartupNotice>>> = Lazy::new(|| Mutex::new(None));

pub fn record_startup_notice(kind: &str, requested_hotkey: &str, active_hotkey: Option<&str>) {
    *STARTUP_NOTICE.lock().unwrap() = Some(HotkeyStartupNotice {
        kind: kind.to_string(),
        requested_hotkey: requested_hotkey.to_string(),
        active_hotkey: active_hotkey.map(str::to_string),
    });
}

#[tauri::command]
pub fn get_hotkey_startup_notice() -> Option<HotkeyStartupNotice> {
    STARTUP_NOTICE.lock().unwrap().take()
}

fn parser_hotkey(hotkey: &str) -> String {
    hotkey
        .split('+')
        .map(|token| {
            let trimmed = token.trim();
            if trimmed.eq_ignore_ascii_case("win") || trimmed.eq_ignore_ascii_case("windows") {
                "Super"
            } else {
                trimmed
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

pub fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible_and_focused =
            window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false);
        crate::request_flyout_toggle(&window, visible_and_focused);
    }
}

#[derive(Clone, Copy)]
enum ShortcutAction {
    ToggleHistory,
    Screenshot,
    PinClipboard,
    CaptureHistory,
    Settings,
    Translate,
    RegionOcr,
    RegionTranslate,
    HidePins,
    ScrollCapture, RecordScreen, Presentation,
}

fn extra_action(id:&str)->Result<ShortcutAction,String>{match id{"capture_history"=>Ok(ShortcutAction::CaptureHistory),"open_settings"=>Ok(ShortcutAction::Settings),"translate"=>Ok(ShortcutAction::Translate),"region_ocr"=>Ok(ShortcutAction::RegionOcr),"region_translate"=>Ok(ShortcutAction::RegionTranslate),"hide_pins"=>Ok(ShortcutAction::HidePins),"scroll_capture"=>Ok(ShortcutAction::ScrollCapture),"record_screen"=>Ok(ShortcutAction::RecordScreen),"presentation"=>Ok(ShortcutAction::Presentation),_=>Err("Unknown shortcut action".into())}}
fn canonical(value:&str)->Result<String,String>{Shortcut::from_str(&parser_hotkey(value)).map(|k|k.to_string()).map_err(|_|format!("无效快捷键：{value}"))}
pub fn validate_local(bindings:&BTreeMap<String,String>)->Result<(),String>{
    let mut complete=crate::capture_preferences::CapturePreferences::default().shortcuts;let mut seen=BTreeMap::new();
    for (action,value) in bindings {if !complete.contains_key(action){return Err(format!("Unknown key action: {action}"));}complete.insert(action.clone(),value.clone());}
    for (action,value) in &complete {if value.is_empty(){continue;}let key=canonical(value)?;if let Some(other)=seen.insert(key,action){return Err(format!("快捷键冲突：{other} / {action}"));}}
    Ok(())
}
pub fn validate_preferences(settings:&crate::models::AppSettings)->Result<(),String>{
    let mut global=std::collections::HashSet::new();
    for key in [&settings.hotkey,&settings.screenshot_hotkey,&settings.pin_hotkey].into_iter().chain(settings.capture.global_hotkeys.values()){if !key.is_empty(){global.insert(canonical(key)?);}}
    if settings.replace_win_v{global.insert(canonical(WIN_V_BRIDGE_SHORTCUT)?);}
    let mut local=crate::capture_preferences::CapturePreferences::default().shortcuts;local.extend(settings.capture.shortcuts.clone());
    for (action,key) in local {if !key.is_empty()&&global.contains(&canonical(&key)?){return Err(format!("{action} 的 {key} 与全局快捷键冲突"));}}
    Ok(())
}
static RECORDING:AtomicBool=AtomicBool::new(false);
static RECORDING_GENERATION:AtomicU64=AtomicU64::new(0);
#[tauri::command]
pub fn set_shortcut_recording(app:AppHandle,active:bool)->Result<(),String>{
    if active {
        if RECORDING.swap(true,Ordering::AcqRel){return Ok(());}
        let generation=RECORDING_GENERATION.fetch_add(1,Ordering::AcqRel)+1;
        if let Err(error)=app.global_shortcut().unregister_all(){RECORDING.store(false,Ordering::Release);return Err(error.to_string());}
        tauri::async_runtime::spawn(async move{tokio::time::sleep(std::time::Duration::from_secs(30)).await;if RECORDING_GENERATION.load(Ordering::Acquire)==generation&&RECORDING.swap(false,Ordering::AcqRel){let previous=CURRENT_CONFIGURATION.lock().unwrap().clone();let _=register_configuration_without_fallback(&app,&previous);let _=app.emit("shortcut-recording-ended",());}});
    }else {RECORDING_GENERATION.fetch_add(1,Ordering::AcqRel);if RECORDING.swap(false,Ordering::AcqRel){let previous=CURRENT_CONFIGURATION.lock().unwrap().clone();register_configuration_without_fallback(&app,&previous)?;}}
    Ok(())
}

pub fn register_shortcuts_for(app:&AppHandle,settings:&crate::models::AppSettings)->Result<(),String>{register_shortcuts_with_extra(app,&settings.hotkey,settings.replace_win_v,settings.screenshot_hotkey.clone(),settings.pin_hotkey.clone(),settings.capture.global_hotkeys.clone(),true)}
#[tauri::command]pub fn get_shortcut_status()->serde_json::Value{let c=CURRENT_CONFIGURATION.lock().unwrap();let mut active=c.extra.clone();for (id,value) in [("hotkey",&c.hotkey),("screenshot_hotkey",&c.screenshot_hotkey),("pin_hotkey",&c.pin_hotkey)]{if let Some(value)=value{if !value.is_empty(){active.insert(id.into(),value.clone());}}}serde_json::json!({"active":active,"suspended":RECORDING.load(Ordering::Acquire)})}
#[tauri::command]pub fn retry_configured_shortcuts(app:AppHandle)->Result<(),String>{let p=app.state::<std::sync::Arc<crate::settings_manager::SettingsManager>>().get();register_shortcuts_for(&app,&p)}

pub fn register_shortcuts(
    app: &AppHandle,
    hotkey: &str,
    replace_win_v: bool,
) -> Result<(), String> {
    register_shortcuts_ex(
        app,
        hotkey,
        replace_win_v,
        "F1".to_string(),
        "F3".to_string(),
    )
}

pub fn register_shortcuts_ex(
    app: &AppHandle,
    hotkey: &str,
    replace_win_v: bool,
    screenshot_hotkey: String,
    pin_hotkey: String,
) -> Result<(), String> {
    let extra=app.try_state::<std::sync::Arc<crate::settings_manager::SettingsManager>>().map(|s|s.get().capture.global_hotkeys).unwrap_or_default();
    register_shortcuts_with_extra(app,hotkey,replace_win_v,screenshot_hotkey,pin_hotkey,extra,false)
}
fn register_shortcuts_with_extra(app:&AppHandle,hotkey:&str,replace_win_v:bool,screenshot_hotkey:String,pin_hotkey:String,extra:BTreeMap<String,String>,strict:bool)->Result<(),String>{
    if RECORDING.load(Ordering::Acquire){return Err("请先完成快捷键录入".into());}
    let bridge = if replace_win_v && !hotkey.eq_ignore_ascii_case(WIN_V_BRIDGE_SHORTCUT) {
        Some(WIN_V_BRIDGE_SHORTCUT.to_string())
    } else {
        None
    };
    let mut requested = ShortcutConfiguration {
        hotkey: Some(hotkey.to_string()),
        replace_win_v,
        screenshot_hotkey: Some(screenshot_hotkey.clone()),
        pin_hotkey: Some(pin_hotkey.clone()),
        extra:extra.clone(),
    };
    let mut unique=BTreeMap::new();
    for (id,value) in [("history",hotkey),("screenshot",screenshot_hotkey.as_str()),("pin",pin_hotkey.as_str())].into_iter().chain(extra.iter().map(|(id,value)|(id.as_str(),value.as_str()))){
        if value.is_empty(){continue;}let key=canonical(value)?;
        if extra.contains_key(id){extra_action(id)?;let forbidden=["Ctrl+C","Ctrl+V","Ctrl+X","Ctrl+Z","Ctrl+Y","Ctrl+A","Ctrl+S","Ctrl+Alt+Delete","Alt+Tab","Alt+F4","Win+L","Win+D","Win+E","Win+R","Win+Tab","Win+V"];
            if forbidden.iter().any(|v|canonical(v).ok().as_ref()==Some(&key)){return Err(format!("{value} 是常用系统快捷键，请选择其他组合"));}
        }
        if let Some(other)=unique.insert(key.clone(),id){return Err(format!("快捷键冲突：{other} / {id}"));}
        if id!="history"&&replace_win_v&&canonical(WIN_V_BRIDGE_SHORTCUT)?==key{return Err("快捷键与 Win+V 入口冲突".into());}
    }
    let previous = CURRENT_CONFIGURATION.lock().unwrap().clone();
    if previous == requested {
        return Ok(());
    }

    app.global_shortcut()
        .unregister_all()
        .map_err(|error| format!("Could not release the previous shortcut: {error:?}"))?;

    let mut registration = register_action(app, hotkey, ShortcutAction::ToggleHistory)
        .and_then(|_| {
            if let Some(bridge) = bridge.as_deref() {
                register_action(app, bridge, ShortcutAction::ToggleHistory)
                    .map_err(|error| format!("{WIN_V_BRIDGE_SHORTCUT}: {error}"))
            } else {
                Ok(())
            }
        })
        .and_then(|_| {
            register_action(app, &screenshot_hotkey, ShortcutAction::Screenshot)
                .map_err(|error| format!("{screenshot_hotkey}: {error}"))
        })
        .and_then(|_| {
            register_action(app, &pin_hotkey, ShortcutAction::PinClipboard)
                .map_err(|error| format!("{pin_hotkey}: {error}"))
        });
    if registration.is_ok(){
        for (id,value) in &extra {
            let result=extra_action(id).and_then(|action|register_action(app,value,action));
            if let Err(error)=result{if strict{registration=Err(error);break;}requested.extra.remove(id);record_startup_notice("optional-conflict",value,None);log::warn!("SHORTCUT: optional action {id} could not register: {error}");}
        }
    }

    if let Err(error) = registration {
        let _ = app.global_shortcut().unregister_all();
        if let Err(restore_error) = register_configuration_without_fallback(app, &previous) {
            log::error!(
                "SHORTCUT: Failed to restore previous configuration after conflict: {restore_error}"
            );
        } else {
            *CURRENT_CONFIGURATION.lock().unwrap() = previous;
        }
        return Err(error);
    }

    *CURRENT_CONFIGURATION.lock().unwrap() = requested;
    log::info!(
        "SHORTCUT: Registered history={} screenshot={} pin={}",
        hotkey,
        screenshot_hotkey,
        pin_hotkey
    );
    Ok(())
}

fn register_action(
    app: &AppHandle,
    hotkey: &str,
    action: ShortcutAction,
) -> Result<(), String> {
    if hotkey.trim().is_empty(){return Ok(());}
    let shortcut = Shortcut::from_str(&parser_hotkey(hotkey))
        .map_err(|error| format!("Invalid shortcut {hotkey}: {error:?}"))?;
    let app_for_handler = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            match action {
                ShortcutAction::ToggleHistory => toggle_main_window(&app_for_handler),
                ShortcutAction::Screenshot => {
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = crate::zhenxia::start_screenshot(handle).await {
                            log::error!("CAPTURE: Failed to open screenshot overlay: {error}");
                        }
                    });
                }
                ShortcutAction::PinClipboard => {
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let handle2 = handle.clone();
                        if let Err(error) = crate::zhenxia::pin_clipboard_image(handle).await {
                            log::info!("PIN: {error}");
                            let _ = handle2.emit("zhenxia-notice", error);
                        }
                    });
                }
                ShortcutAction::CaptureHistory|ShortcutAction::Settings|ShortcutAction::Translate|ShortcutAction::RegionOcr|ShortcutAction::RegionTranslate=>{
                    let handle=app.clone();tauri::async_runtime::spawn(async move{
                        let result=match action{
                            ShortcutAction::CaptureHistory=>crate::commands::open_settings_section(handle.clone(),"captures".into()).await,
                            ShortcutAction::Settings=>crate::commands::open_settings_window(handle.clone()).await,
                            ShortcutAction::Translate=>crate::commands::open_translation_window(handle.clone()).await,
                            ShortcutAction::RegionOcr=>crate::zhenxia::start_screenshot_with_intent(handle.clone(),"ocr".into()).await,
                            _=>crate::zhenxia::start_screenshot_with_intent(handle.clone(),"translate".into()).await,
                        };if let Err(error)=result{let _=handle.emit("zhenxia-notice",error);}
                    });
                }
                ShortcutAction::ScrollCapture|ShortcutAction::RecordScreen=>{let kind=if matches!(action,ShortcutAction::ScrollCapture){"scroll"}else{"record"};let handle=app.clone();tauri::async_runtime::spawn(async move{if let Err(e)=crate::workflows::start_workflow_capture(handle,kind.into()).await{log::warn!("Capture workflow: {e}");}});},
                ShortcutAction::Presentation=>{let handle=app.clone();tauri::async_runtime::spawn(async move{let _=crate::workflows::start_presentation(handle).await;});},
                ShortcutAction::HidePins=>{crate::zhenxia::toggle_pins_visible(app);}
            }
        })
        .map_err(|error| format!("Failed to register shortcut: {error:?}"))
}

fn register_configuration_without_fallback(
    app: &AppHandle,
    configuration: &ShortcutConfiguration,
) -> Result<(), String> {
    if let Some(hotkey) = configuration.hotkey.as_deref() {
        register_action(app, hotkey, ShortcutAction::ToggleHistory)?;
        if configuration.replace_win_v && !hotkey.eq_ignore_ascii_case(WIN_V_BRIDGE_SHORTCUT) {
            register_action(
                app,
                WIN_V_BRIDGE_SHORTCUT,
                ShortcutAction::ToggleHistory,
            )?;
        }
    }
    if let Some(hotkey) = configuration.screenshot_hotkey.as_deref() {
        register_action(app, hotkey, ShortcutAction::Screenshot)?;
    }
    if let Some(hotkey) = configuration.pin_hotkey.as_deref() {
        register_action(app, hotkey, ShortcutAction::PinClipboard)?;
    }
    for (id,value) in &configuration.extra{register_action(app,value,extra_action(id)?)?;}
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parser_hotkey;

    #[test]
    fn normalizes_windows_friendly_modifier_names() {
        assert_eq!(parser_hotkey("Win+Alt+V"), "Super+Alt+V");
        assert_eq!(parser_hotkey("Windows+Ctrl+Alt+V"), "Super+Ctrl+Alt+V");
    }

    #[test]
    fn preserves_other_shortcut_tokens() {
        assert_eq!(parser_hotkey("Ctrl+Shift+V"), "Ctrl+Shift+V");
    }

    #[test]
    fn local_bindings_detect_equivalent_modifiers_and_allow_explicit_disable(){
        let mut bindings=crate::capture_preferences::CapturePreferences::default().shortcuts;
        bindings.insert("redo".into(),"Shift+Ctrl+Z".into());assert!(super::validate_local(&bindings).is_ok());
        bindings.insert("save".into(),"Ctrl+Shift+Z".into());assert!(super::validate_local(&bindings).is_err());
        bindings.insert("redo".into(),String::new());assert!(super::validate_local(&bindings).is_ok());
    }
    #[test]
    fn global_bindings_cannot_shadow_local_actions(){
        let mut settings=crate::models::AppSettings::default();settings.capture.global_hotkeys.insert("region_ocr".into(),"Ctrl+O".into());
        assert!(super::validate_preferences(&settings).is_err());settings.capture.global_hotkeys.insert("region_ocr".into(),"Ctrl+Alt+O".into());assert!(super::validate_preferences(&settings).is_ok());
        settings.capture.shortcuts.insert("pen".into(),"F1".into());assert!(super::validate_preferences(&settings).is_err());
    }
}
