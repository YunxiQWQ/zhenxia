//! lw.PPOCR.C v1 C ABI; model handles and DLLs are released after each job.
use std::{ffi::{c_char,c_void,CString},path::Path};
use crate::ocr::{OcrRecognition,OcrLayout,OcrWordBox};

#[repr(C)]#[derive(Default)]struct DetectorOptions{size:u32,side:u32,candidates:u32,dilation:u32,bitmap:f32,score:f32,unclip:f32,reserved:u32,limits:[u64;4]}
#[repr(C)]#[derive(Default)]struct ClassifierOptions{size:u32,reserved:u32,limits:[u64;4]}
#[repr(C)]#[derive(Default)]struct RecognizerOptions{size:u32,width:u32,reserved:[u32;2],limits:[u64;4]}
#[repr(C)]#[derive(Default)]struct Options{size:u32,classify:u32,threshold:f32,workers:u32,crop_pixels:u64,detector:DetectorOptions,classifier:ClassifierOptions,recognizer:RecognizerOptions}
#[repr(C)]struct Error{size:u32,code:i32,message:[c_char;256]}
#[repr(C)]#[derive(Default,Clone)]struct Detection{points:[f32;8],score:f32,reserved:u32}
#[repr(C)]#[derive(Default,Clone)]struct Line{box_:Detection,recognition:f32,classification:f32,label:u32,rotation:u32,emitted:u32,reserved:u32,offset:u64,length:u64}
#[repr(C)]#[derive(Default)]struct ResultInfo{size:u32,count:u32,lines_required:u32,detected:u32,width:u32,height:u32,reserved:[u32;2],text_required:u64}

