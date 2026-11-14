//! On-demand Windows Graphics Capture via the MIT windows-capture library.
//! One latest region frame is retained; no queue grows behind a slow encoder.
use image::RgbaImage;
use crate::workflows::Region;

pub struct Frames {
    region: Region,
    #[cfg(windows)]
    graphics: Option<graphics::Stream>,
}

impl Frames {
    pub fn new(region: Region, fps: u32) -> (Self, &'static str) {
        #[cfg(windows)]
        match graphics::Stream::new(region, fps) {
            Ok(stream) => return (Self { region, graphics: Some(stream) }, "Windows Graphics Capture"),
            Err(error) => log::warn!("Recording uses compatibility capture: {error}"),
        }
        let _ = fps;
        (Self { region, #[cfg(windows)] graphics: None }, "Compatibility capture")
    }
    pub fn frame(&mut self) -> Result<RgbaImage, String> {
        #[cfg(windows)]
        if let Some(stream) = &self.graphics { return stream.frame(); }
        let r = self.region;
        let shot = lscreen_capture::capture_region(r.x, r.y, r.width, r.height).map_err(|e|e.to_string())?;
        RgbaImage::from_raw(shot.width, shot.height, shot.rgba).ok_or("Invalid capture buffer".into())
    }
    pub fn pause(&self, paused: bool) {
        #[cfg(windows)]
        if let Some(stream) = &self.graphics { stream.pause(paused); }
        let _ = paused;
    }
}

#[cfg(windows)]
mod graphics {
    use super::*;
    use std::{sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};
    use windows_capture::{capture::{Context, GraphicsCaptureApiHandler, CaptureControl}, frame::Frame,
        graphics_capture_api::InternalCaptureControl, monitor::Monitor, settings::*};
    use windows::Win32::{Foundation::RECT, Graphics::Gdi::{MonitorFromRect, MONITOR_DEFAULTTONULL, GetMonitorInfoW, MONITORINFO}};

    struct State {
        crop: (u32, u32, u32, u32),
        latest: Mutex<Option<RgbaImage>>,
        error: Mutex<Option<String>>,
        paused: AtomicBool,
        closed: AtomicBool,
    }
    struct Handler { state: Arc<State> }
    impl GraphicsCaptureApiHandler for Handler {
        type Flags = Arc<State>;
        type Error = String;
        fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> { Ok(Self { state: ctx.flags }) }
        fn on_frame_arrived(&mut self, frame: &mut Frame, control: InternalCaptureControl) -> Result<(), String> {
            if self.state.paused.load(Ordering::Acquire) { return Ok(()); }
            let result = (|| {
                let (x, y, width, height) = self.state.crop;
                if x + width > frame.width() || y + height > frame.height() {
                    return Err("屏幕尺寸已改变，请重新选择录屏区域 / Display size changed".into());
                }
                let mut buffer = frame.buffer_crop(x, y, x + width, y + height).map_err(|e| e.to_string())?;
                let stride = buffer.row_pitch() as usize;
                let source = buffer.as_raw_buffer();
                let row = width as usize * 4;
                let mut pixels = vec![0; row * height as usize];
                for y in 0..height as usize { pixels[y*row..(y+1)*row].copy_from_slice(&source[y*stride..y*stride+row]); }
                let image = RgbaImage::from_raw(width, height, pixels).ok_or("Invalid graphics frame")?;
                *self.state.latest.lock().unwrap() = Some(image);
                Ok::<(), String>(())
            })();
            if let Err(error) = result { *self.state.error.lock().unwrap() = Some(error); control.stop(); }
            Ok(())
        }
        fn on_closed(&mut self) -> Result<(), String> { self.state.closed.store(true, Ordering::Release); Ok(()) }
    }
    pub(super) struct Stream { control: Option<CaptureControl<Handler, String>>, state: Arc<State> }
    impl Stream {
        pub fn new(r: Region, fps: u32) -> Result<Self, String> {
            let rect = RECT { left: r.x, top: r.y, right: r.x+r.width as i32, bottom: r.y+r.height as i32 };
            let monitor = unsafe { MonitorFromRect(&rect, MONITOR_DEFAULTTONULL) };
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            if monitor.is_invalid() || !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
                return Err("Recording monitor is not available".into());
            }
            let bounds = info.rcMonitor;
            if rect.left<bounds.left || rect.top<bounds.top || rect.right>bounds.right || rect.bottom>bounds.bottom {
                return Err("Region crosses monitor boundaries".into());
            }
            let state = Arc::new(State { crop: ((r.x-bounds.left) as u32, (r.y-bounds.top) as u32, r.width, r.height),
                latest: Mutex::new(None), error: Mutex::new(None), paused: AtomicBool::new(false), closed: AtomicBool::new(false) });
            let item = Monitor::from_raw_hmonitor(monitor.0);
            let settings = Settings::new(item, CursorCaptureSettings::WithCursor, DrawBorderSettings::WithoutBorder,
                SecondaryWindowSettings::Default, MinimumUpdateIntervalSettings::Custom(Duration::from_micros(1_000_000/fps as u64)),
                DirtyRegionSettings::Default, ColorFormat::Rgba8, state.clone());
            let control = Handler::start_free_threaded(settings).map_err(|e| e.to_string())?;
            let stream = Self { control: Some(control), state };
            let start = Instant::now();
            loop {
                if stream.state.latest.lock().unwrap().is_some() { return Ok(stream); }
                if let Some(error) = stream.state.error.lock().unwrap().clone() { return Err(error); }
                if stream.control.as_ref().is_some_and(|c| c.is_finished()) || start.elapsed()>Duration::from_secs(2) {
                    return Err("Graphics capture did not produce a frame".into());
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        pub fn frame(&self) -> Result<RgbaImage, String> {
            if let Some(error) = self.state.error.lock().unwrap().clone() { return Err(error); }
            if self.state.closed.load(Ordering::Acquire) || self.control.as_ref().is_some_and(|c|c.is_finished()) {
                return Err("录屏屏幕已关闭 / Capture monitor closed".into());
            }
            self.state.latest.lock().unwrap().clone().ok_or("Capture frame is not ready".into())
        }
        pub fn pause(&self, value: bool) { self.state.paused.store(value, Ordering::Release); }
    }
    impl Drop for Stream { fn drop(&mut self) { if let Some(control)=self.control.take(){if let Err(error)=control.stop(){log::warn!("Capture shutdown: {error}");}} } }
}
