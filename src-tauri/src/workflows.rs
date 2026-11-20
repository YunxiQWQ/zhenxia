//! User-started scrolling capture and recording. All workers are in-process.
use std::{sync::{Arc,Mutex,OnceLock,atomic::{AtomicBool,AtomicU64,Ordering}},time::{Duration,Instant},path::{Path,PathBuf},io::{Read,Write}};
use tauri::{AppHandle,Manager,Emitter};
use serde::{Deserialize,Serialize};
use base64::{Engine,engine::general_purpose::STANDARD as B64};
use image::RgbaImage;
use crate::{database::Database,scroll_stitch::ScrollStitch};

#[derive(Clone,Copy,Deserialize,Serialize)]pub struct Region{pub x:i32,pub y:i32,pub width:u32,pub height:u32}
struct Scroll{ id:String,region:Region,stitch:ScrollStitch,message:String,auto:bool,revision:u64,driving:bool,armed:Instant,target:Option<crate::scroll_control::Target>,unchanged:u32 }
struct Recording{stop:AtomicBool,cancel:AtomicBool,pause:AtomicBool,frames:AtomicU64,elapsed:AtomicU64,done:AtomicBool,worker:Mutex<Option<std::thread::JoinHandle<Result<RawVideo,String>>>>,region:Region,format:String,backend:Mutex<String>,result:Mutex<Option<Arc<RawVideo>>>}
struct RawVideo{path:PathBuf,thumbnail:Vec<u8>,duration:u64}
impl Drop for RawVideo{fn drop(&mut self){let _=std::fs::remove_file(&self.path);}}
enum Session{Scroll(Scroll),Record(Arc<Recording>)}
static CONTROL_READY:AtomicBool=AtomicBool::new(false);
static PRESENTATION_READY:AtomicBool=AtomicBool::new(false);
static RESTORE_WORKFLOW_SETTINGS:AtomicBool=AtomicBool::new(false);
fn session()->&'static Mutex<Option<Session>>{static S:OnceLock<Mutex<Option<Session>>>=OnceLock::new();S.get_or_init(||Mutex::new(None))}
fn capture(r:Region)->Result<RgbaImage,String>{let shot=lscreen_capture::capture_region(r.x,r.y,r.width,r.height).map_err(|e|e.to_string())?;RgbaImage::from_raw(shot.width,shot.height,shot.rgba).ok_or("Invalid capture buffer".into())}
fn png(image:&RgbaImage)->Result<Vec<u8>,String>{let mut out=std::io::Cursor::new(Vec::new());image.write_to(&mut out,image::ImageOutputFormat::Png).map_err(|e|e.to_string())?;Ok(out.into_inner())}
fn root()->Result<PathBuf,String>{let p=crate::components::root()?.parent().ok_or("Data directory unavailable")?.join("recordings");std::fs::create_dir_all(&p).map_err(|e|e.to_string())?;Ok(p)}

pub fn available()->bool{session().lock().unwrap().is_none()}

