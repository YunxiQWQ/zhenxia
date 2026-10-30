//! On-demand encoders. MP4 uses Windows Media Foundation; GIF uses image/gif.
use std::{fs::File,io::BufWriter,path::Path};
use image::RgbaImage;

pub enum Encoder{Gif(image::codecs::gif::GifEncoder<BufWriter<File>>),#[cfg(windows)]Mp4(Mp4)}
impl Encoder{
    pub fn new(path:&Path,format:&str,width:u32,height:u32,fps:u32)->Result<Self,String>{
        if format=="gif"{let mut encoder=image::codecs::gif::GifEncoder::new_with_speed(BufWriter::new(File::create(path).map_err(|e|e.to_string())?),15);encoder.set_repeat(image::codecs::gif::Repeat::Infinite).map_err(|e|e.to_string())?;return Ok(Self::Gif(encoder));}
        #[cfg(windows)]{return Mp4::new(path,width,height,fps).map(Self::Mp4);}
        #[cfg(not(windows))]{let _=(path,width,height,fps);Err("MP4 requires Windows".into())}
    }
    pub fn frame(&mut self,image:RgbaImage,time:u64,duration:u64)->Result<(),String>{match self{
        Self::Gif(writer)=>writer.encode_frame(image::Frame::from_parts(image,0,0,image::Delay::from_numer_denom_ms((duration/10000).max(10) as u32,1))).map_err(|e|e.to_string()),
        #[cfg(windows)]Self::Mp4(writer)=>writer.frame(&image,time,duration),
    }}
    pub fn finish(self)->Result<(),String>{match self{Self::Gif(_)=>Ok(()),#[cfg(windows)]Self::Mp4(writer)=>writer.finish()}}
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn encodes_real_mp4_and_gif_from_generated_frames(){
  let keep=std::env::var_os("ZHENXIA_ENCODER_TEST_OUTPUT");let dir=keep.as_ref().map(std::path::PathBuf::from).unwrap_or_else(||std::env::temp_dir().join(format!("zhenxia-encoder-{}",uuid::Uuid::new_v4())));std::fs::create_dir_all(&dir).unwrap();
  for format in ["mp4","gif"]{let path=dir.join(format!("generated.{format}"));let mut encoder=Encoder::new(&path,format,96,64,12).unwrap();for n in 0..12{let image=RgbaImage::from_fn(96,64,|x,y|image::Rgba([if y<32{240}else{0},if y>=32{240}else{0},(x+n*3) as u8,255]));encoder.frame(image,n as u64*833333,833333).unwrap();}encoder.finish().unwrap();let bytes=std::fs::read(&path).unwrap();assert!(bytes.len()>100);if format=="mp4"{assert!(bytes.windows(4).any(|x|x==b"ftyp"));assert!(bytes.windows(4).any(|x|x==b"moov"));}else{assert_eq!(image::load_from_memory(&bytes).unwrap().width(),96);}}
  if keep.is_none(){for format in ["mp4","gif"]{std::fs::remove_file(dir.join(format!("generated.{format}"))).unwrap();}std::fs::remove_dir(dir).unwrap();}
 }
}

#[cfg(windows)]pub struct Mp4{writer:windows::Win32::Media::MediaFoundation::IMFSinkWriter,index:u32,_runtime:MediaRuntime}
#[cfg(windows)]struct MediaRuntime;
#[cfg(windows)]impl MediaRuntime{unsafe fn new()->windows::core::Result<Self>{use windows::Win32::{Media::MediaFoundation::*,System::Com::*};CoInitializeEx(None,COINIT_MULTITHREADED).ok()?;if let Err(error)=MFStartup(MF_VERSION,MFSTARTUP_FULL){CoUninitialize();return Err(error);}Ok(Self)}}
#[cfg(windows)]impl Drop for MediaRuntime{fn drop(&mut self){unsafe{let _=windows::Win32::Media::MediaFoundation::MFShutdown();windows::Win32::System::Com::CoUninitialize();}}}
#[cfg(windows)]impl Mp4{
    fn new(path:&Path,width:u32,height:u32,fps:u32)->Result<Self,String>{
        use windows::{core::PCWSTR,Win32::{Media::MediaFoundation::*,System::Com::*}};
        unsafe{(move||->windows::core::Result<Self>{
            let runtime=MediaRuntime::new()?;
            let path:Vec<u16>=path.as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
            let mut attributes=None;MFCreateAttributes(&mut attributes,2)?;let attributes=attributes.unwrap();attributes.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS,1)?;
            let writer=MFCreateSinkWriterFromURL(PCWSTR(path.as_ptr()),None,&attributes)?;
            let geometry=|media:&IMFMediaType|->windows::core::Result<()>{media.SetGUID(&MF_MT_MAJOR_TYPE,&MFMediaType_Video)?;media.SetUINT32(&MF_MT_INTERLACE_MODE,MFVideoInterlace_Progressive.0 as u32)?;media.SetUINT64(&MF_MT_FRAME_SIZE,((width as u64)<<32)|height as u64)?;media.SetUINT64(&MF_MT_FRAME_RATE,((fps as u64)<<32)|1)?;media.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO,(1u64<<32)|1)};
            let output=MFCreateMediaType()?;geometry(&output)?;output.SetGUID(&MF_MT_SUBTYPE,&MFVideoFormat_H264)?;output.SetUINT32(&MF_MT_AVG_BITRATE,6_000_000)?;
            let index=writer.AddStream(&output)?;
            let input=MFCreateMediaType()?;geometry(&input)?;input.SetGUID(&MF_MT_SUBTYPE,&MFVideoFormat_RGB32)?;
            writer.SetInputMediaType(index,&input,None)?;writer.BeginWriting()?;Ok(Self{writer,index,_runtime:runtime})
        })().map_err(|e|format!("MP4 编码不可用，可选择 GIF / MP4 encoder unavailable: {e}"))}
    }
    fn frame(&mut self,image:&RgbaImage,time:u64,duration:u64)->Result<(),String>{
        use windows::Win32::Media::MediaFoundation::*;
        unsafe{(move||->windows::core::Result<()>{
            let size=image.as_raw().len();let buffer=MFCreateMemoryBuffer(size as u32)?;let mut p=std::ptr::null_mut();buffer.Lock(&mut p,None,None)?;
            let out=std::slice::from_raw_parts_mut(p,size);let row=image.width() as usize*4;
            for y in 0..image.height() as usize{for x in 0..image.width() as usize{let from=y*row+x*4;let to=(image.height() as usize-1-y)*row+x*4;out[to..to+4].copy_from_slice(&[image.as_raw()[from+2],image.as_raw()[from+1],image.as_raw()[from],255]);}}
            buffer.Unlock()?;buffer.SetCurrentLength(size as u32)?;let sample=MFCreateSample()?;sample.AddBuffer(&buffer)?;sample.SetSampleTime(time as i64)?;sample.SetSampleDuration(duration as i64)?;self.writer.WriteSample(self.index,&sample)
        })().map_err(|e|e.to_string())}
    }
    fn finish(self)->Result<(),String>{unsafe{self.writer.Finalize().map_err(|e|e.to_string())}}
}
