//! Show/hide instantly without changing Windows' global animation settings.
/// Let DWM round borderless panels without a window region, which would disable
/// its backdrop material. Tao still supplies the full undecorated client area.
pub fn refresh_shape(window: &tauri::WebviewWindow) {
    if !matches!(window.label(), "main" | "settings" | "translation") { return; }
    let target = window.clone();
    let _ = window.run_on_main_thread(move || refresh_shape_on_ui_thread(&target));
}

fn refresh_shape_on_ui_thread(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    if let Ok(handle) = window.hwnd() {
        use tauri::Manager;
        use std::sync::Arc;
        use crate::settings_manager::SettingsManager;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject, GetWindowRgn, SetWindowRgn};
        use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND, DWMWCP_ROUND};
        use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_STYLE, WS_CAPTION, WS_THICKFRAME, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_NOACTIVATE};

        let capturing = window.label() == "main" && crate::zhenxia::capture_active();
        let rounded = window.state::<Arc<SettingsManager>>().get().round_corners
            && !capturing;
        let hwnd = HWND(handle.0 as _);
        unsafe {
            // Never retain a custom top-level region: it suppresses Mica/Acrylic.
            let current = CreateRectRgn(0, 0, 0, 0);
            if !current.is_invalid() {
                if GetWindowRgn(hwnd, current).0 != 0 {
                    SetWindowRgn(hwnd, None, true);
                }
                let _ = DeleteObject(current.into());
            }
            let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
            let next_style = if capturing {
                let mut value = style & !WS_CAPTION.0;
                if !window.is_resizable().unwrap_or(false) { value &= !WS_THICKFRAME.0; }
                value
            } else {
                // DWM's supported frame hints; this does not enable Tao's
                // native shadow/insets or decorations on the shared window.
                style | WS_CAPTION.0 | WS_THICKFRAME.0
            };
            if style != next_style {
                SetWindowLongW(hwnd, GWL_STYLE, next_style as i32);
                let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0,
                    SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
            }
            let preference = if rounded { DWMWCP_ROUND.0 } else { DWMWCP_DONOTROUND.0 };
            let _ = DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE,
                &preference as *const _ as *const std::ffi::c_void, std::mem::size_of_val(&preference) as u32);
        }
    }
}

pub fn prepare(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    if let Ok(handle) = window.hwnd() {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};
        let disabled = windows::core::BOOL(1);
        unsafe {
            if let Err(error) = DwmSetWindowAttribute(
                HWND(handle.0 as _), DWMWA_TRANSITIONS_FORCEDISABLED,
                &disabled as *const _ as *const std::ffi::c_void,
                std::mem::size_of_val(&disabled) as u32,
            ) { log::debug!("Window transitions: {error}"); }
        }
    }
}

pub fn show(window: &tauri::WebviewWindow) -> Result<(), String> {
    // Both queued Win+V toggles and explicit tray shows arrive here.
    // Toggles bypass animate_window_show's early memory-policy hint.
    crate::webview_memory::set_active(window, true);
    prepare(window);
    window.show().map_err(|e| e.to_string())?;
    refresh_shape(window);
    if window.label() == "main" {
        use tauri::Emitter;
        // Showing can succeed even when Windows denies foreground activation.
        // History hydration must follow visibility, not a focus notification.
        let _ = window.emit("zhenxia:main-visible", ());
    }
    window.set_focus().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    if let Ok(handle) = window.hwnd() {
        let handle = handle.0 as usize;
        // Only run after an explicit show request. Keep the input queues joined
        // just for foreground activation, then give keyboard focus to WebView2.
        let _ = window.with_webview(move |webview| unsafe {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
            use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow};
            use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC;
            let hwnd = HWND(handle as *mut std::ffi::c_void);
            let foreground = GetForegroundWindow();
            let other = GetWindowThreadProcessId(foreground, None);
            let own = GetCurrentThreadId();
            let attached = other != 0 && other != own && AttachThreadInput(own, other, true).as_bool();
            let _ = SetForegroundWindow(hwnd);
            if attached { let _ = AttachThreadInput(own, other, false); }
            let _ = webview.controller().MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        });
    }
    Ok(())
}

pub fn hide(window: &tauri::WebviewWindow) {
    prepare(window);
    let _ = window.hide();
    crate::webview_memory::set_active(window, false);
}
