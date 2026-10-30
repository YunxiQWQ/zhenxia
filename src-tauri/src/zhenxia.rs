//! 帧匣截图、标注、贴图与命中检测。
//!
//! LaterScreen 的 `lscreen-capture` / `lscreen-core` 作为内部 Rust 引擎使用。
//! 不启动 `lscreen.exe`，不运行 egui 事件循环，不增加独立截图进程。

use crate::clipboard::{
    build_clip_hash_material, calculate_hash, create_image_preview, persist_full_image_file,
    set_clipboard_image_png, set_ignore_hash,
};
use crate::database::Database;
use crate::ocr_queue;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use clipboard_rs::common::RustImage;
use clipboard_rs::Clipboard as _;
use image::GenericImageView;
use lscreen_core::geom::{RectF, P2};
use lscreen_core::model::{Element, ElementKind, Rgba, Style};
use lscreen_core::render::Renderer;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;
use std::time::Instant;

static CAPTURE_VIEW_READY: AtomicBool = AtomicBool::new(false);

static CAPTURE_OPENING: AtomicBool = AtomicBool::new(false);
static RESTORE_SETTINGS: AtomicBool = AtomicBool::new(false);

const OVERLAY_LABEL: &str = "main";
const PIN_PREFIX: &str = "zhenxia-pin-";

#[derive(Debug, Clone, Serialize)]
pub struct CaptureWindowCandidate {
    pub id: u64,
    pub title: String,
    pub class_name: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub layer: u8,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CaptureDesktop {
    pub intent: String,
    pub session_id: String,
    pub image_base64: String,
    pub raw_rgba: bool,
    pub width: u32,
    pub height: u32,
    pub origin_x: i32,
    pub origin_y: i32,
    pub scale: f32,
    pub windows: Vec<CaptureWindowCandidate>,
    pub is_edit: bool,
    pub parent_clip_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationElementDto {
    pub kind: String,
    #[serde(default)]
    pub color: [u8; 4],
    #[serde(default = "default_width")]
    pub width: f32,
    #[serde(default = "default_font_size")]
    pub font_size: f32,
    #[serde(default)]
    pub x: f32,
    #[serde(default)]
    pub y: f32,
    #[serde(default)]
    pub w: f32,
    #[serde(default)]
    pub h: f32,
    #[serde(default)]
    pub x2: f32,
    #[serde(default)]
    pub y2: f32,
    #[serde(default)]
    pub points: Vec<[f32; 2]>,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub number: u32,
    #[serde(default)]
    pub bg: Option<[u8; 4]>,
}

fn default_width() -> f32 {
    3.0
}
fn default_font_size() -> f32 {
    24.0
}

#[derive(Debug, Clone, Serialize)]
pub struct StoredScreenshot {
    pub id: String,
    pub copied: bool,
    pub pinned: bool,
}

#[derive(Clone)]
enum CaptureSource {
    Png(Arc<[u8]>),
    Rgba(Arc<[u8]>),
}

impl CaptureSource {
    fn png(&self, width: u32, height: u32) -> Result<Vec<u8>, String> {
        match self {
            Self::Png(bytes) => Ok(bytes.to_vec()),
            Self::Rgba(bytes) => {
                let expected = (width as usize).checked_mul(height as usize)
                    .and_then(|n| n.checked_mul(4)).ok_or("Screenshot dimensions overflow")?;
                if bytes.len() != expected { return Err("Invalid screenshot pixel length".into()); }
                encode_png(width, height, bytes)
            }
        }
    }
}

struct DesktopSession {
    intent: String,
    source: CaptureSource,
    width: u32,
    height: u32,
    origin_x: i32,
    origin_y: i32,
    scale: f32,
    is_edit: bool,
    parent_clip_id: Option<String>,
    started: Instant,
}

struct PinPayload {
    id: String,
    png: Vec<u8>,
    width: u32,
    height: u32,
}

fn desktop_sessions() -> &'static Mutex<HashMap<String, DesktopSession>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, DesktopSession>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn pin_payloads() -> &'static Mutex<HashMap<String, PinPayload>> {
    static PAYLOADS: OnceLock<Mutex<HashMap<String, PinPayload>>> = OnceLock::new();
    PAYLOADS.get_or_init(|| Mutex::new(HashMap::new()))
}


#[derive(Debug, Clone, Deserialize)]
pub struct CropRegion { pub x: f32, pub y: f32, pub width: f32, pub height: f32 }

fn crop_image_png(png: Vec<u8>, crop: Option<CropRegion>) -> Result<Vec<u8>, String> {
    let Some(crop) = crop else { return Ok(png); };
    if ![crop.x, crop.y, crop.width, crop.height].iter().all(|n| n.is_finite())
        || crop.width <= 0.0 || crop.height <= 0.0 { return Err("Invalid screenshot selection".into()); }
    let image = image::load_from_memory(&png).map_err(|e| e.to_string())?;
    let x = crop.x.max(0.0).floor() as u32;
    let y = crop.y.max(0.0).floor() as u32;
    if x >= image.width() || y >= image.height() { return Err("Selection is outside the image".into()); }
    let right = (crop.x + crop.width).ceil().min(image.width() as f32);
    let bottom = (crop.y + crop.height).ceil().min(image.height() as f32);
    if right <= x as f32 || bottom <= y as f32 { return Err("Selection is outside the image".into()); }
    let width = right as u32 - x;
    let height = bottom as u32 - y;
    let cropped = image.crop_imm(x, y, width, height);
    let mut out = Vec::new();
    cropped.write_to(&mut std::io::Cursor::new(&mut out), image::ImageOutputFormat::Png).map_err(|e| e.to_string())?;
    Ok(out)
}

/// Called for native destruction too: Alt+F4 and failed loads bypass React actions.
pub fn release_window_resources(label: &str) {
    if label == OVERLAY_LABEL { desktop_sessions().lock().unwrap().clear(); CAPTURE_VIEW_READY.store(false, Ordering::Release); }
    if let Some(id) = label.strip_prefix(PIN_PREFIX) { pin_payloads().lock().unwrap().remove(id); }
}

#[tauri::command]
pub async fn copy_pin_image(pin_id: String) -> Result<(), String> {
    let png = pin_payloads().lock().unwrap().get(&pin_id)
        .ok_or_else(|| "Pinned image has been released".to_string())?.png.clone();
    set_clipboard_image_png(&png)
}

#[tauri::command]
pub async fn save_pin_image(app: AppHandle, pin_id: String) -> Result<String, String> {
    let png = pin_payloads().lock().unwrap().get(&pin_id)
        .ok_or_else(|| "Pinned image has been released".to_string())?.png.clone();
    tauri::async_runtime::spawn_blocking(move || save_png_dialog(&app, &png, "Zhenxia.png")).await.map_err(|e| e.to_string())?
}

fn save_png_dialog(app: &AppHandle, png: &[u8], name: &str) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog=app.dialog().file().set_file_name(name).add_filter("PNG", &["png"]);
    if let Some(parent)=app.webview_windows().into_values().find(|w|w.is_focused().unwrap_or(false)).or_else(||app.get_webview_window("main")){dialog=dialog.set_parent(&parent);}
    let Some(path) = dialog.blocking_save_file()
        else { return Err("Save cancelled".into()); };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, png).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_interface_language(app: AppHandle, language: String) -> Result<(), String> {
    if language != "zh-CN" && language != "en" { return Err("Unsupported language".into()); }
    let menu = crate::tray_menu::build(&app, &language).map_err(|e|e.to_string())?;
    if let Some(tray) = app.tray_by_id("main") { tray.set_menu(Some(menu)).map_err(|e|e.to_string())?; }
    Ok(())
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    use image::ImageEncoder;
    let mut out = Vec::new();
    image::codecs::png::PngEncoder::new_with_quality(&mut out, image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::Sub)
        .write_image(rgba, width, height, image::ColorType::Rgba8)
        .map_err(|error| error.to_string())?;
    Ok(out)
}

fn rgba_rect(shot: &lscreen_capture::Screenshot, x: i32, y: i32, w: u32, h: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity((w * h * 4) as usize);
    for row in 0..h {
        for col in 0..w {
            let pixel = shot
                .pixel((x - shot.origin.0) as u32 + col, (y - shot.origin.1) as u32 + row)
                .unwrap_or([0, 0, 0, 255]);
            out.extend_from_slice(&pixel);
        }
    }
    out
}

fn is_own_window(window: &lscreen_capture::WindowInfo) -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(HWND(window.id as usize as *mut std::ffi::c_void), Some(&mut pid)); }
        pid == std::process::id()
    }
    #[cfg(not(target_os = "windows"))]
    { window.title == "帧匣截图" || window.title == "帧匣贴图" || window.title == "帧匣 Zhenxia" }
}

