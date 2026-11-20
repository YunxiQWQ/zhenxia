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
pub async fn list_capture_history(
    db: tauri::State<'_, Arc<Database>>,
    offset: Option<u32>,
    limit: Option<u32>,
    kind: Option<String>,
    query: Option<String>,
) -> Result<Vec<CaptureEntry>, String> {
    list_capture_page(
        &db,
        offset.unwrap_or(0) as usize,
        limit.unwrap_or(18).clamp(1, 120) as usize,
        kind.as_deref().unwrap_or("all"),
        query.as_deref().unwrap_or("").trim(),
    )
    .await
}

async fn list_capture_page(
    db: &Database,
    offset: usize,
    limit: usize,
    kind: &str,
    query: &str,
) -> Result<Vec<CaptureEntry>, String> {
    crate::workflows::ensure_recordings_table(db).await?;
    // Sort only metadata. The two sources store UTC timestamps in different
    // formats, so textual comparison would put all recordings above every
    // screenshot from the same date.
    let rows = sqlx::query(
        "SELECT * FROM (
            SELECT uuid AS id, metadata, created_at, is_pinned, 0 AS recording,
                   0 AS width, 0 AS height, julianday(created_at) AS sort_time
            FROM clips
            WHERE ?1 != 'recording' AND clip_type = 'image'
                AND is_deleted = 0 AND is_hidden = 0 AND metadata IS NOT NULL
            UNION ALL
            SELECT id, NULL, created_at, 0, 1, width, height, julianday(created_at)
            FROM capture_recordings WHERE ?1 != 'screenshot'
        ) ORDER BY sort_time DESC, recording DESC, id DESC",
    )
    .bind(kind)
    .fetch_all(&db.pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut entries = Vec::with_capacity(limit);
    let mut skip = offset;
    for row in rows {
        let recording: bool = row.get("recording");
        let metadata = if recording {
            None
        } else {
            let Some(metadata) = screenshot_metadata(db, row.get("metadata")) else {
                continue;
            };
            Some(metadata)
        };
        let id: String = row.get("id");
        let created_at: String = row.get("created_at");
        let search_size = !query.is_empty() && !created_at.contains(query);
        // Pages without a size filter can skip older rows without opening their
        // original images even when their metadata predates stored dimensions.
        if skip > 0 && !search_size {
            skip -= 1;
            continue;
        }
        let (width, height) = if recording {
            (row.get::<i64, _>("width") as u32, row.get::<i64, _>("height") as u32)
        } else {
            let saved_size = metadata.as_ref().and_then(|value| {
                let width = u32::try_from(value.get("width")?.as_u64()?).ok()?;
                let height = u32::try_from(value.get("height")?.as_u64()?).ok()?;
                (width > 0 && height > 0).then_some((width, height))
            });
            match saved_size {
                Some(size) => size,
                None => image_bytes(db, &id)
                    .await
                    .ok()
                    .and_then(|png| png_dimensions(&png))
                    .unwrap_or_default(),
            }
        };
        if search_size && !format!("{created_at} {width}×{height}").contains(query) {
            continue;
        }
        if skip > 0 {
            skip -= 1;
            continue;
        }
        entries.push(CaptureEntry {
            id,
            thumbnail: String::new(),
            created_at,
            width,
            height,
            kind: if recording { "recording" } else { "screenshot" }.into(),
            pinned: row.get("is_pinned"),
        });
        if entries.len() == limit {
            break;
        }
    }

    load_thumbnails(db, &mut entries, "screenshot").await?;
    load_thumbnails(db, &mut entries, "recording").await?;
    Ok(entries)
}

fn png_dimensions(png: &[u8]) -> Option<(u32, u32)> {
    image::io::Reader::with_format(std::io::Cursor::new(png), image::ImageFormat::Png)
        .into_dimensions()
        .ok()
}

