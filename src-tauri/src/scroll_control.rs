//! Guarded wheel input for user-enabled automatic scrolling.
use crate::workflows::Region;

#[derive(Clone, Copy)]
pub(crate) struct Target { root: isize, pid: u32 }
#[cfg(windows)]
pub(crate) fn target(r: Region) -> Option<Target> {
    use windows::Win32::{Foundation::POINT, UI::WindowsAndMessaging::*};
    unsafe {
        let window=GetAncestor(WindowFromPoint(POINT{x:r.x+r.width as i32/2,y:r.y+r.height as i32/2}),GA_ROOT);
        let mut pid=0;GetWindowThreadProcessId(window,Some(&mut pid));
        if window.is_invalid() || pid==0 || pid==std::process::id(){None}else{Some(Target{root:window.0 as isize,pid})}
    }
}
#[cfg(not(windows))]
pub(crate) fn target(_: Region) -> Option<Target> { None }

#[cfg(windows)]
pub(crate) fn step(target: Target, r: Region) -> Result<(),String> {
    use windows::Win32::{Foundation::POINT,UI::WindowsAndMessaging::*};
    unsafe {
        let mut point=POINT::default();GetCursorPos(&mut point).map_err(|e|e.to_string())?;
        if point.x<r.x||point.y<r.y||point.x>=r.x+r.width as i32||point.y>=r.y+r.height as i32 {
            return Err("自动滚动已暂停：请将鼠标移入选区后重新开启 / Paused: move the pointer into the region and enable auto-scroll again".into());
        }
        let window=GetAncestor(WindowFromPoint(point),GA_ROOT);
        let mut pid=0;GetWindowThreadProcessId(window,Some(&mut pid));
        let foreground=GetForegroundWindow();
        let mut foreground_pid=0;GetWindowThreadProcessId(foreground,Some(&mut foreground_pid));
        if window.0 as isize!=target.root || pid!=target.pid || (foreground!=window && foreground_pid!=std::process::id()) {
            return Err("自动滚动已暂停：原窗口已被遮挡或已切换 / Paused: source window is covered or changed".into());
        }
    }
    lscreen_capture::scroll_wheel(-1).map_err(|e|e.to_string())
}
#[cfg(not(windows))]
pub(crate) fn step(_: Target, _: Region) -> Result<(),String> { Err("Automatic scrolling is unavailable".into()) }