#[cfg(target_os = "windows")]
fn child_candidates(top: lscreen_capture::WindowInfo) -> Vec<CaptureWindowCandidate> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT, TRUE};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, GetClassNameW, GetWindowTextLengthW, GetWindowTextW, GetWindowRect,
        IsWindowVisible,
    };

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let list = &mut *(lparam.0 as *mut Vec<(HWND, RECT)>);
        if IsWindowVisible(hwnd).as_bool() {
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_ok() {
                list.push((hwnd, rect));
            }
        }
        TRUE
    }

    let mut handles: Vec<(HWND, RECT)> = Vec::new();
    let top_hwnd = HWND(top.id as *mut core::ffi::c_void);
    unsafe {
        let _ = EnumChildWindows(
            Some(top_hwnd),
            Some(enum_proc),
            LPARAM(&mut handles as *mut Vec<(HWND, RECT)> as isize),
        );
    }

    let mut out = Vec::new();
    for (index, (hwnd, rect)) in handles.iter().take(64).enumerate() {
        let mut class_buf = [0u16; 128];
        let class_len = unsafe { GetClassNameW(*hwnd, &mut class_buf) } as usize;
        let class_name = String::from_utf16_lossy(&class_buf[..class_len]);
        let text_len = unsafe { GetWindowTextLengthW(*hwnd) } as usize;
        let mut text_buf = vec![0u16; text_len + 1];
        let text_len = unsafe { GetWindowTextW(*hwnd, &mut text_buf) } as usize;
        let title = String::from_utf16_lossy(&text_buf[..text_len]);
        let (x, y, w, h) = (
            rect.left as f32,
            rect.top as f32,
            (rect.right - rect.left) as f32,
            (rect.bottom - rect.top) as f32,
        );
        if w < 4.0 || h < 4.0 || title.is_empty() && class_name.is_empty() {
            continue;
        }
        out.push(CaptureWindowCandidate {
            id: hwnd.0 as u64,
            title,
            class_name,
            x,
            y,
            width: w,
            height: h,
            layer: 1,
            kind: "control".into(),
        });
        if index >= 63 {
            break;
        }
    }
    out
}

#[cfg(not(target_os = "windows"))]
fn child_candidates(_top: lscreen_capture::WindowInfo) -> Vec<CaptureWindowCandidate> {
    Vec::new()
}

