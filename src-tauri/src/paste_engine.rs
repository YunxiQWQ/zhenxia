#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicIsize, Ordering};
use std::time::Duration;

#[cfg(target_os = "windows")]
static PREVIOUS_FOREGROUND_WINDOW: AtomicIsize = AtomicIsize::new(0);
#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PasteStrategy {
    Standard = 0,
    #[cfg(any(test, feature = "dev-harness"))]
    RemoteSession = 1,
    #[cfg(any(test, feature = "dev-harness"))]
    NinjaRemote = 2,
}

#[cfg(target_os = "windows")]
pub fn remember_foreground_window(excluded_hwnd: Option<isize>) -> Option<isize> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let foreground = unsafe { GetForegroundWindow() };
    let value = foreground.0 as isize;
    if value == 0 || Some(value) == excluded_hwnd {
        return None;
    }

    PREVIOUS_FOREGROUND_WINDOW.store(value, Ordering::SeqCst);
    let process_name = process_name_for_window(value);
    let strategy = process_name
        .as_deref()
        .map(paste_strategy_for_process)
        .unwrap_or(PasteStrategy::Standard);
    log::info!(
        "PASTE: remembered target hwnd={value:#x}, process={:?}, strategy={:?}",
        process_name,
        strategy
    );
    Some(value)
}

#[cfg(target_os = "windows")]
pub fn set_previous_foreground_window(hwnd: isize) {
    set_previous_target(hwnd, PasteStrategy::Standard);
}

#[cfg(target_os = "windows")]
pub fn set_previous_target(hwnd: isize, _strategy: PasteStrategy) {
    PREVIOUS_FOREGROUND_WINDOW.store(hwnd, Ordering::SeqCst);
}

#[cfg(target_os = "windows")]
fn process_name_for_window(hwnd: isize) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    unsafe {
        let mut process_id = 0;
        GetWindowThreadProcessId(HWND(hwnd as _), Some(&mut process_id));
        if process_id == 0 {
            return None;
        }

        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?;
        let mut buffer = vec![0_u16; 1024];
        let mut length = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        );
        let _ = CloseHandle(process);
        result.ok()?;

        let path = String::from_utf16_lossy(&buffer[..length as usize]);
        std::path::Path::new(&path)
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_ascii_lowercase())
    }
}

pub fn paste_strategy_for_process(_process_name: &str) -> PasteStrategy { PasteStrategy::Standard }

#[cfg(target_os = "windows")]
pub fn previous_paste_strategy() -> PasteStrategy { PasteStrategy::Standard }

pub fn paste_settle_delay(_strategy: PasteStrategy) -> Duration { Duration::from_millis(100) }

pub fn should_auto_paste(_strategy: PasteStrategy) -> bool { true }

/// True when the remembered paste target is still the foreground window.
/// Read-only: a click-away during the settle delay must not steal focus back.
#[cfg(target_os = "windows")]
pub fn previous_target_has_focus() -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsWindow};

    let value = PREVIOUS_FOREGROUND_WINDOW.load(Ordering::SeqCst);
    if value == 0 {
        return false;
    }
    let target = HWND(value as _);
    unsafe { IsWindow(Some(target)).as_bool() && GetForegroundWindow() == target }
}

/// Sleep for the strategy's clipboard settle window, then synthesize Ctrl+V
/// only if the remembered target still has focus (SBS-1066).
#[cfg(target_os = "windows")]
pub fn send_settled_paste_input(strategy: PasteStrategy) -> Option<u32> {
    crate::paste_after_settle::send_paste_after_settle(
        || std::thread::sleep(paste_settle_delay(strategy)),
        previous_target_has_focus,
        || send_paste_input(strategy),
    )
}

/// After the flyout hides: restore the remembered target, wait for settle,
/// then send Ctrl+V only if that target still has focus. Matches the
/// pre-sleep restore abort: the clip stays on the clipboard for a manual
/// paste instead of landing in whichever window stole focus during the delay.
#[cfg(target_os = "windows")]
pub fn complete_auto_paste_after_hide() {
    let strategy = previous_paste_strategy();
    if !restore_previous_foreground_window() {
        // Synthesizing Ctrl+V now would paste into whatever window happens
        // to hold focus, which is not the one the user chose.
        log::warn!("PASTE: focus was not restored; clipboard is ready for a manual Ctrl+V");
        return;
    }
    if send_settled_paste_input(strategy).is_none() {
        log::warn!(
            "PASTE: target lost focus during settle delay; clipboard is ready for a manual Ctrl+V"
        );
    }
}

