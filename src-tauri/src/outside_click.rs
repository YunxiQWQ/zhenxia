//! Observe discrete mouse-down events only while history is visible.
//! The hook never consumes input and never calls Tauri's UI-thread APIs.
use std::cell::RefCell;
use std::sync::atomic::Ordering;
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::*;

struct Watch {
    window: tauri::WebviewWindow,
    hwnd: HWND,
    ui_thread: u32,
    generation: u64,
    dismissing: bool,
}

thread_local! { static WATCH: RefCell<Option<Watch>> = const { RefCell::new(None) }; }

fn point_is_in_app(point: POINT) -> bool {
    unsafe {
        let hit = WindowFromPoint(point);
        if hit.0.is_null() { return false; }
        let root = GetAncestor(hit, GA_ROOT);
        let mut owner = if root.0.is_null() { hit } else { root };
        for _ in 0..16 {
            let mut process = 0;
            GetWindowThreadProcessId(owner, Some(&mut process));
            if process == std::process::id() { return true; }
            let Ok(next) = GetWindow(owner, GW_OWNER) else { break; };
            if next.0.is_null() || next == owner { break; }
            owner = next;
        }
    }
    false
}

fn native_interaction(thread: u32) -> bool {
    if crate::HISTORY_DRAGGING.load(Ordering::Acquire) { return true; }
    let mut info = GUITHREADINFO { cbSize: std::mem::size_of::<GUITHREADINFO>() as u32, ..Default::default() };
    unsafe {
        GetGUIThreadInfo(thread, &mut info).is_ok()
            && (info.flags.0 & (GUI_INMENUMODE.0 | GUI_INMOVESIZE.0 | GUI_POPUPMENUMODE.0 | GUI_SYSTEMMENUMODE.0)) != 0
    }
}

unsafe extern "system" fn mouse(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
    if code >= 0 && matches!(message.0 as u32, WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN) {
        let point = unsafe { (*(data.0 as *const MSLLHOOKSTRUCT)).pt };
        WATCH.with(|slot| {
            let Ok(mut current) = slot.try_borrow_mut() else { return; };
            let Some(watch) = current.as_mut() else { return; };
            if watch.dismissing || crate::window_state::outside_click_watcher_should_exit(
                crate::SHOW_GENERATION.load(Ordering::Acquire), watch.generation,
                unsafe { IsWindowVisible(watch.hwnd).as_bool() },
            ) { return; }
            if !crate::window_state::should_dismiss_history(true, point_is_in_app(point), native_interaction(watch.ui_thread)) { return; }
            watch.dismissing = true;
            let window = watch.window.clone();
            let generation = watch.generation;
            // Return to Windows immediately; the hide runs off the hook thread.
            tauri::async_runtime::spawn(async move {
                if crate::SHOW_GENERATION.load(Ordering::Acquire) == generation && !crate::zhenxia::capture_active() {
                    crate::animate_window_hide(&window, None);
                }
            });
        });
    }
    unsafe { CallNextHookEx(None, code, message, data) }
}

pub(crate) fn watch(window: tauri::WebviewWindow, generation: u64) {
    let Ok(handle) = window.hwnd() else { return; };
    let hwnd = handle.0 as usize;
    std::thread::spawn(move || unsafe {
        let hwnd = HWND(hwnd as *mut std::ffi::c_void);
        let module = windows::Win32::System::LibraryLoader::GetModuleHandleW(None).ok().map(|module| HINSTANCE(module.0));
        let hook = match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), module, 0) {
            Ok(hook) => hook,
            Err(error) => {
                log::warn!("WINDOW: Outside-click event hook unavailable, using polling: {error}");
                crate::watch_for_outside_click_polling(window, generation);
                return;
            }
        };
        struct Hook(HHOOK);
        impl Drop for Hook { fn drop(&mut self) { unsafe { let _ = UnhookWindowsHookEx(self.0); } } }
        let _hook = Hook(hook);
        let ui_thread = GetWindowThreadProcessId(hwnd, None);
        WATCH.with(|slot| *slot.borrow_mut() = Some(Watch { window, hwnd, ui_thread, generation, dismissing: false }));
        let mut message = MSG::default();
        while !crate::window_state::outside_click_watcher_should_exit(
            crate::SHOW_GENERATION.load(Ordering::Acquire), generation, IsWindowVisible(hwnd).as_bool(),
        ) {
            let _ = MsgWaitForMultipleObjectsEx(None, 100, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
            while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        WATCH.with(|slot| *slot.borrow_mut() = None);
    });
}