pub fn collect_candidates(x: f32, y: f32) -> Vec<CaptureWindowCandidate> {
    let mut out = Vec::new();
    let ix = x.round() as i32;
    let iy = y.round() as i32;

    if let Some(win) = lscreen_capture::window_at(ix, iy) {
        if !is_own_window(&win) {
            out.push(CaptureWindowCandidate {
                id: win.id,
                title: win.title.clone(),
                class_name: String::new(),
                x: win.x as f32,
                y: win.y as f32,
                width: win.width as f32,
                height: win.height as f32,
                layer: 0,
                kind: "window".into(),
            });
            for child in child_candidates(win) {
                if child.x <= x
                    && child.y <= y
                    && x <= child.x + child.width
                    && y <= child.y + child.height
                {
                    out.push(child);
                }
            }
        }
    }

    for win in lscreen_capture::list_windows() {
        if out.len() >= 12 {
            break;
        }
        if is_own_window(&win) || out.iter().any(|item| item.id == win.id) {
            continue;
        }
        if win.contains(ix, iy) {
            // The fullscreen overlay owns WindowFromPoint during capture.
            // Inspect controls of the first underlying application as well.
            if out.is_empty() {
                let mut children: Vec<_> = child_candidates(win.clone()).into_iter()
                    .filter(|child| child.x <= x && child.y <= y && x <= child.x + child.width && y <= child.y + child.height)
                    .collect();
                children.sort_by(|a,b| (a.width*a.height).total_cmp(&(b.width*b.height)));
                children.truncate(8);
                out.extend(children);
            }
            out.push(CaptureWindowCandidate {
                id: win.id,
                title: win.title,
                class_name: String::new(),
                x: win.x as f32,
                y: win.y as f32,
                width: win.width as f32,
                height: win.height as f32,
                layer: 0,
                kind: "window".into(),
            });
        }
    }
    out
}

fn map_element(dto: &AnnotationElementDto) -> Option<Element> {
    let color = Rgba(dto.color);
    let style = Style {
        color,
        width: dto.width.max(1.0),
        font_size: dto.font_size.max(8.0),
    };
    let kind = match dto.kind.as_str() {
        "rect" => ElementKind::Rect {
            rect: RectF::from_points(P2::new(dto.x, dto.y), P2::new(dto.x + dto.w, dto.y + dto.h)),
        },
        "ellipse" => ElementKind::Ellipse {
            rect: RectF::from_points(P2::new(dto.x, dto.y), P2::new(dto.x + dto.w, dto.y + dto.h)),
        },
        "arrow" => ElementKind::Arrow {
            from: P2::new(dto.x, dto.y),
            to: P2::new(dto.x2, dto.y2),
        },
        "line" => ElementKind::Line {
            from: P2::new(dto.x, dto.y),
            to: P2::new(dto.x2, dto.y2),
        },
        "pen" | "curve" | "highlight" => ElementKind::Curve {
            points: dto
                .points
                .iter()
                .map(|p| P2::new(p[0], p[1]))
                .collect::<Vec<_>>(),
        },
        "text" => ElementKind::Text {
            pos: P2::new(dto.x, dto.y),
            content: dto.text.clone(),
            size: P2::new(
                dto.w.max(dto.text.chars().count() as f32 * dto.font_size * 0.6),
                dto.h.max(dto.font_size * 1.25),
            ),
            bg: dto.bg.map(Rgba),
        },
        "marker" => ElementKind::Marker {
            center: P2::new(dto.x, dto.y),
            number: dto.number.max(1),
        },
        "mosaic" => ElementKind::Mosaic {
            points: dto
                .points
                .iter()
                .map(|p| P2::new(p[0], p[1]))
                .collect::<Vec<_>>(),
        },
        "eraser" => ElementKind::Eraser {
            points: dto
                .points
                .iter()
                .map(|p| P2::new(p[0], p[1]))
                .collect::<Vec<_>>(),
        },
        _ => return None,
    };
    Some(Element {
        id: 0,
        kind,
        style,
    })
}

fn load_cjk_font() -> Option<Vec<u8>> {
    let candidates = [
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\msyh.ttf",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
    ];
    candidates
        .iter()
        .find_map(|path| std::fs::read(path).ok())
}

pub fn render_annotation_png(
    source_png: &[u8],
    elements: &[AnnotationElementDto],
) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory(source_png)
        .map_err(|error| error.to_string())?
        .into_rgba8();
    let mapped = elements.iter().filter_map(map_element).collect::<Vec<_>>();
    let renderer = Renderer::new(load_cjk_font());
    let rgba = renderer.render(
        image.as_raw(),
        image.width(),
        image.height(),
        &mapped,
    );
    encode_png(image.width(), image.height(), &rgba)
}

