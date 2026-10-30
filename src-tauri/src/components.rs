//! Optional, on-demand native components. No model or component process is resident.
use std::{fs, io::{Read, Write}, path::{Path,PathBuf}, sync::{Arc,OnceLock,atomic::{AtomicBool,Ordering}}};
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use tauri::{AppHandle,Emitter,Manager};
use crate::{capture_preferences::CapturePreferences,database::Database,settings_manager::SettingsManager};

static ROOT:OnceLock<PathBuf>=OnceLock::new();
static PREFERENCES:parking_lot::RwLock<Option<CapturePreferences>>=parking_lot::RwLock::new(None);
pub(crate) static INFERENCE:parking_lot::Mutex<()>=parking_lot::Mutex::new(());
static INSTALLING:AtomicBool=AtomicBool::new(false);
static CANCEL:AtomicBool=AtomicBool::new(false);

#[derive(Clone,Deserialize,Serialize)]
pub struct Resource { pub url:String,pub sha256:Option<String>,pub format:String,pub destination:String }
#[derive(Clone,Deserialize,Serialize)]
pub struct LanguagePair { pub id:String,pub model:String,pub lexicon:String,pub vocab:Vec<String> }
#[derive(Clone,Deserialize,Serialize)]
pub struct Definition { pub id:String,pub name:String,pub description:String,pub version:String,pub kind:String,pub resources:Vec<Resource>,pub pairs:Vec<LanguagePair> }
#[derive(Serialize)]
pub struct Status { pub id:String,pub name:String,pub description:String,pub version:String,pub kind:String,pub installed:bool,pub bytes:u64,pub busy:bool }
#[derive(Clone,Serialize)]
struct Progress { id:String,stage:String,received:u64,total:u64,step:usize,steps:usize }

pub fn initialize(db:&Database,p:&CapturePreferences) {
    let _=ROOT.set(db.image_dir.parent().unwrap_or(&db.image_dir).join("components"));
    configure(p);
}
pub fn configure(p:&CapturePreferences) { *PREFERENCES.write()=Some(p.clone()); }
pub fn preferences()->CapturePreferences { PREFERENCES.read().clone().unwrap_or_default() }
pub fn root()->Result<&'static PathBuf,String> { ROOT.get().ok_or_else(||"Component storage is not ready".into()) }
pub fn definitions()->Vec<Definition> { serde_json::from_str(include_str!("../component-catalog.json")).expect("built-in component catalog") }
fn definition(id:&str)->Result<Definition,String> { definitions().into_iter().find(|d|d.id==id).ok_or_else(||"Unknown component".into()) }
pub fn installed_dir(id:&str)->Result<PathBuf,String> { definition(id)?;Ok(root()?.join(id)) }
fn ready(d:&Definition,folder:&Path)->bool {
    if !folder.join("installed.json").is_file(){return false;}
    if d.kind=="ocr" { return ["lw_ppocr_c.dll","det.lwm","cls.lwm","rec.lwm","ppocr_keys.txt"].iter().all(|p|folder.join(p).is_file()); }
    folder.join("runtime/bergamot.dll").is_file()&&d.pairs.iter().all(|p|folder.join("models").join(&p.id).join("config.intgemm8bitalpha.yml").is_file())
}
fn folder_size(folder:&Path)->u64 { fs::read_dir(folder).map(|entries|entries.flatten().map(|e|{let p=e.path();if p.is_dir(){folder_size(&p)}else{e.metadata().map(|m|m.len()).unwrap_or(0)}}).sum()).unwrap_or(0) }
#[tauri::command]
pub async fn component_status()->Result<Vec<Status>,String> {
    let root=root()?;
    Ok(definitions().into_iter().map(|d|{let folder=root.join(&d.id);Status{id:d.id.clone(),name:d.name.clone(),description:d.description.clone(),version:d.version.clone(),kind:d.kind.clone(),installed:ready(&d,&folder),bytes:folder_size(&folder),busy:INSTALLING.load(Ordering::Acquire)}}).collect())
}