#[cfg(target_os = "windows")]
pub fn restore_previous_foreground_window() -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, IsWindow,
        SetForegroundWindow,
    };

    let value = PREVIOUS_FOREGROUND_WINDOW.load(Ordering::SeqCst);
    if value == 0 {
        log::warn!("FOCUS: no previous foreground window is available");
        return false;
    }

    let target = HWND(value as _);
    if !unsafe { IsWindow(Some(target)).as_bool() } {
        log::warn!("FOCUS: remembered foreground window is no longer valid");
        PREVIOUS_FOREGROUND_WINDOW.store(0, Ordering::SeqCst);
        return false;
    }

    let requested = unsafe { SetForegroundWindow(target).as_bool() };
    let mut restored = requested || unsafe { GetForegroundWindow() == target };

    if !restored {
        unsafe {
            let current_thread = GetCurrentThreadId();
            let foreground = GetForegroundWindow();
            let foreground_thread = GetWindowThreadProcessId(foreground, None);
            let target_thread = GetWindowThreadProcessId(target, None);
            let attached_foreground = foreground_thread != 0
                && foreground_thread != current_thread
                && AttachThreadInput(current_thread, foreground_thread, true).as_bool();
            let attached_target = target_thread != 0
                && target_thread != current_thread
                && AttachThreadInput(current_thread, target_thread, true).as_bool();

            let _ = BringWindowToTop(target);
            let fallback_requested = SetForegroundWindow(target).as_bool();
            restored = fallback_requested || GetForegroundWindow() == target;

            if attached_target {
                let _ = AttachThreadInput(current_thread, target_thread, false);
            }
            if attached_foreground {
                let _ = AttachThreadInput(current_thread, foreground_thread, false);
            }
        }
    }
    log::info!(
        "FOCUS: restore target {:?}, requested={}, foreground_matches={}",
        target,
        requested,
        restored
    );
    restored
}

/// Modifiers the user may still be holding from the launch hotkey (e.g.
/// Win+Alt+V plus a quick Enter) or from Shift+Enter. Left down, they would
/// combine with the synthesized Ctrl+V into Ctrl+Alt+V / Ctrl+Shift+V and
/// trigger the wrong command in the target app (Paste Special in Word).
#[cfg(target_os = "windows")]
fn physically_held_modifiers() -> Vec<windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_RCONTROL, VK_RMENU,
        VK_RSHIFT, VK_RWIN,
    };

    [
        VK_LWIN,
        VK_RWIN,
        VK_LCONTROL,
        VK_RCONTROL,
        VK_LMENU,
        VK_RMENU,
        VK_LSHIFT,
        VK_RSHIFT,
    ]
    .into_iter()
    .filter(|key| unsafe { GetAsyncKeyState(key.0 as i32) } as u16 & 0x8000 != 0)
    .collect()
}

/// The full key sequence for one synthesized paste: release held modifiers,
/// tap Ctrl+V, restore the modifiers. `true` means key-up.
///
/// Restored Win/Alt would read as a lone tap when the user physically releases
/// them later (Start menu opens / menu bar focuses), so a masking no-op key is
/// tapped inside the restored hold — the same trick AutoHotkey uses.
#[cfg(target_os = "windows")]
fn paste_input_plan(
    held_modifiers: &[windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY],
) -> Vec<(
    windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY,
    bool,
)> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        VK_CONTROL, VK_LMENU, VK_LWIN, VK_NONAME, VK_RMENU, VK_RWIN, VK_V,
    };

    let mut plan = Vec::new();
    for key in held_modifiers {
        plan.push((*key, true));
    }
    plan.extend([
        (VK_CONTROL, false),
        (VK_V, false),
        (VK_V, true),
        (VK_CONTROL, true),
    ]);
    for key in held_modifiers {
        plan.push((*key, false));
    }
    if held_modifiers
        .iter()
        .any(|key| [VK_LWIN, VK_RWIN, VK_LMENU, VK_RMENU].contains(key))
    {
        plan.push((VK_NONAME, false));
        plan.push((VK_NONAME, true));
    }
    plan
}