pub(crate) async fn insert_image_history(
    app: &AppHandle,
    db: &Database,
    png: &[u8],
    metadata: serde_json::Value,
    copy_to_clipboard: bool,
) -> Result<StoredScreenshot, String> {
    let mut metadata=metadata;
    if let Some(object)=metadata.as_object_mut(){if let Ok((width,height))=image::io::Reader::with_format(std::io::Cursor::new(png),image::ImageFormat::Png).into_dimensions(){object.insert("width".into(),width.into());object.insert("height".into(),height.into());}}
    let preview = create_image_preview(png)?;
    let hash_material = build_clip_hash_material("image", png, std::iter::empty());
    let clip_hash = calculate_hash(&hash_material);
    let storage_hash = db.crypto.keyed_hash(&hash_material);

    let existing: Option<String> = sqlx::query_scalar("SELECT uuid FROM clips WHERE content_hash = ?")
        .bind(&storage_hash)
        .fetch_optional(&db.pool)
        .await
        .map_err(|error| error.to_string())?;

    let encrypted_content = db.crypto.encrypt(&preview)?;
    let encrypted_preview = db.crypto.encrypt_text("[截图]")?;
    let encrypted_source = db.crypto.encrypt_optional_text(Some("帧匣截图"))?;
    let encrypted_metadata = db.crypto.encrypt_optional_text(Some(&metadata.to_string()))?;

    let clip_uuid = if let Some(existing_id) = existing {
        sqlx::query(
            "UPDATE clips SET created_at = CURRENT_TIMESTAMP, is_deleted = 0, source_app = ?, metadata = ? WHERE uuid = ?",
        )
        .bind(&encrypted_source)
        .bind(&encrypted_metadata)
        .bind(&existing_id)
        .execute(&db.pool)
        .await
        .map_err(|error| error.to_string())?;
        existing_id
    } else {
        let clip_uuid = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO clips (uuid, clip_type, content, text_preview, content_hash, folder_id,
                is_deleted, is_thumbnail, source_app, source_icon, metadata, ocr_status,
                created_at, last_accessed)
            VALUES (?, 'image', ?, ?, ?, NULL, 0, 0, ?, NULL, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            "#,
        )
        .bind(&clip_uuid)
        .bind(&encrypted_content)
        .bind(&encrypted_preview)
        .bind(&storage_hash)
        .bind(&encrypted_source)
        .bind(&encrypted_metadata)
        .execute(&db.pool)
        .await
        .map_err(|error| error.to_string())?;

        let file_path = persist_full_image_file(&db.crypto, &db.image_dir, &clip_uuid, png)?;
        if let Err(error) = sqlx::query(
            r#"
            INSERT OR REPLACE INTO clip_images
            (clip_uuid, full_content, file_path, file_size, storage_kind, mime_type, created_at)
            VALUES (?, x'', ?, ?, 'file', 'image/png', CURRENT_TIMESTAMP)
            "#,
        )
        .bind(&clip_uuid)
        .bind(&file_path)
        .bind(png.len() as i64)
        .execute(&db.pool)
        .await
        {
            let _ = sqlx::query("DELETE FROM clips WHERE uuid = ?")
                .bind(&clip_uuid)
                .execute(&db.pool)
                .await;
            crate::managed_image::remove_clip_image_files(&db.image_dir, vec![file_path]);
            return Err(error.to_string());
        }
        if let Err(error) = ocr_queue::enqueue(db, &clip_uuid).await {
            log::warn!("OCR: could not queue screenshot {clip_uuid}: {error}");
        }
        clip_uuid
    };

    db.search_index.upsert(
        &clip_uuid,
        "image",
        &preview,
        "[截图]",
        None,
        Some("帧匣截图"),
    );

    let mut copied = false;
    if copy_to_clipboard {
        set_ignore_hash(clip_hash);
        set_clipboard_image_png(png)?;
        copied = true;
    }

    let _ = app.emit(
        "clipboard-change",
        serde_json::json!({
            "id": clip_uuid,
            "content": "[截图]",
            "clip_type": "image",
            "source": "zhenxia-screenshot"
        }),
    );

    Ok(StoredScreenshot {
        id: clip_uuid,
        copied,
        pinned: false,
    })
}

#[tauri::command]
pub fn capture_active() -> bool {
    CAPTURE_OPENING.load(Ordering::Acquire) || !desktop_sessions().lock().unwrap().is_empty()
}

async fn ensure_capture_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window(OVERLAY_LABEL).ok_or_else(|| "Main window unavailable".into())
}

pub async fn prewarm_capture(app: AppHandle) {
    if let Err(error) = ensure_capture_window(&app).await { log::warn!("CAPTURE: Could not prepare view: {error}"); }
}