// All destinations come from the compiled catalog, never from an IPC path.
fn remove_owned(path:&Path)->Result<(),String> {
    if !path.exists(){return Ok(());}
    let base=fs::canonicalize(root()?).map_err(|e|e.to_string())?;
    let resolved=fs::canonicalize(path).map_err(|e|e.to_string())?;
    if resolved==base||!resolved.starts_with(&base){return Err("Component path is outside its storage directory".into());}
    fs::remove_dir_all(path).map_err(|e|e.to_string())
}
fn download_client()->Result<reqwest::blocking::Client,String> {
    // reqwest's rustls-no-provider feature deliberately does not select a provider.
    // Ring is already used by the application's existing TLS dependencies.
    let _=rustls::crypto::ring::default_provider().install_default();
    reqwest::blocking::Client::builder().user_agent("Zhenxia-components/1").connect_timeout(std::time::Duration::from_secs(15)).timeout(std::time::Duration::from_secs(600)).build().map_err(|e|e.to_string())
}
fn download(app:&AppHandle,d:&Definition,r:&Resource,path:&Path,step:usize)->Result<(),String> {
    let _=app.emit("component-progress",Progress{id:d.id.clone(),stage:"download".into(),received:0,total:0,step,steps:d.resources.len()});
    if CANCEL.load(Ordering::Acquire){return Err("Installation cancelled".into());}
    let client=download_client()?;
    let mut response=client.get(&r.url).send().and_then(|r|r.error_for_status()).map_err(|e|e.to_string())?;
    let total=response.content_length().unwrap_or(0);
    if total>512*1024*1024{return Err("Component download exceeds the size limit".into());}
    let mut file=fs::File::create(path).map_err(|e|e.to_string())?;
    let mut hash=Sha256::new();let mut received=0;let mut buffer=[0u8;65536];let mut last=std::time::Instant::now();
    loop {
        if CANCEL.load(Ordering::Acquire){return Err("Installation cancelled".into());}
        let n=response.read(&mut buffer).map_err(|e|e.to_string())?;if n==0{break;}
        received+=n as u64;if received>512*1024*1024{return Err("Component download exceeds the size limit".into());}
        hash.update(&buffer[..n]);file.write_all(&buffer[..n]).map_err(|e|e.to_string())?;
        if last.elapsed().as_millis()>120 {let _=app.emit("component-progress",Progress{id:d.id.clone(),stage:"download".into(),received,total,step,steps:d.resources.len()});last=std::time::Instant::now();}
    }
    if let Some(expected)=&r.sha256 {if format!("{:x}",hash.finalize())!=*expected{return Err("Component checksum does not match the published release".into());}}
    Ok(())
}

fn extract_zip(input:&Path,output:&Path,kind:&str)->Result<(),String> {
    // Filename-only allowlist extraction prevents archive paths escaping the stage.
    const SCRIPT:&str=r#"$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem
$z=[IO.Compression.ZipFile]::OpenRead($env:ZX_ARCHIVE)
try {$seen=@{};$total=0L; foreach($e in $z.Entries){
 $name=$e.Name; if(!$name){continue}; $isLicense=($name -match '^(LICENSE|COPYING|NOTICE|copyright|THIRD.PARTY.NOTICES)' -or $e.FullName -match '(^|/)licenses/'); $take=$false
 if($env:ZX_KIND -eq 'ocr-models'){$take=$name -in @('det.lwm','cls.lwm','rec.lwm','ppocr_keys.txt')}
 if($env:ZX_KIND -eq 'ocr-runtime'){$take=($name -eq 'lw_ppocr_c.dll' -or $name -match '^(msvcp140|vcruntime140).*\.dll$')}
 if($env:ZX_KIND -eq 'translation-runtime'){$take=$e.FullName -like 'runtimes/win-x64/native/*.dll'}
 if($isLicense){$take=$true;$name=($e.FullName -replace '[^A-Za-z0-9._-]','_')}
 if(!$take){continue}; if($seen.ContainsKey($name)){continue};$seen[$name]=$true
 $total+=$e.Length;if($e.Length -gt 536870912 -or $total -gt 805306368){throw 'Archive expansion limit exceeded'}
 [IO.Compression.ZipFileExtensions]::ExtractToFile($e,(Join-Path $env:ZX_DEST $name),$false)
 }}finally{$z.Dispose()}"#;
    fs::create_dir_all(output).map_err(|e|e.to_string())?;
    let mut command=std::process::Command::new("powershell.exe");
    command.args(["-NoProfile","-NonInteractive","-Command",SCRIPT]).env("ZX_ARCHIVE",input).env("ZX_DEST",output).env("ZX_KIND",kind);
    #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
    let result=command.output().map_err(|e|e.to_string())?;
    if !result.status.success(){return Err(format!("Could not extract component: {}",String::from_utf8_lossy(&result.stderr)));}Ok(())
}