#[cfg(windows)]
pub fn recognize(png:&[u8],folder:&Path)->Result<OcrRecognition,String>{
    let _guard=crate::components::INFERENCE.lock();
    for file in ["lw_ppocr_c.dll","det.lwm","cls.lwm","rec.lwm","ppocr_keys.txt"]{if !folder.join(file).is_file(){return Err("请先在组件集成中安装所选 PP-OCRv6 组件".into());}}
    let rgb=image::load_from_memory(png).map_err(|e|e.to_string())?.into_rgb8();
    let (width,height)=rgb.dimensions();if u64::from(width)*u64::from(height)>40_000_000{return Err("Image is too large for offline OCR".into());}
    let mut bgr=rgb.into_raw();for pixel in bgr.chunks_exact_mut(3){pixel.swap(0,2);}
    unsafe {
        // Only this component folder and system directories participate in DLL resolution.
        let library=libloading::os::windows::Library::load_with_flags(folder.join("lw_ppocr_c.dll"),0x00000100|0x00001000).map_err(|e|format!("无法加载离线 OCR 组件：{e}"))?;
        let init_options=library.get::<unsafe extern "C" fn(*mut Options)>(b"lw_ocr_options_init\0").map_err(|e|e.to_string())?;
        let init_error=library.get::<unsafe extern "C" fn(*mut Error)>(b"lw_error_init\0").map_err(|e|e.to_string())?;
        let init_result=library.get::<unsafe extern "C" fn(*mut ResultInfo)>(b"lw_ocr_result_init\0").map_err(|e|e.to_string())?;
        let create=library.get::<unsafe extern "C" fn(*const c_char,*const c_char,*const c_char,*const c_char,*const Options,*mut *mut c_void,*mut Error)->i32>(b"lw_ocr_create\0").map_err(|e|e.to_string())?;
        let free=*library.get::<unsafe extern "C" fn(*mut c_void)>(b"lw_ocr_free\0").map_err(|e|e.to_string())?;
        let run=library.get::<unsafe extern "C" fn(*mut c_void,*const u8,u64,u32,u32,u32,*mut Line,u32,*mut c_char,u64,*mut ResultInfo,*mut Error)->i32>(b"lw_ocr_run_bgr_u8\0").map_err(|e|e.to_string())?;
        let paths=["det.lwm","cls.lwm","rec.lwm","ppocr_keys.txt"].map(|p|CString::new(folder.join(p).to_string_lossy().as_bytes()).map_err(|e|e.to_string()));
        let [det,cls,rec,dict]=paths;let (det,cls,rec,dict)=(det?,cls?,rec?,dict?);
        let mut options=Options::default();init_options(&mut options);
        if options.size as usize!=std::mem::size_of::<Options>(){return Err("OCR component ABI is incompatible".into());}
        options.workers=2;options.threshold=0.7;options.recognizer.width=3200;
        let mut error:Error=std::mem::zeroed();init_error(&mut error);
        let mut handle=std::ptr::null_mut();
        let status=create(det.as_ptr(),cls.as_ptr(),rec.as_ptr(),dict.as_ptr(),&options,&mut handle,&mut error);
        let error_text=|e:&Error|{let bytes=e.message.iter().take_while(|c|**c!=0).map(|c|*c as u8).collect::<Vec<_>>();String::from_utf8_lossy(&bytes).into_owned()};
        if status!=0||handle.is_null(){if !handle.is_null(){free(handle);}return Err(format!("离线 OCR 初始化失败：{}",error_text(&error)));}
        struct Engine{handle:*mut c_void,free:unsafe extern "C" fn(*mut c_void)}
        impl Drop for Engine{fn drop(&mut self){unsafe{(self.free)(self.handle)}}}
        let engine=Engine{handle,free};let mut info=ResultInfo::default();init_result(&mut info);
        init_error(&mut error);
        let status=run(engine.handle,bgr.as_ptr(),bgr.len() as u64,width,height,width*3,std::ptr::null_mut(),0,std::ptr::null_mut(),0,&mut info,&mut error);
        if status!=0{return Err(format!("离线 OCR 识别失败：{}",error_text(&error)));}
        if info.lines_required>100_000||info.text_required>16*1024*1024{return Err("OCR output exceeds its memory limit".into());}
        let mut lines=vec![Line::default();info.lines_required.max(1) as usize];let mut text=vec![0u8;info.text_required.max(1) as usize];
        init_result(&mut info);init_error(&mut error);
        let status=run(engine.handle,bgr.as_ptr(),bgr.len() as u64,width,height,width*3,lines.as_mut_ptr(),lines.len() as u32,text.as_mut_ptr().cast(),text.len() as u64,&mut info,&mut error);
        if status!=0{return Err(format!("离线 OCR 识别失败：{}",error_text(&error)));}
        if info.count as usize>lines.len()||info.text_required as usize>text.len(){return Err("OCR result exceeded the allocated capacity".into());}
        let mut words=Vec::new();let mut paragraphs=Vec::new();
        for (index,line) in lines[..info.count as usize].iter().enumerate(){
            let start=usize::try_from(line.offset).map_err(|e|e.to_string())?;let length=usize::try_from(line.length).map_err(|e|e.to_string())?;
            let bytes=text.get(start..start.checked_add(length).ok_or("Invalid OCR text length")?).ok_or("Invalid OCR text span")?;
            let value=String::from_utf8_lossy(bytes).trim().to_string();if value.is_empty(){continue;}
            let xs=[line.box_.points[0],line.box_.points[2],line.box_.points[4],line.box_.points[6]];let ys=[line.box_.points[1],line.box_.points[3],line.box_.points[5],line.box_.points[7]];
            let x=xs.iter().copied().fold(f32::INFINITY,f32::min).max(0.);let y=ys.iter().copied().fold(f32::INFINITY,f32::min).max(0.);
            let right=xs.iter().copied().fold(0.,f32::max).min(width as f32);let bottom=ys.iter().copied().fold(0.,f32::max).min(height as f32);
            paragraphs.push(value.clone());words.push(OcrWordBox{text:value,x,y,width:(right-x).max(0.),height:(bottom-y).max(0.),line:Some(index as u32)});
        }
        Ok(OcrRecognition{text:paragraphs.join("\n"),layout:OcrLayout{image_width:width,image_height:height,words}})
    }
}
#[cfg(not(windows))]pub fn recognize(_png:&[u8],_folder:&Path)->Result<OcrRecognition,String>{Err("Offline OCR requires Windows".into())}

#[cfg(test)]mod tests{use super::*;#[test]fn c_abi_struct_layout_matches_version_one_header(){assert_eq!(std::mem::size_of::<Options>(),176);assert_eq!(std::mem::size_of::<Line>(),80);assert_eq!(std::mem::size_of::<ResultInfo>(),40);assert_eq!(std::mem::size_of::<Error>(),264);}}