fn notify_capture(window: &tauri::WebviewWindow, session: &str) -> Result<(), String> {
    crate::webview_memory::set_active(window, true);
    if CAPTURE_VIEW_READY.load(Ordering::Acquire) {
        let id = serde_json::to_string(session).map_err(|e|e.to_string())?;
        window.eval(format!("window.dispatchEvent(new CustomEvent('zhenxia:capture-session',{{detail:{id}}}))")).map_err(|e|e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn capture_view_ready(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    if window.label() != OVERLAY_LABEL { return Err("Unexpected capture window".into()); }
    CAPTURE_VIEW_READY.store(true, Ordering::Release);
    let session = desktop_sessions().lock().unwrap().keys().next().cloned();
    if session.is_none() && !window.is_visible().unwrap_or(false) { crate::webview_memory::set_active(&window, false); }
    Ok(session)
}

#[tauri::command]
pub async fn start_screenshot(app: AppHandle) -> Result<(), String> {
    start_screenshot_with_intent(app,"capture".into()).await
}
pub async fn start_screenshot_with_intent(app: AppHandle,intent:String) -> Result<(), String> {
    if !crate::workflows::available(){return Err("请先完成当前长截图或录屏 / Finish the active capture first".into());}
    if CAPTURE_OPENING.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() { return Ok(()); }
    struct OpeningGuard;
    impl Drop for OpeningGuard { fn drop(&mut self) { CAPTURE_OPENING.store(false, Ordering::Release); } }
    let _opening = OpeningGuard;
    if !desktop_sessions().lock().unwrap().is_empty() {
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            if window.is_visible().unwrap_or(false) { let _ = window.set_focus(); }
        }
        return Ok(());
    }
    let window = ensure_capture_window(&app).await?;
    suspend_settings(&app);
    crate::enter_capture_mode();
    crate::window_presentation::hide(&window);
    window.set_title("帧匣截图").map_err(|e|e.to_string())?;
    window.set_always_on_top(true).map_err(|e|e.to_string())?;
    let result: Result<(), String> = async {
    let started = Instant::now();
    let (shot, capture_ms) = tauri::async_runtime::spawn_blocking(|| {
        let t = Instant::now();
        let (x, y) = lscreen_capture::cursor_position().unwrap_or((0, 0));
        let shot = lscreen_capture::capture_at(x, y).map_err(|e|e.to_string())?;
        let capture_ms = t.elapsed().as_millis();
        Ok::<_, String>((shot, capture_ms))
    }).await.map_err(|e|e.to_string())??;
    let window = ensure_capture_window(&app).await?;
    window.set_resizable(false).map_err(|e|e.to_string())?;
    let position = tauri::PhysicalPosition::new(shot.origin.0, shot.origin.1);
    let size = tauri::PhysicalSize::new(shot.width, shot.height);
    if window.outer_position().ok() != Some(position) {
        window.set_position(position).map_err(|e|e.to_string())?;
    }
    if window.inner_size().ok() != Some(size) {
        window.set_size(size).map_err(|e|e.to_string())?;
    }
    let id = Uuid::new_v4().to_string();
    desktop_sessions().lock().unwrap().insert(id.clone(), DesktopSession {
        intent,
        source:CaptureSource::Rgba(shot.rgba.into()), width:shot.width, height:shot.height, origin_x:shot.origin.0, origin_y:shot.origin.1,
        scale:shot.scale, is_edit:false, parent_clip_id:None, started,
    });
    if let Err(error) = notify_capture(&window, &id) {
        desktop_sessions().lock().unwrap().remove(&id);
        return Err(error);
    }
    log::info!("CAPTURE_TIMING: capture_ms={capture_ms} transport=rgba prepared_ms={}", started.elapsed().as_millis());
    Ok(())
    }.await;
    if result.is_err() { close_screenshot_window(&app); }
    result
}

/// Called only after the decoded background has been drawn in the hidden webview.
#[tauri::command]
pub async fn present_capture(window: tauri::WebviewWindow, session_id: String) -> Result<(), String> {
    if window.label() != OVERLAY_LABEL { return Err("Unexpected capture window".into()); }
    let elapsed = desktop_sessions().lock().unwrap().get(&session_id)
        .ok_or_else(|| "Screenshot session expired".to_string())?.started.elapsed().as_millis();
    crate::window_presentation::show(&window)?;
    log::info!("CAPTURE_TIMING: visible_ms={elapsed}");
    Ok(())
}

#[tauri::command]
pub async fn get_capture_session(session_id: String) -> Result<CaptureDesktop, String> {
    let sessions = desktop_sessions().lock().unwrap();
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "截图会话已过期".to_string())?;
    Ok(CaptureDesktop {
        intent:session.intent.clone(),
        session_id,
        image_base64: match &session.source { CaptureSource::Png(bytes) => B64.encode(bytes), CaptureSource::Rgba(_) => String::new() },
        raw_rgba: matches!(&session.source, CaptureSource::Rgba(_)),
        width: session.width,
        height: session.height,
        origin_x: session.origin_x,
        origin_y: session.origin_y,
        scale: session.scale,
        windows: Vec::new(),
        is_edit: session.is_edit,
        parent_clip_id: session.parent_clip_id.clone(),
    })
}

/// Binary IPC avoids PNG encoding, base64 JSON and PNG decoding before first paint.
/// Retain native pixels for a later confirmed crop/export, not for idle history.
#[tauri::command]
pub async fn get_capture_pixels(window: tauri::WebviewWindow, session_id: String) -> Result<tauri::ipc::Response, String> {
    if window.label() != OVERLAY_LABEL { return Err("Unexpected capture window".into()); }
    let pixels = {
        let sessions = desktop_sessions().lock().unwrap();
        let session = sessions.get(&session_id).ok_or("Screenshot session expired")?;
        match &session.source {
            CaptureSource::Rgba(pixels) => pixels.clone(),
            CaptureSource::Png(_) => return Err("This editor session uses PNG".into()),
        }
    };
    Ok(tauri::ipc::Response::new(pixels.to_vec()))
}

/// Prefer a one-shot shared mapping over sending a full desktop through HTTP IPC.
/// Each script view is released after bitmap creation; native ownership closes here.
#[tauri::command]
pub async fn share_capture_pixels(window: tauri::WebviewWindow, session_id: String, request_id: String) -> Result<bool, String> {
    if window.label() != OVERLAY_LABEL { return Err("Unexpected capture window".into()); }
    let url = window.url().map_err(|e| e.to_string())?;
    let trusted = url.host_str() == Some("tauri.localhost")
        || (cfg!(debug_assertions) && url.host_str() == Some("localhost") && url.port() == Some(1420));
    if !trusted { return Err("Capture pixels require the local application page".into()); }
    let pixels = {
        let sessions = desktop_sessions().lock().unwrap();
        match &sessions.get(&session_id).ok_or("Screenshot session expired")?.source {
            CaptureSource::Rgba(pixels) => pixels.clone(),
            CaptureSource::Png(_) => return Ok(false),
        }
    };
    #[cfg(target_os = "windows")]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2_2, ICoreWebView2_17, ICoreWebView2Environment12, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY};
        use windows::core::{Interface, PCWSTR};
        let metadata = serde_json::json!({"kind":"zhenxia-capture", "sessionId":session_id, "requestId":request_id}).to_string();
        let (send, receive) = tokio::sync::oneshot::channel();
        window.with_webview(move |view| {
            let result = (|| -> windows::core::Result<()> {
                unsafe {
                    let core = view.controller().CoreWebView2()?;
                    let shared_core = core.cast::<ICoreWebView2_17>()?;
                    let environment = core.cast::<ICoreWebView2_2>()?.Environment()?.cast::<ICoreWebView2Environment12>()?;
                    let shared = environment.CreateSharedBuffer(pixels.len() as u64)?;
                    let mut pointer = std::ptr::null_mut();
                    shared.Buffer(&mut pointer)?;
                    std::ptr::copy_nonoverlapping(pixels.as_ptr(), pointer, pixels.len());
                    let json: Vec<u16> = metadata.encode_utf16().chain(Some(0)).collect();
                    let posted = shared_core.PostSharedBufferToScript(&shared, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY, PCWSTR(json.as_ptr()));
                    let _ = shared.Close();
                    posted?;
                }
                Ok(())
            })();
            if let Err(error) = &result { log::debug!("CAPTURE: Shared pixels unavailable, using binary IPC: {error}"); }
            let _ = send.send(result.is_ok());
        }).map_err(|e|e.to_string())?;
        return receive.await.map_err(|_| "Capture window closed".to_string());
    }
    #[cfg(not(target_os = "windows"))]
    { let _ = (pixels, request_id); Ok(false) }
}

#[tauri::command]
pub async fn hit_test_candidates(x: f32, y: f32) -> Result<Vec<CaptureWindowCandidate>, String> {
    Ok(collect_candidates(x, y))
}

#[tauri::command]
pub async fn render_annotations(
    image_base64: String,
    elements: Vec<AnnotationElementDto>,
) -> Result<String, String> {
    let source = B64.decode(image_base64).map_err(|error| error.to_string())?;
    let png = render_annotation_png(&source, &elements)?;
    Ok(B64.encode(png))
}

