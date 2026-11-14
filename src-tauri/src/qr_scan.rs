//! Production QR entry points reuse LaterScreen's rqrr decoder, entirely offline.
use std::{io::Cursor, sync::Arc};
use tauri::AppHandle;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use crate::database::Database;

pub(crate) fn detect(bytes: &[u8]) -> Result<Vec<String>, String> {
    let reader = image::io::Reader::new(Cursor::new(bytes)).with_guessed_format().map_err(|e| e.to_string())?;
    let (width, height) = reader.into_dimensions().map_err(|e| e.to_string())?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 48_000_000 {
        return Err("图片过大 / Image exceeds the QR scan size limit".into());
    }
    let image = image::load_from_memory(bytes).map_err(|e| e.to_string())?.to_rgba8();
    let mut codes = Vec::new();
    for result in lscreen_core::qr::detect(image.as_raw(), width, height) {
        if !codes.contains(&result.content) { codes.push(result.content); }
    }
    Ok(codes)
}

#[tauri::command]
pub async fn scan_qr_image(image_base64: String) -> Result<Vec<String>, String> {
    if image_base64.len() > 96 * 1024 * 1024 { return Err("Image is too large".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        detect(&B64.decode(image_base64).map_err(|e| e.to_string())?)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scan_clip_qr(db: tauri::State<'_, Arc<Database>>, id: String) -> Result<Vec<String>, String> {
    let image = crate::capture_history::image_bytes(&db, &id).await?;
    tauri::async_runtime::spawn_blocking(move || detect(&image)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn start_qr_capture(app: AppHandle) -> Result<(), String> {
    crate::zhenxia::start_screenshot_with_intent(app, "qr".into()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decodes_real_png_without_models_and_preserves_unicode() {
        let content = "https://example.com/扫一扫?q=测试";
        let image = lscreen_core::qr::generate(content, lscreen_core::qr::Ecc::M, 6, 4).unwrap();
        let image = image::RgbaImage::from_raw(image.width(), image.height(), image.into_raw()).unwrap();
        let mut png = Cursor::new(Vec::new());
        image.write_to(&mut png, image::ImageOutputFormat::Png).unwrap();
        assert_eq!(detect(png.get_ref()).unwrap(), vec![content]);
        if let Some(path) = std::env::var_os("ZHENXIA_QR_TEST_OUTPUT") { std::fs::write(path, png.get_ref()).unwrap(); }
        assert!(detect(b"invalid image").is_err());
    }
    #[test]
    fn empty_picture_does_not_invent_a_code() {
        let image = image::RgbaImage::from_pixel(128, 128, image::Rgba([255, 255, 255, 255]));
        let mut png = Cursor::new(Vec::new());
        image.write_to(&mut png, image::ImageOutputFormat::Png).unwrap();
        assert!(detect(png.get_ref()).unwrap().is_empty());
    }
}