#[tauri::command]
pub async fn start_workflow_from_capture(app:AppHandle,session_id:String,kind:String,crop:crate::zhenxia::CropRegion)->Result<(),String>{
    if !["scroll","record"].contains(&kind.as_str())||!available(){return Err("请先完成当前捕获 / Finish the active capture first".into());}
    let region=crate::zhenxia::workflow_region(&session_id,&crop)?;
    let window=app.get_webview_window("main").ok_or("Capture window unavailable")?;
    crate::window_presentation::hide(&window);
    let result=async {
        // Do not sample the frozen selection overlay while hide is still queued.
        for _ in 0..200 {
            if !window.is_visible().map_err(|e|e.to_string())? {break;}
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        if window.is_visible().map_err(|e|e.to_string())?{return Err("Capture overlay did not hide".into());}
        #[cfg(windows)]
        tauri::async_runtime::spawn_blocking(||unsafe{let _=windows::Win32::Graphics::Dwm::DwmFlush();}).await.map_err(|e|e.to_string())?;
        start_region_workflow(app.clone(),kind,region).await
    }.await;
    match result {
        Ok(())=>{let restore=crate::zhenxia::detach_capture_for_workflow(&app);RESTORE_WORKFLOW_SETTINGS.store(restore,Ordering::Release);Ok(())},
        Err(error)=>{let _=crate::window_presentation::show(&window);Err(error)}
    }
}

fn restore_workflow_settings(app:&AppHandle){
    if RESTORE_WORKFLOW_SETTINGS.swap(false,Ordering::AcqRel){
        if let Some(window)=app.get_webview_window("settings"){let _=crate::window_presentation::show(&window);}
    }
}
pub(crate) fn controls_closed(app:&AppHandle){cancel_active();restore_workflow_settings(app);}
#[tauri::command]
pub async fn start_region_workflow(app:AppHandle,kind:String,region:Region)->Result<(),String>{
    if !available(){return Err("请先完成当前长截图或录屏 / Finish the active capture first".into());}
    if region.width<32||region.height<96||region.width>8192||region.height>8192||region.width as u64*region.height as u64>16_000_000{return Err("请选择32×96至1600万像素以内的区域 / Invalid capture region".into());}
    let kind_copy=kind.clone();
    tauri::async_runtime::spawn_blocking(move||->Result<(),String>{
        let mut guard=session().lock().unwrap();if guard.is_some(){return Err("A capture is already active".into());}
        if kind_copy=="scroll"{*guard=Some(Session::Scroll(Scroll{id:uuid::Uuid::new_v4().to_string(),region,stitch:ScrollStitch::new(capture(region)?)?,message:String::new(),auto:true,revision:0,driving:false,armed:Instant::now(),target:crate::scroll_control::target(region),unchanged:0}));}
        else if kind_copy=="record"{*guard=Some(Session::Record(Arc::new(Recording{stop:AtomicBool::new(false),cancel:AtomicBool::new(false),pause:AtomicBool::new(false),frames:AtomicU64::new(0),elapsed:AtomicU64::new(0),done:AtomicBool::new(false),worker:Mutex::new(None),region,format:String::new(),backend:Mutex::new(String::new()),result:Mutex::new(None)})));}
        else{return Err("Unknown capture mode".into());}Ok(())
    }).await.map_err(|e|e.to_string())??;
    if let Err(error)=show_controls(&app){cancel_active();return Err(error);}
    if kind=="scroll"{let id={let guard=session().lock().unwrap();match guard.as_ref(){Some(Session::Scroll(s))=>s.id.clone(),_=>return Err("Capture ended".into())}};std::thread::spawn(move||{loop{std::thread::sleep(Duration::from_millis(700));let active={let g=session().lock().unwrap();match g.as_ref(){Some(Session::Scroll(s)) if s.id==id=>Some(s.auto),_=>None}};match active{Some(true)=>{match drive_scroll(){Ok(true)=>std::thread::sleep(Duration::from_millis(250)),Ok(false)=>{},Err(_)=>continue}let _=sample_inner();},Some(false)=>{},None=>break}}});}
    Ok(())
}
pub(crate) fn show_controls(app:&AppHandle)->Result<(),String>{
    let region={let guard=session().lock().unwrap();match guard.as_ref(){Some(Session::Scroll(s))=>s.region,Some(Session::Record(r))=>r.region,None=>return Err("没有正在进行的长截图或录屏 / No active capture".into())}};
    if let Some(w)=app.get_webview_window("workflow"){w.show().map_err(|e|e.to_string())?;return Ok(());}
    CONTROL_READY.store(false,Ordering::Release);
    let w=tauri::WebviewWindowBuilder::new(app,"workflow",tauri::WebviewUrl::App("index.html?window=workflow".into())).title("帧匣 · 捕获控制").inner_size(360.,420.).visible(false).decorations(false).minimizable(false).maximizable(false).transparent(true).shadow(false).always_on_top(true).skip_taskbar(true).focused(false).resizable(false).disable_drag_drop_handler().build().map_err(|e|e.to_string())?;
    let monitor=w.available_monitors().unwrap_or_default().into_iter().find(|m|{
        let p=m.position();let s=m.size();let x=region.x+region.width as i32/2;let y=region.y+region.height as i32/2;
        x>=p.x&&y>=p.y&&x<p.x+s.width as i32&&y<p.y+s.height as i32
    }).or_else(||w.current_monitor().ok().flatten());
    if let Some(m)=monitor{
        let area=m.work_area();let scale=m.scale_factor();
        let (x,y)=control_origin(Region{x:area.position.x,y:area.position.y,width:area.size.width,height:area.size.height},region,(360.*scale) as i32,(420.*scale) as i32);
        let _=w.set_position(tauri::PhysicalPosition::new(x,y));
    }
    #[cfg(windows)]if let Ok(h)=w.hwnd(){unsafe{use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity,WDA_EXCLUDEFROMCAPTURE};let _=SetWindowDisplayAffinity(windows::Win32::Foundation::HWND(h.0 as _),WDA_EXCLUDEFROMCAPTURE);}}
    crate::window_presentation::refresh_shape(&w);CONTROL_READY.store(true,Ordering::Release);Ok(())
}

fn control_origin(work:Region,region:Region,width:i32,height:i32)->(i32,i32){
    let candidates=[(region.x+region.width as i32+12,region.y),(region.x-width-12,region.y),
        (region.x,region.y+region.height as i32+12),(region.x,region.y-height-12),
        (work.x+work.width as i32-width-12,work.y+12),(work.x+12,work.y+12)];
    let clamp=|x:i32,y:i32|(x.clamp(work.x,(work.x+work.width as i32-width).max(work.x)),y.clamp(work.y,(work.y+work.height as i32-height).max(work.y)));
    candidates.into_iter().map(|(x,y)|clamp(x,y)).min_by_key(|&(x,y)|{
        let w=(x+width).min(region.x+region.width as i32)-x.max(region.x);
        let h=(y+height).min(region.y+region.height as i32)-y.max(region.y);
        w.max(0) as u64*h.max(0) as u64
    }).unwrap()
}

#[cfg(test)]mod placement_tests{
    use super::*;
    #[test]fn controls_avoid_the_selected_region_when_space_is_available(){
        for (work,region,width,height) in [
            (Region{x:0,y:0,width:2560,height:1400},Region{x:1700,y:80,width:640,height:480},360,420),
            (Region{x:-1920,y:0,width:1920,height:1080},Region{x:-1920,y:20,width:1200,height:800},540,630),
        ]{
            let (x,y)=control_origin(work,region,width,height);
            assert!(x>=work.x&&y>=work.y&&x+width<=work.x+work.width as i32&&y+height<=work.y+work.height as i32);
            assert!(x>=region.x+region.width as i32||x+width<=region.x||y>=region.y+region.height as i32||y+height<=region.y);
        }
    }
    #[test]fn full_screen_selection_keeps_controls_within_the_work_area(){
        let work=Region{x:-1280,y:-720,width:1280,height:720};
        let (x,y)=control_origin(work,work,360,420);
        assert!(x>=-1280&&y>=-720&&x+360<=0&&y+420<=0);
    }
}
pub fn cancel_active(){let mut guard=session().lock().unwrap();if let Some(Session::Record(r))=guard.as_ref(){r.cancel.store(true,Ordering::Release);r.stop.store(true,Ordering::Release);}*guard=None;}
#[tauri::command]pub fn cancel_workflow(app:AppHandle){cancel_active();if let Some(w)=app.get_webview_window("workflow"){let _=w.destroy();}restore_workflow_settings(&app);}
fn sample_inner()->Result<bool,String>{
    let (id,region,revision)={let g=session().lock().unwrap();match g.as_ref(){Some(Session::Scroll(s))=>(s.id.clone(),s.region,s.revision),_=>return Err("No scrolling capture".into())}};
    let frame=capture(region)?;let mut g=session().lock().unwrap();let Some(Session::Scroll(s))=g.as_mut() else{return Err("Capture ended".into())};if s.id!=id||s.revision!=revision{return Err("Capture changed".into());}
    match s.stitch.append(frame){
        Ok(changed)=>{
            if changed{s.unchanged=0;s.message=String::new();}
            else if s.driving&&s.armed.elapsed()>Duration::from_secs(2){s.unchanged+=1;if s.unchanged>=3{s.driving=false;s.auto=false;s.message="已暂停：到底或页面未变化，可完成保存 / Paused: end reached or page unchanged; finish to save".into();}}
            else{s.message="向下滚动页面，保持至少一半重叠 / Scroll down, keeping half the region overlapping".into();}
            Ok(changed)
        },
        Err(e)=>{s.message=e.clone();s.auto=false;s.driving=false;s.revision+=1;Err(e)}
    }
}
#[tauri::command]pub async fn sample_scroll()->Result<bool,String>{tauri::async_runtime::spawn_blocking(sample_inner).await.map_err(|e|e.to_string())?}
#[tauri::command]pub fn set_scroll_auto(enabled:bool){if let Some(Session::Scroll(s))=session().lock().unwrap().as_mut(){s.auto=enabled;if !enabled{s.driving=false;}s.revision+=1;}}