#[tauri::command]
pub async fn finish_screenshot(
    app: AppHandle,
    db: tauri::State<'_, Arc<Database>>,
    session_id: String,
    image_base64: Option<String>,
    crop: Option<CropRegion>,
    elements: Vec<AnnotationElementDto>,
    mode: Option<String>,
    source_clip_id: Option<String>,
    copy_to_clipboard: bool,
    pin: bool,
) -> Result<StoredScreenshot, String> {
    let (source, width, height) = match image_base64 {
        Some(data) => (CaptureSource::Png(B64.decode(data).map_err(|error| error.to_string())?.into()), 0, 0),
        None => {
            let sessions = desktop_sessions().lock().unwrap();
            let session = sessions.get(&session_id).ok_or("Screenshot session expired")?;
            (session.source.clone(), session.width, session.height)
        }
    };
    // Return to the underlying application before encoding, storage, OCR and pin creation.
    // If any operation fails, reopen the already-painted editor to show its error.
    let overlay = app.get_webview_window(OVERLAY_LABEL);
    if let Some(window) = &overlay { crate::window_presentation::hide(window); }
    let result: Result<StoredScreenshot, String> = async {
    let annotation_count = elements.len();
    let png = tauri::async_runtime::spawn_blocking(move || {
        let source = source.png(width, height)?;
        let png = if elements.is_empty() { source } else { render_annotation_png(&source, &elements)? };
        crop_image_png(png, crop)
    }).await.map_err(|e|e.to_string())??;

    let metadata = serde_json::json!({
        "kind": "screenshot",
        "source": "zhenxia",
        "session_id": session_id,
        "mode": mode.unwrap_or_else(|| "capture".into()),
        "parent_clip_id": source_clip_id,
        "annotation_count": annotation_count,
    });

    let mut result = insert_image_history(&app, &db, &png, metadata, copy_to_clipboard).await?;
    if pin {
        pin_png(&app, &png)?;
        result.pinned = true;
    }
    Ok(result)
    }.await;
    match result {
        Ok(result) => {
            close_screenshot_window(&app);
            desktop_sessions().lock().unwrap().remove(&session_id);
            Ok(result)
        }
        Err(error) => {
            if let Some(window) = overlay { let _ = crate::window_presentation::show(&window); }
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn cancel_screenshot(app: AppHandle, session_id: String) -> Result<(), String> {
    desktop_sessions().lock().unwrap().remove(&session_id);
    close_screenshot_window(&app);
    Ok(())
}

#[tauri::command]
pub async fn screenshot_tool_action(app:AppHandle,db:tauri::State<'_,Arc<Database>>,session_id:String,crop:Option<CropRegion>,elements:Vec<AnnotationElementDto>,action:String)->Result<serde_json::Value,String>{
    if !["ocr","translate","save"].contains(&action.as_str()){return Err("Unknown screenshot action".into());}
    let (source,width,height)={let sessions=desktop_sessions().lock().unwrap();let s=sessions.get(&session_id).ok_or("Screenshot session expired")?;(s.source.clone(),s.width,s.height)};
    let png=tauri::async_runtime::spawn_blocking(move||{let mut png=source.png(width,height)?;if !elements.is_empty(){png=render_annotation_png(&png,&elements)?;}crop_image_png(png,crop)}).await.map_err(|e|e.to_string())??;
    if action=="save"{
        let output=png.clone();let dialog_app=app.clone();
        let path=tauri::async_runtime::spawn_blocking(move||save_png_dialog(&dialog_app,&output,"Zhenxia.png")).await.map_err(|e|e.to_string())??;
        insert_image_history(&app,&db,&png,serde_json::json!({"kind":"screenshot","source":"zhenxia","mode":"save"}),false).await?;
        close_screenshot_window(&app);return Ok(serde_json::json!({"path":path}));
    }
    let text=tauri::async_runtime::spawn_blocking(move||crate::components::recognize(&png).map(|r|r.text)).await.map_err(|e|e.to_string())??;
    if action=="ocr"{return Ok(serde_json::json!({"text":text,"translated":null}));}
    let preferences=crate::components::preferences();let source=preferences.translate_source.clone();let mut target=preferences.translate_target.clone();
    if source=="auto"&&crate::offline_translate::detect_language(&text)==target{target=if target=="en"{"zh".into()}else{"en".into()};}
    let input=text.clone();let translated=tauri::async_runtime::spawn_blocking(move||crate::offline_translate::translate(&input,&source,&target)).await.map_err(|e|e.to_string())??;
    Ok(serde_json::json!({"text":text,"translated":translated}))
}

pub fn toggle_pins_visible(app:&AppHandle){
    let pins=app.webview_windows().into_iter().filter(|(label,_)|label.starts_with(PIN_PREFIX)).map(|(_,w)|w).collect::<Vec<_>>();
    let hide=pins.iter().any(|w|w.is_visible().unwrap_or(false));
    for pin in pins {if hide{let _=pin.hide();}else{let _=pin.show();}}
}

#[tauri::command]
pub async fn close_screenshot_overlay(app: AppHandle) -> Result<(), String> {
    close_screenshot_window(&app);
    Ok(())
}

pub fn request_capture_close(app: &AppHandle) {
    let editing = desktop_sessions().lock().unwrap().values().any(|s| s.is_edit);
    if editing {
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            let _ = window.eval("window.dispatchEvent(new Event('zhenxia:editor-close-request'))");
        }
    } else { close_screenshot_window(app); }
}

pub fn close_screenshot_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        crate::window_presentation::hide(&window);
        let _ = window.eval("window.dispatchEvent(new Event('zhenxia:capture-reset'))");
        let _ = window.set_title("帧匣 Zhenxia");
        let _ = window.set_resizable(false);
        // Stay hidden at the existing capture size. Win+V restores its own
        // geometry before showing; repeated F1 need not resize the GPU surface twice.
        crate::webview_memory::set_active(&window, false);
    }
    desktop_sessions().lock().unwrap().clear();
    if RESTORE_SETTINGS.swap(false, Ordering::AcqRel) {
        if let Some(settings) = app.get_webview_window("settings") {
            let _ = crate::window_presentation::show(&settings);
        }
    }
}