async fn load_thumbnails(
    db: &Database,
    entries: &mut [CaptureEntry],
    kind: &str,
) -> Result<(), String> {
    let mut page: Vec<_> = entries.iter_mut().filter(|entry| entry.kind == kind).collect();
    if page.is_empty() {
        return Ok(());
    }
    let mut sql = sqlx::QueryBuilder::new(if kind == "recording" {
        "SELECT id, thumbnail FROM capture_recordings WHERE id IN ("
    } else {
        "SELECT uuid, content FROM clips WHERE is_deleted = 0 AND is_hidden = 0 AND uuid IN ("
    });
    {
        let mut ids = sql.separated(", ");
        for entry in &page {
            ids.push_bind(&entry.id);
        }
    }
    sql.push(")");
    let thumbnails = sql.build_query_as::<(String, Vec<u8>)>()
        .fetch_all(&db.pool)
        .await
        .map_err(|e| e.to_string())?;
    drop(sql);
    let mut thumbnails: std::collections::HashMap<_, _> = thumbnails.into_iter().collect();
    for entry in &mut page {
        let Some(preview) = thumbnails.remove(&entry.id).and_then(|bytes| db.crypto.decrypt(&bytes).ok()) else {
            continue;
        };
        if entry.width == 0 || entry.height == 0 {
            (entry.width, entry.height) = png_dimensions(&preview).unwrap_or_default();
        }
        entry.thumbnail = format!("data:image/png;base64,{}", B64.encode(preview));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn capture_pages_merge_timestamps_and_survive_a_damaged_thumbnail() {
        let db = Database {
            pool: SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap(),
            crypto: Arc::new(crate::crypto::CryptoManager::ephemeral()),
            image_dir: PathBuf::new(),
            search_index: Default::default(),
        };
        db.migrate().await.unwrap();
        crate::workflows::ensure_recordings_table(&db).await.unwrap();
        let preview = db.crypto.encrypt(b"thumbnail bytes").unwrap();
        let metadata = db
            .crypto
            .encrypt_text(r#"{"kind":"screenshot","width":1920,"height":1080}"#)
            .unwrap();
        for (id, time, thumbnail, hidden) in [
            ("recent", "2026-11-20 12:03:00", &preview[..], false),
            ("damaged", "2026-11-20 12:02:00", &b"bad cipher"[..], false),
            ("hidden", "2026-11-20 12:05:00", &preview[..], true),
        ] {
            sqlx::query("INSERT INTO clips (uuid,clip_type,content,content_hash,metadata,created_at,is_hidden,full_image_expired) VALUES (?,'image',?,?,?,?,?,1)")
                .bind(id)
                .bind(thumbnail)
                .bind(id)
                .bind(&metadata)
                .bind(time)
                .bind(hidden)
                .execute(&db.pool)
                .await
                .unwrap();
        }
        sqlx::query("INSERT INTO capture_recordings VALUES ('movie','2026-11-20T12:02:30+00:00','',?,1280,720,1000,'mp4')")
            .bind(&preview)
            .execute(&db.pool)
            .await
            .unwrap();

        let first = list_capture_page(&db, 0, 2, "all", "").await.unwrap();
        assert_eq!(first.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), ["recent", "movie"]);
        assert!(first[0].thumbnail.starts_with("data:image/png;base64,"));

        let next = list_capture_page(&db, 2, 2, "all", "").await.unwrap();
        assert_eq!(next.len(), 1);
        assert_eq!(next[0].id, "damaged");
        assert!(next[0].thumbnail.is_empty());

        let matches = list_capture_page(&db, 0, 2, "screenshot", "1920×1080")
            .await
            .unwrap();
        assert_eq!(matches.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), ["recent", "damaged"]);
        let movies = list_capture_page(&db, 0, 2, "recording", "2026-11-20").await.unwrap();
        assert_eq!(movies.len(), 1);
        assert_eq!(movies[0].id, "movie");
    }
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
    let viewer=Path::new(&path);if !path.is_empty()&&(!viewer.is_file()||viewer.extension().and_then(|x|x.to_str()).map(|x|!x.eq_ignore_ascii_case("exe")).unwrap_or(true)){return Err("图片查看器路径无效，请重新选择或移除关联以使用系统默认程序 / Invalid viewer; choose another or reset to the system default".into());}
    let png=image_bytes(&db,&id).await?;let root=exports_root()?;std::fs::create_dir_all(&root).map_err(|e|e.to_string())?;
    let target=root.join(format!("{}.png",uuid::Uuid::new_v4()));std::fs::write(&target,png).map_err(|e|e.to_string())?;
    if path.is_empty(){
        use tauri_plugin_opener::OpenerExt;
        app.opener().open_path(target.to_string_lossy(),None::<&str>).map_err(|e|e.to_string())?;
    }else{std::process::Command::new(viewer).arg(target).spawn().map_err(|e|e.to_string())?;}
    Ok(())
}
