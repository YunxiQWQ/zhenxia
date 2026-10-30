use std::{ffi::{c_char,c_void,CStr,CString},path::PathBuf};

pub fn detect_language(text:&str)->&'static str {
    if text.chars().any(|c|('\u{3040}'..='\u{30ff}').contains(&c)){"ja"}
    else if text.chars().any(|c|('\u{ac00}'..='\u{d7af}').contains(&c)){"ko"}
    else if text.chars().any(|c|('\u{4e00}'..='\u{9fff}').contains(&c)){"zh"}
    else if text.chars().any(|c|('\u{0400}'..='\u{04ff}').contains(&c)){"ru"}
    else{"en"}
}
fn normalize(language:&str)->&str{if language=="zh-Hant"{"zh_hant"}else{language}}
fn pair_config(pair:&str)->Result<(PathBuf,PathBuf),String>{
    for d in crate::components::definitions(){
        if d.pairs.iter().any(|p|p.id==pair){let folder=crate::components::installed_dir(&d.id)?;let config=folder.join("models").join(pair).join("config.intgemm8bitalpha.yml");let dll=folder.join("runtime/bergamot.dll");if config.is_file()&&dll.is_file(){return Ok((config,dll));}}
    }Err(format!("请先在组件集成中安装 {pair} 的离线翻译语言包"))
}

#[cfg(windows)]
pub fn translate(text:&str,source:&str,target:&str)->Result<String,String>{
    let _guard=crate::components::INFERENCE.lock();
    let source=if source=="auto"{detect_language(text)}else{normalize(source)};
    let target=normalize(target);
    if source==target{return Ok(text.to_string());}
    let ids=if source=="en"||target=="en"{vec![format!("{source}-{target}")]}else{vec![format!("{source}-en"),format!("en-{target}")]};
    let mut dll=None;let mut configs=Vec::new();
    for id in ids {let (config,path)=pair_config(&id)?;dll.get_or_insert(path);configs.push(CString::new(config.to_string_lossy().as_bytes()).map_err(|e|e.to_string())?);}
    unsafe {
        let library=libloading::os::windows::Library::load_with_flags(dll.ok_or("No translation model")?,0x00000100|0x00001000).map_err(|e|format!("无法加载离线翻译组件：{e}"))?;
        let initialize=library.get::<unsafe extern "C" fn(*const *const c_char,i32)->*mut c_void>(b"translator_initialize\0").map_err(|e|e.to_string())?;
        let run=library.get::<unsafe extern "C" fn(*mut c_void,*const c_char,bool)->*mut c_char>(b"translator_translate\0").map_err(|e|e.to_string())?;
        let free=*library.get::<unsafe extern "C" fn(*mut c_void)>(b"translator_free\0").map_err(|e|e.to_string())?;
        let pointers=configs.iter().map(|c|c.as_ptr()).collect::<Vec<_>>();let handle=initialize(pointers.as_ptr(),pointers.len() as i32);
        if handle.is_null(){return Err("离线翻译初始化失败，请重新安装语言包".into());}
        struct Engine{handle:*mut c_void,free:unsafe extern "C" fn(*mut c_void)}impl Drop for Engine{fn drop(&mut self){unsafe{(self.free)(self.handle)}}}
        let engine=Engine{handle,free};let mut output=Vec::new();
        for line in text.split('\n') {
            if line.trim().is_empty(){output.push(String::new());continue;}
            let input=CString::new(line).map_err(|_|"Text contains a null character".to_string())?;let translated=run(engine.handle,input.as_ptr(),false);
            if translated.is_null(){return Err("离线翻译失败".into());}
            let value=CStr::from_ptr(translated).to_string_lossy().into_owned();
            windows::Win32::System::Com::CoTaskMemFree(Some(translated.cast()));output.push(value);
        }
        Ok(output.join("\n"))
    }
}
#[cfg(not(windows))]pub fn translate(_text:&str,_source:&str,_target:&str)->Result<String,String>{Err("Offline translation requires Windows".into())}

#[cfg(test)]mod tests{use super::*;#[test]fn detects_screenshot_languages(){assert_eq!(detect_language("你好"),"zh");assert_eq!(detect_language("hello"),"en");assert_eq!(detect_language("こんにちは"),"ja");assert_eq!(detect_language("Привет"),"ru");}}
