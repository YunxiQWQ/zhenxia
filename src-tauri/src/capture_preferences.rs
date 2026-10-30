use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct ToolbarColors {
    pub background: String,
    pub foreground: String,
    pub accent: String,
    pub border: String,
}
impl Default for ToolbarColors {
    fn default() -> Self { Self { background:"#202020".into(), foreground:"#eeeeee".into(), accent:"#33cc66".into(), border:"#444444".into() } }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct CapturePreferences {
    pub toolbar_theme: String,
    pub toolbar_colors: ToolbarColors,
    pub toolbar_order: Vec<String>,
    pub toolbar_hidden: Vec<String>,
    pub toolbar_scale: u32,
    pub shortcuts: BTreeMap<String, String>,
    pub global_hotkeys: BTreeMap<String, String>,
    pub ocr_engine: String,
    pub ocr_variant: String,
    pub translate_source: String,
    pub translate_target: String,
    pub pin_border: bool,
    pub pin_opacity: u32,
    pub viewer_path: String,
}

pub const TOOLBAR_ACTIONS: &[&str] = &["select","rect","ellipse","arrow","pen","text","marker","highlight","mosaic","eraser","undo","redo","edit","ocr","translate","save","pin","scroll","record","watermark","cancel","confirm"];
pub const GLOBAL_ACTIONS: &[&str] = &["capture_history","open_settings","translate","region_ocr","region_translate","hide_pins","scroll_capture","record_screen","presentation"];

impl Default for CapturePreferences {
    fn default() -> Self {
        let shortcuts = [("select","V"),("rect","R"),("ellipse","E"),("arrow","A"),("pen","B"),("text","T"),("marker","N"),("highlight","H"),("mosaic","M"),("eraser","X"),("undo","Ctrl+Z"),("redo","Ctrl+Shift+Z"),("edit","Ctrl+E"),("ocr","Ctrl+O"),("translate","Ctrl+T"),("save","Ctrl+S"),("pin","Ctrl+P"),("confirm","Enter"),("copy","Ctrl+C"),("next_candidate","Tab"),("pan","Space"),("crop","C"),("line","L"),("remove","Delete"),("rotate_left","Ctrl+Alt+ArrowLeft"),("rotate_right","Ctrl+Alt+ArrowRight"),("flip_x","Ctrl+Alt+H"),("flip_y","Ctrl+Shift+V"),("fit","Ctrl+0"),("actual_size","Ctrl+1"),("zoom_in","Ctrl+Equal"),("zoom_out","Ctrl+Minus"),("finish_editor","Ctrl+Enter"),("toggle_top","Alt+P"),("scroll",""),("record",""),("watermark","")].into_iter().map(|(k,v)|(k.into(),v.into())).collect();
        Self { toolbar_theme:"dark".into(),toolbar_colors:ToolbarColors::default(),toolbar_order:TOOLBAR_ACTIONS.iter().map(|x|x.to_string()).collect(),toolbar_hidden:vec!["ellipse".into(),"highlight".into(),"redo".into()],toolbar_scale:100,shortcuts,global_hotkeys:BTreeMap::new(),ocr_engine:"windows".into(),ocr_variant:"tiny".into(),translate_source:"auto".into(),translate_target:"en".into(),pin_border:true,pin_opacity:100,viewer_path:String::new() }
    }
}

pub fn validate(p: &CapturePreferences) -> Result<(),String> {
    if !["system","dark","light","custom"].contains(&p.toolbar_theme.as_str()) { return Err("Unknown toolbar theme".into()); }
    if !(70..=150).contains(&p.toolbar_scale) || !(15..=100).contains(&p.pin_opacity) { return Err("Appearance size is out of range".into()); }
    for color in [&p.toolbar_colors.background,&p.toolbar_colors.foreground,&p.toolbar_colors.accent,&p.toolbar_colors.border] {
        if color.len()!=7 || !color.starts_with('#') || !color[1..].chars().all(|c|c.is_ascii_hexdigit()) { return Err("Choose a valid color".into()); }
    }
    let mut seen=std::collections::HashSet::new();
    for action in &p.toolbar_order {
        if !TOOLBAR_ACTIONS.contains(&action.as_str()) || !seen.insert(action) { return Err("Toolbar contains an unknown or repeated tool".into()); }
    }
    // Older saved toolbars may omit newly introduced actions; the UI appends them.
    for action in &p.toolbar_hidden {
        if !TOOLBAR_ACTIONS.contains(&action.as_str()) || ["confirm","cancel"].contains(&action.as_str()) { return Err("Finish and cancel must remain visible".into()); }
    }
    if p.global_hotkeys.keys().any(|k|!GLOBAL_ACTIONS.contains(&k.as_str())) { return Err("Unknown global shortcut action".into()); }
    crate::shortcuts::validate_local(&p.shortcuts)?;
    if !["windows","ppocr"].contains(&p.ocr_engine.as_str()) || !["tiny","small"].contains(&p.ocr_variant.as_str()) { return Err("Unknown OCR engine".into()); }
    Ok(())
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn old_preferences_receive_complete_defaults() { let p:CapturePreferences=serde_json::from_str("{}").unwrap();assert_eq!(p.shortcuts.get("save").unwrap(),"Ctrl+S");assert!(validate(&p).is_ok()); }
    #[test] fn cannot_hide_escape_routes_or_repeat_tools() { let mut p=CapturePreferences::default();p.toolbar_hidden.push("cancel".into());assert!(validate(&p).is_err());p=CapturePreferences::default();p.toolbar_order[1]="select".into();assert!(validate(&p).is_err()); }
}
