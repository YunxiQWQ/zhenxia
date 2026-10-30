//! Release hidden history payloads and request WebView2's low-memory target.
//! Keep the prepared capture renderer runnable to prioritize capture response.
#[cfg(target_os = "windows")]
static MAIN_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(target_os = "windows")]
pub fn set_active(window: &tauri::WebviewWindow, active: bool) {
    use tauri::Emitter;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;
    if window.label() != "main" { return; }
    MAIN_ACTIVE.store(active, std::sync::atomic::Ordering::Release);
    if !active { let _ = window.emit("zhenxia:main-idle", ()); }
    let _ = window.with_webview(move |webview| {
        if MAIN_ACTIVE.load(std::sync::atomic::Ordering::Acquire) != active { return; }
        let result = (|| -> windows::core::Result<()> {
            unsafe {
                let controller = webview.controller();
                // Hiding Tao's host window does not hide Wry's controller.
                // Stop hidden painting without suspending JavaScript or drafts.
                controller.SetIsVisible(active)?;
                let core = controller.CoreWebView2()?;
                if let Ok(memory) = core.cast::<ICoreWebView2_19>() {
                    memory.SetMemoryUsageTargetLevel(if active {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                    } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW })?;
                }
            }
            Ok(())
        })();
        if let Err(error) = result { log::debug!("WebView2 memory policy: {error}"); }
    });
}
#[cfg(not(target_os = "windows"))]
pub fn set_active(window: &tauri::WebviewWindow, active: bool) {
    use tauri::Emitter;
    if window.label() == "main" && !active { let _ = window.emit("zhenxia:main-idle", ()); }
}