fn suspend_settings(app: &AppHandle) {
    if let Some(settings) = app.get_webview_window("settings") {
        if settings.is_visible().unwrap_or(false) {
            RESTORE_SETTINGS.store(true, Ordering::Release);
            crate::window_presentation::hide(&settings);
        }
    }
}

fn pin_png(app: &AppHandle, png: &[u8]) -> Result<String, String> {
    let image = image::load_from_memory(png).map_err(|error| error.to_string())?;
    let (width, height) = image.dimensions();
    let id = Uuid::new_v4().to_string();
    pin_payloads().lock().unwrap().insert(
        id.clone(),
        PinPayload {
            id: id.clone(),
            png: png.to_vec(),
            width,
            height,
        },
    );

    let scale = lscreen_capture::primary_monitor_scale().unwrap_or(1.0).max(0.5);
    let win_w = (width as f64 / scale as f64).clamp(120.0, 1600.0);
    let win_h = (height as f64 / scale as f64).clamp(80.0, 1200.0);
    let (cursor_x, cursor_y) = lscreen_capture::cursor_position().unwrap_or((200, 200));
    let label = format!("{PIN_PREFIX}{id}");
    let url = format!("index.html?window=pin&pin={id}");

    WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title("帧匣贴图")
        .shadow(false)
        .inner_size(win_w, win_h)
        .position(cursor_x as f64 / scale as f64, cursor_y as f64 / scale as f64)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .build()
        .map_err(|error| { pin_payloads().lock().unwrap().remove(&id); error.to_string() })?;
    Ok(id)
}

#[tauri::command]
pub async fn get_pin_payload(pin_id: String) -> Result<serde_json::Value, String> {
    let payloads = pin_payloads().lock().unwrap();
    let payload = payloads
        .get(&pin_id)
        .ok_or_else(|| "贴图内容已释放".to_string())?;
    Ok(serde_json::json!({
        "id": payload.id,
        "imageBase64": B64.encode(&payload.png),
        "width": payload.width,
        "height": payload.height,
    }))
}

#[tauri::command]
pub async fn close_pin_window(app: AppHandle, pin_id: String) -> Result<(), String> {
    pin_payloads().lock().unwrap().remove(&pin_id);
    if let Some(window) = app.get_webview_window(&format!("{PIN_PREFIX}{pin_id}")) {
        let _ = window.close();
    }
    Ok(())
}


async fn load_clip_png(db: &Database, id: &str) -> Result<Vec<u8>, String> {
    let path: Option<String> = sqlx::query_scalar("SELECT file_path FROM clip_images WHERE clip_uuid = ?")
        .bind(id).fetch_optional(&db.pool).await.map_err(|e|e.to_string())?.flatten();
    let path = path.ok_or_else(|| "The full image is no longer available".to_string())?;
    let encrypted = std::fs::read(path).map_err(|e|e.to_string())?;
    db.crypto.decrypt(&encrypted)
}