#[tauri::command]
pub fn set_scroll_driving(enabled:bool)->Result<(),String>{
    let mut guard=session().lock().unwrap();let Some(Session::Scroll(s))=guard.as_mut()else{return Err("No scrolling capture".into())};
    if enabled&&s.target.is_none(){return Err("未找到可滚动的原窗口，请使用手动滚动 / Use manual scrolling for this region".into());}
    s.driving=enabled;s.armed=Instant::now();s.unchanged=0;s.revision+=1;
    if enabled{s.auto=true;s.message="两秒后开始，请把鼠标移入选区；移出即暂停 / Starts in two seconds; move the pointer into the region. Leaving pauses scrolling".into();}
    else{s.message=String::new();}
    Ok(())
}
fn drive_scroll()->Result<bool,String>{
    let mut guard=session().lock().unwrap();let Some(Session::Scroll(s))=guard.as_mut()else{return Ok(false)};
    if !s.driving||s.armed.elapsed()<Duration::from_secs(2){return Ok(false);}
    let Some(target)=s.target else{return Ok(false)};
    match crate::scroll_control::step(target,s.region){Ok(())=>Ok(true),Err(error)=>{s.driving=false;s.auto=false;s.revision+=1;s.message=error.clone();Err(error)}}
}

#[tauri::command]pub fn undo_scroll()->bool{if let Some(Session::Scroll(s))=session().lock().unwrap().as_mut(){s.auto=false;s.driving=false;s.revision+=1;s.message="已撤销，自动采集已暂停 / Undone; automatic capture paused".into();return s.stitch.undo();}false}
#[tauri::command]pub async fn workflow_status()->Result<serde_json::Value,String>{
    let g=session().lock().unwrap();Ok(match g.as_ref(){
        Some(Session::Scroll(s))=>serde_json::json!({"kind":"scroll","width":s.stitch.width,"height":s.stitch.height,"frames":s.stitch.frames,"auto":s.auto,"driving":s.driving,"canAutoScroll":s.target.is_some(),"canUndo":s.stitch.can_undo(),"message":s.message,"preview":format!("data:image/png;base64,{}",B64.encode(png(&s.stitch.preview())?))}),
        Some(Session::Record(r))=>serde_json::json!({"kind":"record","width":r.region.width,"height":r.region.height,"frames":r.frames.load(Ordering::Acquire),"elapsed":r.elapsed.load(Ordering::Acquire),"paused":r.pause.load(Ordering::Acquire),"done":r.done.load(Ordering::Acquire),"started":r.worker.lock().unwrap().is_some()||r.result.lock().unwrap().is_some(),"format":r.format,"backend":r.backend.lock().unwrap().clone()}),None=>serde_json::json!({"kind":"none"})})
}
#[tauri::command]pub async fn finish_scroll(app:AppHandle,db:tauri::State<'_,Arc<Database>>)->Result<String,String>{
    let (id,image)={let mut guard=session().lock().unwrap();match guard.as_mut(){Some(Session::Scroll(s))=>{s.auto=false;s.driving=false;s.revision+=1;(s.id.clone(),s.stitch.image())},_=>return Err("No scrolling capture".into())}};
    let bytes=tauri::async_runtime::spawn_blocking(move||png(&image)).await.map_err(|e|e.to_string())??;
    let stored=crate::zhenxia::insert_image_history(&app,&db,&bytes,serde_json::json!({"kind":"screenshot","source":"zhenxia","mode":"scroll"}),false).await?;
    {let mut g=session().lock().unwrap();if matches!(g.as_ref(),Some(Session::Scroll(s)) if s.id==id){*g=None;}}
    let restore=RESTORE_WORKFLOW_SETTINGS.swap(false,Ordering::AcqRel);
    if let Some(w)=app.get_webview_window("workflow"){let _=w.destroy();}
    if let Err(error)=crate::zhenxia::edit_clip_image(app.clone(),db,stored.id.clone()).await{
        RESTORE_WORKFLOW_SETTINGS.store(restore,Ordering::Release);restore_workflow_settings(&app);return Err(error);
    }
    crate::zhenxia::restore_settings_when_editor_closes(restore);Ok(stored.id)
}

