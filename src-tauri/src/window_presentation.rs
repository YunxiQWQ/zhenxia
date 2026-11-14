//! Show/hide instantly without changing Windows' global animation settings.
/// Let DWM round borderless panels without a window region, which would disable
/// its backdrop material. Tao still supplies the full undecorated client area.
pub fn refresh_shape(window: &tauri::WebviewWindow) {
    if !is_custom_surface(window.label()) { return; }
    let target = window.clone();
    let _ = window.run_on_main_thread(move || refresh_shape_on_ui_thread(&target));
}

fn is_custom_surface(label: &str) -> bool {
    matches!(label, "main" | "settings" | "translation" | "image" | "workflow" | "presentation")
        || label.starts_with("zhenxia-pin-")
}

/// Wait for the native frame to be removed before a new surface is first shown.
/// At CreateWindow time Tao's borderless NCCALCSIZE handler may not be attached
/// yet. Merely setting decorations(false) can leave a 31px native caption.
pub async fn refresh_shape_before_show(window: &tauri::WebviewWindow) -> Result<(), String> {
    if !is_custom_surface(window.label()) { return Ok(()); }
    let target = window.clone();
    let (send, receive) = tokio::sync::oneshot::channel();
    window.run_on_main_thread(move || {
        refresh_shape_on_ui_thread(&target);
        let _ = send.send(());
    }).map_err(|e| e.to_string())?;
    receive.await.map_err(|e| e.to_string())
}

fn borderless_style(style: u32, frame_hints: bool, resizable: bool) -> u32 {
    use windows::Win32::UI::WindowsAndMessaging::{WS_CAPTION, WS_THICKFRAME, WS_SYSMENU, WS_MINIMIZEBOX, WS_MAXIMIZEBOX};
    // The application draws its own header and close button on every surface.
    let mut next = style & !(WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0);
    if frame_hints { next |= WS_CAPTION.0 | WS_THICKFRAME.0; }
    else {
        next &= !WS_CAPTION.0;
        if !resizable { next &= !WS_THICKFRAME.0; }
    }
    next
}

fn packed_screen_point(x: i32, y: i32) -> isize {
    ((x as u16 as u32) | ((y as u16 as u32) << 16)) as isize
}

/// WM_NCLBUTTONDOWN takes packed screen coordinates, not a pointer to POINTS.
/// Passing a stack address (the current Tao drag path) makes a tool jump.
#[tauri::command]
pub async fn start_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    if !is_custom_surface(window.label()) || !window.is_visible().unwrap_or(false) { return Err("Window is not visible".into()); }
    #[cfg(windows)] {
        use windows::Win32::{Foundation::{HWND, POINT, WPARAM, LPARAM}, UI::{Input::KeyboardAndMouse::ReleaseCapture,
            WindowsAndMessaging::{GetCursorPos, PostMessageW, WM_NCLBUTTONDOWN, HTCAPTION}}};
        let hwnd=window.hwnd().map_err(|e|e.to_string())?.0 as isize;
        let (send, receive)=tokio::sync::oneshot::channel();
        window.run_on_main_thread(move||{
            let result=unsafe{(||{
                let mut point=POINT::default();GetCursorPos(&mut point).map_err(|e|e.to_string())?;
                let _=ReleaseCapture();
                PostMessageW(Some(HWND(hwnd as _)),WM_NCLBUTTONDOWN,WPARAM(HTCAPTION as usize),LPARAM(packed_screen_point(point.x,point.y))).map_err(|e|e.to_string())
            })()};
            let _=send.send(result);
        }).map_err(|e|e.to_string())?;
        return receive.await.map_err(|e|e.to_string())?;
    }
    #[cfg(not(windows))]window.start_dragging().map_err(|e|e.to_string())
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
        use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongW, SetWindowLongW, SetWindowPos, GWL_STYLE, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_NOACTIVATE};

        let capturing = (window.label() == "main" && crate::zhenxia::capture_active())
            || window.label() == "presentation";
        let frame_hints = matches!(window.label(), "main" | "settings" | "translation") && !capturing;
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
            let next_style = borderless_style(style, frame_hints, window.is_resizable().unwrap_or(false));
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

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::*;
    #[test]
    fn all_custom_surfaces_use_the_frame_policy() {
        for label in ["main", "settings", "translation", "image", "workflow", "presentation", "zhenxia-pin-123"] { assert!(is_custom_surface(label)); }
        assert!(!is_custom_surface("system-file-dialog"));
    }
    #[test]
    fn drag_coordinates_pack_signed_monitor_positions_instead_of_addresses() {
        for (x,y) in [(800,240),(-1920,300),(100,-720)] {
            let value=packed_screen_point(x,y) as u32;
            assert_eq!((value as u16 as i16) as i32,x);
            assert_eq!(((value>>16) as u16 as i16) as i32,y);
        }
    }
    #[test]
    fn tool_windows_have_no_caption_or_system_buttons_even_after_runtime_flags_return() {
        let original = WS_CAPTION.0 | WS_THICKFRAME.0 | WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0 | WS_VISIBLE.0;
        let style = borderless_style(original, false, false);
        assert_eq!(style & (WS_CAPTION.0 | WS_THICKFRAME.0 | WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0), 0);
        assert_ne!(style & WS_VISIBLE.0, 0);
        assert_eq!(borderless_style(style, false, false), style);
        let editor = borderless_style(original, false, true);
        assert_ne!(editor & WS_THICKFRAME.0, 0);
        assert_eq!(editor & (WS_CAPTION.0 | WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0), 0);
    }
    #[test]
    fn material_panels_keep_rounding_hints_without_native_caption_controls() {
        let style = borderless_style(WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0, true, true);
        assert_eq!(style & (WS_CAPTION.0 | WS_THICKFRAME.0), WS_CAPTION.0 | WS_THICKFRAME.0);
        assert_eq!(style & (WS_SYSMENU.0 | WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0), 0);
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