#[tauri::command]
pub async fn save_clip_image(app: AppHandle, db: tauri::State<'_, Arc<Database>>, id: String) -> Result<String, String> {
    let png = load_clip_png(&db, &id).await?;
    tauri::async_runtime::spawn_blocking(move || save_png_dialog(&app, &png, "Zhenxia.png")).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub async fn export_image_edit(
    app: AppHandle,
    db: tauri::State<'_, Arc<Database>>,
    session_id: String,
    image_base64: String,
    action: String,
) -> Result<(), String> {
    let parent = {
        let sessions = desktop_sessions().lock().unwrap();
        let session = sessions.get(&session_id).filter(|s| s.is_edit)
            .ok_or_else(|| "Image editing session expired".to_string())?;
        session.parent_clip_id.clone()
    };
    if !matches!(action.as_str(), "copy" | "pin" | "save") {
        return Err("Unsupported image export action".into());
    }
    let png = B64.decode(image_base64).map_err(|e| e.to_string())?;
    if image::guess_format(&png).map_err(|e| e.to_string())? != image::ImageFormat::Png {
        return Err("Expected PNG image".into());
    }
    if action == "save" {
        tauri::async_runtime::spawn_blocking(move || save_png_dialog(&app, &png, "Zhenxia-edited.png"))
            .await.map_err(|e|e.to_string())??;
        return Ok(());
    }
    let metadata = serde_json::json!({
        "kind":"screenshot", "source":"zhenxia", "mode":"edit",
        "session_id":session_id, "parent_clip_id":parent, "renderer":"canvas-editor"
    });
    insert_image_history(&app, &db, &png, metadata, action == "copy").await?;
    if action == "pin" { pin_png(&app, &png)?; }
    Ok(())
}

#[tauri::command]
pub async fn edit_clip_image(app: AppHandle, db: tauri::State<'_, Arc<Database>>, id: String) -> Result<(), String> {
    if !desktop_sessions().lock().unwrap().is_empty() { return Err("Finish the current capture first".into()); }
    let png = load_clip_png(&db, &id).await?;
    open_image_editor(&app, png, Some(id)).await
}

async fn open_image_editor(app: &AppHandle, png: Vec<u8>, parent: Option<String>) -> Result<(), String> {
    let image = image::load_from_memory(&png).map_err(|e|e.to_string())?;
    let (width, height) = image.dimensions();
    let window = ensure_capture_window(app).await?;
    suspend_settings(app);
    crate::enter_capture_mode();
    crate::window_presentation::hide(&window);
    window.set_title("帧匣 · 图片编辑").map_err(|e|e.to_string())?;
    window.set_always_on_top(true).map_err(|e|e.to_string())?;
    window.set_resizable(true).map_err(|e|e.to_string())?;
    window.set_size(tauri::LogicalSize::new(1180.,800.)).map_err(|e|e.to_string())?;
    window.center().map_err(|e|e.to_string())?;
    let session = Uuid::new_v4().to_string();
    desktop_sessions().lock().unwrap().insert(session.clone(), DesktopSession {
        intent:"edit".into(),
        source:CaptureSource::Png(png.into()), width, height, origin_x:0, origin_y:0, scale:1., is_edit:true,
        parent_clip_id:parent, started:Instant::now(),
    });
    notify_capture(&window,&session)
}

#[tauri::command]
pub async fn edit_pin_image(app: AppHandle, pin_id: String) -> Result<(), String> {
    if capture_active() { return Err("Finish the current capture first".into()); }
    let png = pin_payloads().lock().unwrap().get(&pin_id)
        .ok_or_else(|| "Pinned image has been released".to_string())?.png.clone();
    open_image_editor(&app, png, None).await
}

#[tauri::command]
pub async fn edit_capture_selection(
    app: AppHandle, session_id: String, crop: Option<CropRegion>, elements: Vec<AnnotationElementDto>,
) -> Result<(), String> {
    let (source, width, height, parent) = {
        let sessions = desktop_sessions().lock().unwrap();
        let s = sessions.get(&session_id).filter(|s| !s.is_edit)
            .ok_or_else(|| "Screenshot session expired".to_string())?;
        (s.source.clone(), s.width, s.height, s.parent_clip_id.clone())
    };
    let png = tauri::async_runtime::spawn_blocking(move || {
        let source = source.png(width, height)?;
        let png = if elements.is_empty() { source } else { render_annotation_png(&source, &elements)? };
        crop_image_png(png, crop)
    }).await.map_err(|e|e.to_string())??;
    if !desktop_sessions().lock().unwrap().contains_key(&session_id) {
        return Err("Screenshot session expired".into());
    }
    open_image_editor(&app, png, parent).await?;
    desktop_sessions().lock().unwrap().remove(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn pin_clipboard_image(app: AppHandle) -> Result<String, String> {
    let ctx = clipboard_rs::ClipboardContext::new().map_err(|error| error.to_string())?;
    let image = ctx.get_image().map_err(|_| "当前剪贴板没有图片".to_string())?;
    let png = image
        .to_png()
        .map_err(|error| error.to_string())?
        .get_bytes()
        .to_vec();
    pin_png(&app, &png)
}

#[tauri::command]
pub async fn pin_clip_image(
    app: AppHandle,
    db: tauri::State<'_, Arc<Database>>,
    id: String,
) -> Result<String, String> {
    let path: Option<String> =
        sqlx::query_scalar("SELECT file_path FROM clip_images WHERE clip_uuid = ?")
            .bind(&id)
            .fetch_optional(&db.pool)
            .await
            .map_err(|error| error.to_string())?
            .flatten();
    let path = path.ok_or_else(|| "该条目没有可用原图".to_string())?;
    let encrypted = std::fs::read(&path).map_err(|error| error.to_string())?;
    let png = db.crypto.decrypt(&encrypted)?;
    pin_png(&app, &png)
}

#[tauri::command]
pub async fn save_screenshot_png(
    app: AppHandle,
    image_base64: String,
    suggested_name: Option<String>,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let bytes = B64.decode(image_base64).map_err(|error| error.to_string())?;
    let path = app
        .dialog()
        .file()
        .set_file_name(suggested_name.unwrap_or_else(|| "帧匣截图.png".into()))
        .add_filter("PNG 图片", &["png"])
        .blocking_save_file();
    let Some(path) = path else {
        return Err("已取消保存".into());
    };
    let path = path.into_path().map_err(|error| error.to_string())?;
    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deferred_capture_encoding_preserves_pixels_and_rejects_invalid_buffers() {
        let pixels: Vec<u8> = (0..6).flat_map(|i| [i * 31, 255 - i * 23, i * 17, 255]).collect();
        let source = CaptureSource::Rgba(pixels.clone().into());
        let png = source.png(3, 2).unwrap();
        assert_eq!(image::load_from_memory(&png).unwrap().to_rgba8().into_raw(), pixels);
        assert!(source.png(4, 2).is_err());
        assert_eq!(CaptureSource::Png(png.clone().into()).png(0, 0).unwrap(), png);
    }

    #[test]
    fn crops_and_rejects_invalid_selection() {
        let png = encode_png(40, 30, &vec![255; 40*30*4]).unwrap();
        let out = crop_image_png(png.clone(), Some(CropRegion { x: 10., y: 8., width: 12., height: 9. })).unwrap();
        assert_eq!(image::load_from_memory(&out).unwrap().dimensions(), (12,9));
        assert!(crop_image_png(png.clone(), Some(CropRegion { x: f32::NAN, y: 0., width: 2., height: 2. })).is_err());
        assert!(crop_image_png(png, Some(CropRegion { x: 400., y: 0., width: 2., height: 2. })).is_err());
    }

    #[test]
    fn native_pin_destruction_releases_payload() {
        let id = "test-native-close".to_string();
        pin_payloads().lock().unwrap().insert(id.clone(), PinPayload { id: id.clone(), png: vec![1], width:1, height:1 });
        release_window_resources(&format!("{PIN_PREFIX}{id}"));
        assert!(!pin_payloads().lock().unwrap().contains_key(&id));
    }

    #[test]
    fn renders_rectangle_annotation_without_panicking() {
        let mut png = Vec::new();
        image::RgbaImage::from_pixel(40, 30, image::Rgba([20, 30, 40, 255]))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageOutputFormat::Png)
            .unwrap();
        let out = render_annotation_png(
            &png,
            &[AnnotationElementDto {
                kind: "rect".into(),
                color: [229, 57, 53, 255],
                width: 3.0,
                font_size: 18.0,
                x: 5.0,
                y: 5.0,
                w: 20.0,
                h: 10.0,
                x2: 0.0,
                y2: 0.0,
                points: Vec::new(),
                text: String::new(),
                number: 0,
                bg: None,
            }],
        )
        .unwrap();
        assert_eq!(&out[..8], b"\x89PNG\r\n\x1a\n");
    }
}