#[tauri::command]pub fn begin_recording(format:String,fps:u32)->Result<(),String>{
    if !["gif","mp4"].contains(&format.as_str())||!(1..=30).contains(&fps){return Err("Invalid recording format/rate".into());}
    let mut g=session().lock().unwrap();let Some(Session::Record(old))=g.as_ref()else{return Err("No recording region".into())};
    if old.worker.lock().unwrap().is_some(){return Err("Recording already started".into());}
    let mut region=old.region;region.width&=!1;region.height&=!1;
    if format=="gif"&&region.width as u64*region.height as u64>2_100_000{return Err("GIF请选择210万像素以内的区域，大区域请用MP4 / Use MP4 for larger regions".into());}
    let control=Arc::new(Recording{region,format:format.clone(),backend:Mutex::new(String::new()),result:Mutex::new(None),stop:AtomicBool::new(false),cancel:AtomicBool::new(false),pause:AtomicBool::new(false),frames:AtomicU64::new(0),elapsed:AtomicU64::new(0),done:AtomicBool::new(false),worker:Mutex::new(None)});
    let output=root()?.join(format!("active-{}.{}",uuid::Uuid::new_v4(),format));let c=control.clone();
    let worker=std::thread::spawn(move||{let result=record_loop(&c,&output,&format,fps);c.done.store(true,Ordering::Release);if result.is_err(){let _=std::fs::remove_file(&output);}result});
    *control.worker.lock().unwrap()=Some(worker);*g=Some(Session::Record(control));Ok(())
}
fn record_loop(c:&Recording,path:&Path,format:&str,fps:u32)->Result<RawVideo,String>{
    let (mut source,backend)=crate::record_capture::Frames::new(c.region,fps);*c.backend.lock().unwrap()=backend.into();let first=source.frame()?;let thumbnail=png(&image::imageops::thumbnail(&first,320,200))?;let mut encoder=crate::record_encoder::Encoder::new(path,format,c.region.width,c.region.height,fps)?;
    let period=Duration::from_micros(1_000_000/fps as u64);let mut elapsed=Duration::ZERO;let mut last_tick=Instant::now();
    loop{
        if c.stop.load(Ordering::Acquire){break;}
        if c.pause.load(Ordering::Acquire){source.pause(true);std::thread::sleep(Duration::from_millis(80));last_tick=Instant::now();continue;}
        source.pause(false);let tick=Instant::now();let step=tick.duration_since(last_tick);elapsed+=step;last_tick=tick;
        let duration=if format=="gif"{period.max(step)}else{period};
        encoder.frame(source.frame()?,elapsed.as_nanos() as u64/100,duration.as_nanos() as u64/100)?;
        c.frames.fetch_add(1,Ordering::AcqRel);c.elapsed.store(elapsed.as_millis() as u64,Ordering::Release);
        if elapsed>Duration::from_secs(1800)||std::fs::metadata(path).map(|m|m.len()>512*1024*1024).unwrap_or(false){break;}
        if let Some(wait)=period.checked_sub(tick.elapsed()){std::thread::sleep(wait);}
    }
    encoder.finish()?;
    if c.cancel.load(Ordering::Acquire){return Err("Recording cancelled".into());}
    if c.frames.load(Ordering::Acquire)==0{return Err("No frames recorded".into());}
    Ok(RawVideo{path:path.to_path_buf(),thumbnail,duration:elapsed.as_millis() as u64})
}
#[tauri::command]pub fn pause_recording(paused:bool){if let Some(Session::Record(r))=session().lock().unwrap().as_ref(){r.pause.store(paused,Ordering::Release);}}
pub(crate) async fn ensure_recordings_table(db:&Database)->Result<(),String>{sqlx::query("CREATE TABLE IF NOT EXISTS capture_recordings(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,path TEXT NOT NULL,thumbnail BLOB NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,duration INTEGER NOT NULL,format TEXT NOT NULL)").execute(&db.pool).await.map_err(|e|e.to_string())?;Ok(())}
#[tauri::command]pub async fn finish_recording(app:AppHandle,db:tauri::State<'_,Arc<Database>>)->Result<String,String>{
    let c={let g=session().lock().unwrap();match g.as_ref(){Some(Session::Record(r))=>r.clone(),_=>return Err("No recording".into())}};
    c.stop.store(true,Ordering::Release);
    let cached=c.result.lock().unwrap().clone();
    let raw=if let Some(raw)=cached{raw}else{
        let worker=c.worker.lock().unwrap().take().ok_or("Recording is not started or is finishing")?;
        let result=tauri::async_runtime::spawn_blocking(move||worker.join().map_err(|_|"Recording worker failed".to_string())?).await.map_err(|e|e.to_string())?;
        let raw=match result{Ok(raw)=>Arc::new(raw),Err(error)=>{cancel_active();return Err(error)}};
        *c.result.lock().unwrap()=Some(raw.clone());raw
    };
    let id=uuid::Uuid::new_v4().to_string();let target=root()?.join(format!("{id}.zxrec"));
    seal_file(&db,&raw.path,&target)?;ensure_recordings_table(&db).await?;
    sqlx::query("INSERT INTO capture_recordings VALUES(?,?,?,?,?,?,?,?)").bind(&id).bind(chrono::Utc::now().to_rfc3339()).bind(target.to_string_lossy().as_ref()).bind(db.crypto.encrypt(&raw.thumbnail)?).bind(c.region.width).bind(c.region.height).bind(raw.duration as i64).bind(&c.format).execute(&db.pool).await.map_err(|e|e.to_string())?;
    *session().lock().unwrap()=None;RESTORE_WORKFLOW_SETTINGS.store(false,Ordering::Release);let _=app.emit("clipboard-change",serde_json::json!({"source":"recording"}));if let Some(w)=app.get_webview_window("workflow"){let _=w.destroy();}
    crate::commands::open_settings_section(app,"captures".into()).await?;Ok(id)
}
fn seal_file(db:&Database,source:&Path,target:&Path)->Result<(),String>{
    let mut source=std::io::BufReader::new(std::fs::File::open(source).map_err(|e|e.to_string())?);let length=source.get_ref().metadata().map_err(|e|e.to_string())?.len();
    let mut out=std::io::BufWriter::new(std::fs::File::create(target).map_err(|e|e.to_string())?);out.write_all(b"ZXREC01").and_then(|_|out.write_all(&length.to_le_bytes())).map_err(|e|e.to_string())?;
    let mut buffer=vec![0u8;1024*1024];loop{let n=source.read(&mut buffer).map_err(|e|e.to_string())?;if n==0{break;}let encrypted=db.crypto.encrypt(&buffer[..n])?;out.write_all(&(encrypted.len() as u32).to_le_bytes()).and_then(|_|out.write_all(&encrypted)).map_err(|e|e.to_string())?;}out.flush().map_err(|e|e.to_string())
}
#[tauri::command]pub async fn export_recording(app:AppHandle,db:tauri::State<'_,Arc<Database>>,id:String)->Result<Option<String>,String>{
    use sqlx::Row;use tauri_plugin_dialog::DialogExt;
    ensure_recordings_table(&db).await?;let row=sqlx::query("SELECT path,format FROM capture_recordings WHERE id=?").bind(&id).fetch_one(&db.pool).await.map_err(|e|e.to_string())?;let format:String=row.get("format");
    let path:PathBuf=std::fs::canonicalize(row.get::<String,_>("path")).map_err(|e|e.to_string())?;if !path.starts_with(std::fs::canonicalize(root()?).map_err(|e|e.to_string())?){return Err("Recording is outside managed storage".into());}
    let ext=format.clone();let chosen=tauri::async_runtime::spawn_blocking(move||app.dialog().file().add_filter("Video",&[ext.as_str()]).set_file_name(format!("Zhenxia-{}.{}",chrono::Local::now().format("%Y%m%d-%H%M%S"),ext)).blocking_save_file()).await.map_err(|e|e.to_string())?;
    let Some(chosen)=chosen else{return Ok(None)};let output=chosen.into_path().map_err(|e|e.to_string())?;
    let mut input=std::io::BufReader::new(std::fs::File::open(path).map_err(|e|e.to_string())?);let mut head=[0;15];input.read_exact(&mut head).map_err(|e|e.to_string())?;if &head[..7]!=b"ZXREC01"{return Err("Invalid recording file".into());}let mut remaining=u64::from_le_bytes(head[7..].try_into().unwrap());
    let mut out=std::io::BufWriter::new(std::fs::File::create(&output).map_err(|e|e.to_string())?);
    while remaining>0{let mut length=[0;4];input.read_exact(&mut length).map_err(|e|e.to_string())?;let length=u32::from_le_bytes(length) as usize;if length>1_048_704{return Err("Invalid recording chunk".into());}let mut bytes=vec![0;length];input.read_exact(&mut bytes).map_err(|e|e.to_string())?;let plain=db.crypto.decrypt(&bytes)?;if plain.len() as u64>remaining{return Err("Invalid recording length".into());}out.write_all(&plain).map_err(|e|e.to_string())?;remaining-=plain.len() as u64;}
    out.flush().map_err(|e|e.to_string())?;Ok(Some(output.to_string_lossy().into()))
}
pub async fn clear_recordings(db:&Database)->Result<usize,String>{use sqlx::Row;ensure_recordings_table(db).await?;let rows=sqlx::query("SELECT path FROM capture_recordings").fetch_all(&db.pool).await.map_err(|e|e.to_string())?;let root=std::fs::canonicalize(root()?).map_err(|e|e.to_string())?;for row in &rows{if let Ok(p)=std::fs::canonicalize(row.get::<String,_>("path")){if p.starts_with(&root){std::fs::remove_file(p).map_err(|e|e.to_string())?;}}}sqlx::query("DELETE FROM capture_recordings").execute(&db.pool).await.map_err(|e|e.to_string())?;Ok(rows.len())}

