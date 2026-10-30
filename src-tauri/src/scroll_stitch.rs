//! Vertical, overlap-checked scrolling capture. No input is sent to other apps.
use image::RgbaImage;

pub struct ScrollStitch {
    pub width: u32,
    pub height: u32,
    pub frames: u32,
    pixels: Vec<u8>,
    last: RgbaImage,
    margins: Option<(u32,u32)>,
    checkpoint:Option<Checkpoint>,
}
struct Checkpoint{height:u32,frames:u32,last:RgbaImage,footer:Vec<u8>,bottom:u32,margins:Option<(u32,u32)>}
impl ScrollStitch {
    pub fn new(frame:RgbaImage)->Result<Self,String>{
        if frame.width()<32 || frame.height()<96 {return Err("请选择至少32×96像素的滚动区域 / Select a larger scrolling region".into());}
        Ok(Self{width:frame.width(),height:frame.height(),frames:1,pixels:frame.as_raw().clone(),last:frame,margins:None,checkpoint:None})
    }
    fn score(a:&RgbaImage,b:&RgbaImage,delta:u32,top:u32,bottom:u32)->f64{
        let end=a.height()-bottom-delta;
        if end<=top+32{return f64::INFINITY;}
        let mut sum=0u64;let mut count=0u64;
        for y in top..end{for x in (3..a.width().saturating_sub(3)).step_by((a.width()/28).max(1) as usize){
            let p=a.get_pixel(x,y+delta);let q=b.get_pixel(x,y);
            for k in 0..3 {sum+=p[k].abs_diff(q[k]) as u64;count+=1;}
        }}
        sum as f64/count.max(1) as f64
    }
    fn stable_edge(a:&RgbaImage,b:&RgbaImage,reverse:bool)->u32{
        let mut count=0;
        for row in 0..a.height()/5{
            let y=if reverse{a.height()-1-row}else{row};let mut error=0u32;let mut n=0;
            for x in (0..a.width()).step_by((a.width()/32).max(1) as usize){let p=a.get_pixel(x,y);let q=b.get_pixel(x,y);for k in 0..3{error+=p[k].abs_diff(q[k]) as u32;n+=1;}}
            if error>n*2{break;}count+=1;
        }
        if count>=8{count}else{0}
    }
    pub fn append(&mut self,frame:RgbaImage)->Result<bool,String>{
        if frame.dimensions()!=self.last.dimensions(){return Err("选区尺寸发生变化，请重新开始 / Region size changed".into());}
        let (top,bottom)=self.margins.unwrap_or_else(||(Self::stable_edge(&self.last,&frame,false),Self::stable_edge(&self.last,&frame,true)));
        if Self::score(&self.last,&frame,0,top,bottom)<0.25{return Ok(false);}
        let max=self.last.height().saturating_sub(top+bottom+48).min((self.last.height()-top-bottom)/2);
        let mut best=(0,f64::INFINITY);
        for delta in 1..=max{let score=Self::score(&self.last,&frame,delta,top,bottom);if score<best.1{best=(delta,score);}if score==0.0{break;}}
        if best.1>5.0{return Err("未找到可靠重叠，请向下少滚一些后重试；已有内容已保留 / No reliable overlap; scroll down less and retry".into());}
        let delta=best.0;
        let height=self.height.checked_add(delta).ok_or("Image is too tall")?;
        if height>30000 || self.width as u64*height as u64>48_000_000{return Err("长截图已达到大小上限，请完成保存 / Capture limit reached; finish and save".into());}
        let footer=self.pixels[((self.height-bottom)*self.width*4) as usize..].to_vec();
        let old_height=self.height;let old_frames=self.frames;let old_margins=self.margins;
        self.pixels.truncate(((self.height-bottom)*self.width*4) as usize);
        let start=((frame.height()-bottom-delta)*self.width*4) as usize;
        self.pixels.extend_from_slice(&frame.as_raw()[start..]);
        self.height=height;self.frames+=1;let last=std::mem::replace(&mut self.last,frame);self.checkpoint=Some(Checkpoint{height:old_height,frames:old_frames,last,footer,bottom,margins:old_margins});self.margins=Some((top,bottom));Ok(true)
    }
    pub fn image(&self)->RgbaImage{RgbaImage::from_raw(self.width,self.height,self.pixels.clone()).expect("validated dimensions")}
    pub fn can_undo(&self)->bool{self.checkpoint.is_some()}
    pub fn undo(&mut self)->bool{let Some(c)=self.checkpoint.take()else{return false};self.pixels.truncate(((c.height-c.bottom)*self.width*4) as usize);self.pixels.extend_from_slice(&c.footer);self.height=c.height;self.frames=c.frames;self.last=c.last;self.margins=c.margins;true}
    pub fn preview(&self)->RgbaImage{let ratio=(160.0/self.width as f64).min(250.0/self.height as f64);let w=(self.width as f64*ratio).max(1.) as u32;let h=(self.height as f64*ratio).max(1.) as u32;RgbaImage::from_fn(w,h,|x,y|{let offset=(((y*self.height/h)*self.width+x*self.width/w)*4) as usize;image::Rgba(self.pixels[offset..offset+4].try_into().unwrap())})}
}

#[cfg(test)]mod tests{
    use super::*;
    fn page(offset:u32)->RgbaImage{RgbaImage::from_fn(120,240,|x,y|{let v=x.wrapping_mul(1237)^(y+offset).wrapping_mul(7411);image::Rgba([(v>>8) as u8,v as u8,(v>>16) as u8,255])})}
    #[test]fn joins_exact_overlap_and_ignores_duplicates(){let mut s=ScrollStitch::new(page(0)).unwrap();assert!(!s.append(page(0)).unwrap());assert!(s.append(page(63)).unwrap());assert_eq!(s.height,303);assert_eq!(s.image(),RgbaImage::from_fn(120,303,|x,y|{let v=x.wrapping_mul(1237)^y.wrapping_mul(7411);image::Rgba([(v>>8) as u8,v as u8,(v>>16) as u8,255])}));}
    #[test]fn refuses_upward_motion_without_losing_content(){let mut s=ScrollStitch::new(page(100)).unwrap();assert!(s.append(page(0)).is_err());assert_eq!(s.height,240);assert_eq!(s.frames,1);}
    #[test]fn undo_restores_the_exact_previous_image(){let mut s=ScrollStitch::new(page(0)).unwrap();s.append(page(63)).unwrap();assert!(s.undo());assert_eq!(s.image(),page(0));assert!(!s.undo());assert!(s.append(page(40)).unwrap());assert_eq!(s.height,280);}
    #[test]fn repeated_flat_rows_do_not_hide_two_pixel_seams(){let page=|offset|RgbaImage::from_fn(120,480,|x,y|{let row=(y+offset)/24;let n=row*71+x*19;image::Rgba([(40+n%180) as u8,(40+(n/3)%180) as u8,(40+(n/7)%180) as u8,255])});let mut s=ScrollStitch::new(page(0)).unwrap();s.append(page(60)).unwrap();s.append(page(90)).unwrap();assert_eq!(s.height,570);}
    #[test]fn retains_only_one_fixed_header_and_footer(){let f=|offset|{let mut p=page(offset);for y in 0..20{for x in 0..120{p.put_pixel(x,y,image::Rgba([20,40,60,255]));p.put_pixel(x,239-y,image::Rgba([70,80,90,255]));}}p};let mut s=ScrollStitch::new(f(0)).unwrap();assert!(s.append(f(55)).unwrap());assert_eq!(s.height,295);assert_eq!(s.image().get_pixel(2,294).0,[70,80,90,255]);}
}
