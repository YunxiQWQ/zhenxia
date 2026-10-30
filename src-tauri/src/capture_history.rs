use std::{sync::Arc,path::{Path,PathBuf}};
use tauri::{AppHandle,Manager,Emitter};
use serde::Serialize;
use sqlx::Row;
use base64::{Engine,engine::general_purpose::STANDARD as B64};
use crate::{database::Database,settings_manager::SettingsManager};

#[derive(Serialize)]pub struct CaptureEntry{pub id:String,pub thumbnail:String,pub created_at:String,pub width:u32,pub height:u32,pub kind:String,pub pinned:bool}
fn screenshot_metadata(db:&Database,mut metadata:Option<String>)->Option<serde_json::Value>{db.crypto.decrypt_optional_text(&mut metadata).ok()?;let value:serde_json::Value=serde_json::from_str(metadata.as_deref()?).ok()?;if value.get("kind").and_then(|v|v.as_str())==Some("screenshot"){Some(value)}else{None}}

pub(crate) async fn image_bytes(db:&Database,id:&str)->Result<Vec<u8>,String>{
    let row=sqlx::query("SELECT i.file_path,i.full_content FROM clip_images i JOIN clips c ON c.uuid=i.clip_uuid WHERE i.clip_uuid=? AND c.is_deleted=0 AND c.is_hidden=0").bind(id).fetch_optional(&db.pool).await.map_err(|e|e.to_string())?.ok_or("Image not found")?;
    let path:Option<String>=row.get("file_path");let blob:Vec<u8>=row.get("full_content");
    let encrypted=if let Some(path)=path {let canonical=std::fs::canonicalize(&path).map_err(|e|e.to_string())?;let root=std::fs::canonicalize(&db.image_dir).map_err(|e|e.to_string())?;if !canonical.starts_with(root){return Err("Image is outside managed storage".into());}std::fs::read(canonical).map_err(|e|e.to_string())?}else{blob};db.crypto.decrypt(&encrypted)
}

#[tauri::command]
pub async fn list_capture_history(db:tauri::State<'_,Arc<Database>>,offset:Option<u32>,limit:Option<u32>)->Result<Vec<CaptureEntry>,String>{
    let rows=sqlx::query("SELECT uuid,metadata,created_at,is_pinned FROM clips WHERE clip_type='image' AND is_deleted=0 AND is_hidden=0 AND metadata IS NOT NULL ORDER BY created_at DESC,id DESC").fetch_all(&db.pool).await.map_err(|e|e.to_string())?;
    let mut entries=Vec::new();let offset=offset.unwrap_or(0);let limit=limit.unwrap_or(60).clamp(1,120);
    for row in rows {
        let Some(metadata)=screenshot_metadata(&db,row.get("metadata")) else{continue};
        let id:String=row.get("uuid");let content:Vec<u8>=sqlx::query_scalar("SELECT content FROM clips WHERE uuid=?").bind(&id).fetch_one(&db.pool).await.map_err(|e|e.to_string())?;let preview=db.crypto.decrypt(&content)?;
        let dimensions=metadata.get("width").and_then(|v|v.as_u64()).zip(metadata.get("height").and_then(|v|v.as_u64())).map(|(w,h)|(w as u32,h as u32));
        let (width,height)=if let Some(size)=dimensions{size}else{let png=image_bytes(&db,&id).await?;image::io::Reader::with_format(std::io::Cursor::new(png),image::ImageFormat::Png).into_dimensions().map_err(|e|e.to_string())?};
        entries.push(CaptureEntry{id,thumbnail:format!("data:image/png;base64,{}",B64.encode(preview)),created_at:row.get("created_at"),width,height,kind:"screenshot".into(),pinned:row.get("is_pinned")});
        if entries.len()>=(offset+limit) as usize{break;}
    }entries.extend(crate::workflows::recording_entries(&db).await?);entries.sort_by(|a,b|b.created_at.cmp(&a.created_at));Ok(entries.into_iter().skip(offset as usize).take(limit as usize).collect())
}

#[tauri::command]
pub async fn clear_capture_history(app:AppHandle,db:tauri::State<'_,Arc<Database>>,include_pinned:bool)->Result<usize,String>{
    let rows=sqlx::query("SELECT uuid,metadata,is_pinned FROM clips WHERE clip_type='image' AND is_deleted=0 AND is_hidden=0").fetch_all(&db.pool).await.map_err(|e|e.to_string())?;let mut count=0;
    for row in rows {if !include_pinned&&row.get::<bool,_>("is_pinned"){continue;}if screenshot_metadata(&db,row.get("metadata")).is_some(){crate::commands::delete_clip_in_database(&db,&row.get::<String,_>("uuid"),false).await?;count+=1;}}
    count+=crate::workflows::clear_recordings(&db).await?;
    let _=app.emit("clipboard-change",serde_json::json!({"source":"capture-history-clear"}));Ok(count)
}
fn exports_root()->Result<PathBuf,String>{Ok(crate::components::root()?.parent().ok_or("Data folder unavailable")?.join("capture-exports"))}
#[tauri::command]
pub async fn open_capture_history_directory(db:tauri::State<'_,Arc<Database>>)->Result<String,String>{
    let root=exports_root()?;std::fs::create_dir_all(&root).map_err(|e|e.to_string())?;
    let rows=sqlx::query("SELECT uuid,metadata FROM clips WHERE clip_type='image' AND is_deleted=0 AND is_hidden=0").fetch_all(&db.pool).await.map_err(|e|e.to_string())?;
    for row in rows {if screenshot_metadata(&db,row.get("metadata")).is_none(){continue;}let id:String=row.get("uuid");if uuid::Uuid::parse_str(&id).is_err(){continue;}let png=image_bytes(&db,&id).await?;std::fs::write(root.join(format!("{id}.png")),png).map_err(|e|e.to_string())?;}
    std::process::Command::new("explorer.exe").arg(&root).spawn().map_err(|e|e.to_string())?;Ok(root.to_string_lossy().into())
}
#[tauri::command]
pub async fn choose_image_viewer(app:AppHandle)->Result<Option<String>,String>{
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move||{let mut dialog=app.dialog().file().add_filter("Image viewer",&["exe"]);if let Some(parent)=app.get_webview_window("settings"){dialog=dialog.set_parent(&parent);}dialog.blocking_pick_file().map(|p|p.into_path().map(|p|p.to_string_lossy().into()).map_err(|e|e.to_string())).transpose()}).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn open_capture_in_viewer(app:AppHandle,db:tauri::State<'_,Arc<Database>>,id:String)->Result<(),String>{
    let path=app.state::<Arc<SettingsManager>>().get().capture.viewer_path;
    if path.is_empty(){return Err("请先在组件集成中选择图片查看器".into());}
    let viewer=Path::new(&path);if !viewer.is_file()||viewer.extension().and_then(|x|x.to_str()).map(|x|!x.eq_ignore_ascii_case("exe")).unwrap_or(true){return Err("图片查看器路径无效，请重新选择".into());}
    let png=image_bytes(&db,&id).await?;let root=exports_root()?;std::fs::create_dir_all(&root).map_err(|e|e.to_string())?;
    let target=root.join(format!("{}.png",uuid::Uuid::new_v4()));std::fs::write(&target,png).map_err(|e|e.to_string())?;
    std::process::Command::new(viewer).arg(target).spawn().map_err(|e|e.to_string())?;Ok(())
}