fn install(app:&AppHandle,id:&str)->Result<(),String> {
    let d=definition(id)?;fs::create_dir_all(root()?).map_err(|e|e.to_string())?;
    let stage=root()?.join(format!(".install-{}",uuid::Uuid::new_v4()));fs::create_dir(&stage).map_err(|e|e.to_string())?;
    let result=(||{
        for (step,r) in d.resources.iter().enumerate(){
            let temporary=stage.join(format!("download-{step}.zip"));download(app,&d,r,&temporary,step)?;
            let _=app.emit("component-progress",Progress{id:d.id.clone(),stage:"extract".into(),received:0,total:0,step,steps:d.resources.len()});
            if r.format=="gzip" {
                let output=stage.join(&r.destination);fs::create_dir_all(output.parent().unwrap()).map_err(|e|e.to_string())?;
                let mut decoder=flate2::read::GzDecoder::new(fs::File::open(&temporary).map_err(|e|e.to_string())?);
                let mut file=fs::File::create(output).map_err(|e|e.to_string())?;
                let bytes=std::io::copy(&mut std::io::Read::by_ref(&mut decoder).take(512*1024*1024+1),&mut file).map_err(|e|e.to_string())?;
                if bytes>512*1024*1024{return Err("Expanded model exceeds the size limit".into());}
            }else{extract_zip(&temporary,&stage.join(&r.destination),&r.format)?;}
            fs::remove_file(temporary).map_err(|e|e.to_string())?;
        }
        for pair in &d.pairs {
            let yaml=format!("relative-paths: true\nmodels:\n- {}\nvocabs:\n- {}\n- {}\nshortlist:\n- {}\n- false\nbeam-size: 1\nnormalize: 1.0\nword-penalty: 0\nmax-length-break: 128\nmini-batch-words: 1024\nworkspace: 128\nmax-length-factor: 2.0\nskip-cost: true\ncpu-threads: 2\nquiet: true\nquiet-translation: true\ngemm-precision: int8shiftAlphaAll\nalignment: soft\n",pair.model,pair.vocab[0],pair.vocab[1],pair.lexicon);
            fs::write(stage.join("models").join(&pair.id).join("config.intgemm8bitalpha.yml"),yaml).map_err(|e|e.to_string())?;
        }
        fs::write(stage.join("installed.json"),serde_json::to_vec(&d).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        if !ready(&d,&stage){return Err("Component archive is incomplete".into());}
        if CANCEL.load(Ordering::Acquire){return Err("Installation cancelled".into());}
        let _guard=INFERENCE.lock();let target=root()?.join(id);let previous=root()?.join(format!(".previous-{}",uuid::Uuid::new_v4()));
        if target.exists(){fs::rename(&target,&previous).map_err(|e|e.to_string())?;}
        if let Err(e)=fs::rename(&stage,&target){if previous.exists(){let _=fs::rename(&previous,&target);}return Err(e.to_string());}
        remove_owned(&previous)?;Ok(())
    })();
    if stage.exists(){let _=remove_owned(&stage);}result
}

#[tauri::command]
pub async fn install_component(app:AppHandle,id:String)->Result<(),String>{
    definition(&id)?;
    if INSTALLING.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err(){return Err("Another component is being installed".into());}
    CANCEL.store(false,Ordering::Release);
    let notify=app.clone();
    let result=tauri::async_runtime::spawn_blocking(move||{struct Reset;impl Drop for Reset{fn drop(&mut self){INSTALLING.store(false,Ordering::Release);}}let _reset=Reset;install(&app,&id)}).await.map_err(|e|e.to_string())?;
    let _=notify.emit("component-changed",());
    result
}
#[tauri::command]pub fn cancel_component_install(){CANCEL.store(true,Ordering::Release);}
#[tauri::command]
pub async fn uninstall_component(app:AppHandle,id:String)->Result<(),String>{
    definition(&id)?;if INSTALLING.load(Ordering::Acquire){return Err("Wait for the installation to finish".into());}
    let folder=installed_dir(&id)?;
    tauri::async_runtime::spawn_blocking(move||{let _guard=INFERENCE.lock();remove_owned(&folder)}).await.map_err(|e|e.to_string())??;
    if id.starts_with("ocr-") {
        let manager=app.state::<Arc<SettingsManager>>();let mut p=manager.get();if p.capture.ocr_variant==id.trim_start_matches("ocr-"){p.capture.ocr_engine="windows".into();manager.save(p.clone())?;configure(&p.capture);let _=app.emit("settings-changed",p);}
    }let _=app.emit("component-changed",());Ok(())
}
#[tauri::command]
pub fn open_component_directory()->Result<(),String>{let root=root()?;fs::create_dir_all(root).map_err(|e|e.to_string())?;std::process::Command::new("explorer.exe").arg(root).spawn().map_err(|e|e.to_string())?;Ok(())}

pub fn recognize(png:&[u8])->Result<crate::ocr::OcrRecognition,String>{let p=preferences();if p.ocr_engine=="ppocr"{crate::local_ocr::recognize(png,&installed_dir(&format!("ocr-{}",p.ocr_variant))?)}else{crate::ocr::recognize_png(png)}}

#[tauri::command]
pub async fn translate_text(text:String,source:String,target:String)->Result<String,String>{
    if text.trim().is_empty(){return Ok(String::new());}if text.len()>200_000{return Err("Text is too long for one translation".into());}
    tauri::async_runtime::spawn_blocking(move||crate::offline_translate::translate(&text,&source,&target)).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub async fn process_image_text(image_base64:String,translate:bool)->Result<serde_json::Value,String>{
    if image_base64.len()>90_000_000{return Err("Image is too large".into());}
    tauri::async_runtime::spawn_blocking(move||{
        use base64::Engine;
        let png=base64::engine::general_purpose::STANDARD.decode(image_base64).map_err(|e|e.to_string())?;
        let recognition=recognize(&png)?;
        if !translate{return Ok(serde_json::json!({"text":recognition.text,"translated":null}));}
        let p=preferences();let mut target=p.translate_target;
        if p.translate_source=="auto"&&crate::offline_translate::detect_language(&recognition.text)==target{target=if target=="en"{"zh".into()}else{"en".into()};}
        let result=crate::offline_translate::translate(&recognition.text,&p.translate_source,&target)?;
        Ok(serde_json::json!({"text":recognition.text,"translated":result}))
    }).await.map_err(|e|e.to_string())?
}

#[cfg(test)]mod tests{use super::*;#[test]fn catalog_is_fixed_and_paths_are_relative(){let defs=definitions();assert_eq!(defs.len(),10);for d in defs{assert!(!d.id.contains(['/', '\\']));for r in d.resources{assert!(r.url.starts_with("https://"));assert!(!Path::new(&r.destination).is_absolute());assert!(!r.destination.split('/').any(|p|p==".."));}}}#[test]fn component_https_client_has_a_crypto_provider(){assert!(download_client().is_ok());} }
