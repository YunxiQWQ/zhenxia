use tauri::{menu::{Menu, MenuItem, PredefinedMenuItem}, AppHandle};

fn labels(language: &str) -> (&'static str, &'static str) {
    if language == "en" { ("Clipboard history (Win+V)", "Quit Zhenxia") }
    else { ("剪贴板历史（Win+V）", "退出帧匣") }
}

/// Startup and runtime language changes must use exactly the same menu shape.
pub(crate) fn build(app: &AppHandle, language: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let (show, quit) = labels(language);
    let title = MenuItem::with_id(app, "title", format!("帧匣 Zhenxia · v{}", env!("CARGO_PKG_VERSION")), false, None::<&str>)?;
    let history = MenuItem::with_id(app, "show", show, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let exit = MenuItem::with_id(app, "quit", quit, true, None::<&str>)?;
    let en=language=="en";
    let scroll=MenuItem::with_id(app,"scroll",if en{"Scrolling capture"}else{"长截图"},true,None::<&str>)?;
    let record=MenuItem::with_id(app,"record",if en{"Screen recording"}else{"录屏"},true,None::<&str>)?;
    let presentation=MenuItem::with_id(app,"presentation",if en{"Presentation / restore controls"}else{"演示画布 / 恢复演示操作"},true,None::<&str>)?;
    let controls=MenuItem::with_id(app,"workflow",if en{"Active capture controls"}else{"当前捕获控制（停止 / 完成）"},true,None::<&str>)?;
    Menu::with_items(app, &[&title, &history, &scroll, &record, &presentation, &controls, &separator, &exit])
}