#[cfg(target_os = "windows")]
pub fn send_paste_input(_strategy: PasteStrategy) -> u32 {
    use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, KEYEVENTF_KEYUP};

    let label = "Ctrl+V";
    let held_modifiers = physically_held_modifiers();
    log::info!(
        "send_paste_input: sending {label} (releasing {} held modifier(s) around it)",
        held_modifiers.len()
    );
    let inputs: Vec<INPUT> = paste_input_plan(&held_modifiers)
        .into_iter()
        .map(|(key, key_up)| {
            keyboard_input(
                key,
                if key_up {
                    KEYEVENTF_KEYUP
                } else {
                    Default::default()
                },
            )
        })
        .collect();
    unsafe {
        let result = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        log::info!("send_paste_input: SendInput returned {}", result);
        result
    }
}

#[cfg(target_os = "windows")]
fn keyboard_input(
    key: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY,
    flags: windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS,
) -> windows::Win32::UI::Input::KeyboardAndMouse::INPUT {
    use windows::Win32::UI::Input::KeyboardAndMouse::{INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT};

    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                dwFlags: flags,
                ..Default::default()
            },
        },
    }
}

#[cfg(not(target_os = "windows"))]
pub fn restore_previous_foreground_window() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{
        paste_settle_delay, paste_strategy_for_process, set_previous_target,
        should_auto_paste, PasteStrategy,
    };






    #[test]
    fn all_foreground_apps_use_the_local_clipboard_paste_path() {
        for process in ["notepad.exe", "ncplayer.exe", "MSTSC.EXE", "anydesk.exe", "mRemoteNG.exe"] {
            let strategy = paste_strategy_for_process(process);
            assert_eq!(strategy, PasteStrategy::Standard);
            assert_eq!(paste_settle_delay(strategy), Duration::from_millis(100));
            assert!(should_auto_paste(strategy));
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn previous_target_has_focus_tracks_the_remembered_hwnd() {
        use super::previous_target_has_focus;
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

        let foreground = unsafe { GetForegroundWindow() };
        let hwnd = foreground.0 as isize;
        if hwnd == 0 {
            // No foreground window in this session. CI runners usually have
            // one; this branch documents the live-pin gap when they do not.
            set_previous_target(1, PasteStrategy::Standard);
            assert!(!previous_target_has_focus());
            return;
        }

        set_previous_target(hwnd, PasteStrategy::Standard);
        assert!(
            previous_target_has_focus(),
            "the remembered foreground window should still have focus"
        );
        set_previous_target(0, PasteStrategy::Standard);
        assert!(!previous_target_has_focus());
        set_previous_target(isize::MAX, PasteStrategy::Standard);
        assert!(!previous_target_has_focus());
    }

    #[cfg(target_os = "windows")]
    mod paste_input_plan {
        use super::super::paste_input_plan;
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            VK_CONTROL, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_NONAME, VK_V,
        };

        #[test]
        fn plain_paste_is_just_ctrl_v() {
            assert_eq!(
                paste_input_plan(&[]),
                vec![
                    (VK_CONTROL, false),
                    (VK_V, false),
                    (VK_V, true),
                    (VK_CONTROL, true),
                ]
            );
        }

        #[test]
        fn held_modifiers_are_released_first_and_restored_after() {
            let plan = paste_input_plan(&[VK_LWIN, VK_LMENU]);
            assert_eq!(&plan[..2], &[(VK_LWIN, true), (VK_LMENU, true)]);
            assert_eq!(plan[2..4], [(VK_CONTROL, false), (VK_V, false)]);
            assert_eq!(plan[6..8], [(VK_LWIN, false), (VK_LMENU, false)]);
            // Win/Alt restore needs the Start-menu / menu-bar mask tap.
            assert_eq!(&plan[8..], &[(VK_NONAME, false), (VK_NONAME, true)]);
        }

        #[test]
        fn shift_only_hold_needs_no_mask_tap() {
            let plan = paste_input_plan(&[VK_LSHIFT]);
            assert_eq!(plan.first(), Some(&(VK_LSHIFT, true)));
            assert_eq!(plan.last(), Some(&(VK_LSHIFT, false)));
            assert!(!plan.iter().any(|(key, _)| *key == VK_NONAME));
        }

        #[test]
        fn held_control_is_released_and_restored_around_paste() {
            let plan = paste_input_plan(&[VK_LCONTROL]);
            assert_eq!(plan.first(), Some(&(VK_LCONTROL, true)));
            assert_eq!(
                plan[1..5],
                [
                    (VK_CONTROL, false),
                    (VK_V, false),
                    (VK_V, true),
                    (VK_CONTROL, true)
                ]
            );
            assert_eq!(plan.last(), Some(&(VK_LCONTROL, false)));
        }
    }
}