#[tauri::command]pub async fn start_workflow_capture(app:AppHandle,kind:String)->Result<(),String>{if !["scroll","record"].contains(&kind.as_str()){return Err("Unknown workflow".into());}if !available(){return Err("Finish the active capture first".into());}crate::zhenxia::start_screenshot_with_intent(app,kind).await}
#[tauri::command]pub async fn start_presentation(app:AppHandle)->Result<(),String>{
    if let Some(w)=app.get_webview_window("presentation"){w.set_ignore_cursor_events(false).map_err(|e|e.to_string())?;let _=w.emit("presentation-restored",());crate::window_presentation::refresh_shape_before_show(&w).await?;w.show().map_err(|e|e.to_string())?;w.set_focus().map_err(|e|e.to_string())?;return Ok(());}
    PRESENTATION_READY.store(false,Ordering::Release);
    let (x,y)=lscreen_capture::cursor_position().unwrap_or((0,0));let shot=lscreen_capture::capture_at(x,y).map_err(|e|e.to_string())?;
    let w=tauri::WebviewWindowBuilder::new(&app,"presentation",tauri::WebviewUrl::App("index.html?window=presentation".into())).title("帧匣 · 演示画布").visible(false).transparent(true).decorations(false).minimizable(false).maximizable(false).shadow(false).always_on_top(true).skip_taskbar(true).resizable(false).disable_drag_drop_handler().build().map_err(|e|e.to_string())?;
    w.set_position(tauri::PhysicalPosition::new(shot.origin.0,shot.origin.1)).map_err(|e|e.to_string())?;w.set_size(tauri::PhysicalSize::new(shot.width,shot.height)).map_err(|e|e.to_string())?;PRESENTATION_READY.store(true,Ordering::Release);Ok(())
}
#[tauri::command]pub fn presentation_passthrough(app:AppHandle,enabled:bool)->Result<(),String>{let w=app.get_webview_window("presentation").ok_or("Presentation is closed")?;w.set_ignore_cursor_events(enabled).map_err(|e|e.to_string())?;crate::window_presentation::refresh_shape(&w);Ok(())}

async fn wait_layout(flag:&AtomicBool)->Result<(),String>{for _ in 0..200{if flag.load(Ordering::Acquire){return Ok(());}tokio::time::sleep(Duration::from_millis(10)).await;}Err("Window layout is not ready".into())}
#[tauri::command]pub async fn presentation_ready(app:AppHandle)->Result<(),String>{wait_layout(&PRESENTATION_READY).await?;let w=app.get_webview_window("presentation").ok_or("Presentation closed")?;crate::window_presentation::refresh_shape_before_show(&w).await?;crate::window_presentation::prepare(&w);w.show().map_err(|e|e.to_string())?;w.set_focus().map_err(|e|e.to_string())}
#[tauri::command]pub async fn workflow_ready(app:AppHandle)->Result<(),String>{wait_layout(&CONTROL_READY).await?;let w=app.get_webview_window("workflow").ok_or("Controls closed")?;crate::window_presentation::refresh_shape_before_show(&w).await?;crate::window_presentation::prepare(&w);#[cfg(windows)]if let Ok(h)=w.hwnd(){unsafe{let _=windows::Win32::UI::WindowsAndMessaging::ShowWindow(windows::Win32::Foundation::HWND(h.0 as _),windows::Win32::UI::WindowsAndMessaging::SW_SHOWNOACTIVATE);}return Ok(());}w.show().map_err(|e|e.to_string())}
