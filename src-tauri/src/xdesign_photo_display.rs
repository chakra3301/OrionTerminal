//! WebView presentation is sRGB; macOS applies the display profile. Converting
//! image ICC values to monitor codes here would apply that conversion twice.
use photocraft_engine::{color_cmds::ColorState, doc::Document};
use photocraft_compose::Buffer;
use photocraft_raster::Rgba8Image;
use std::sync::OnceLock;

pub(super) fn rgba(doc:&Document, buffer:&Buffer)->Result<Rgba8Image,String> {
    static COLOR:OnceLock<ColorState>=OnceLock::new();
    let color=COLOR.get_or_init(||{let mut color=ColorState::default();color.settings.monitor_profile="srgb".into();color});
    color.canvas_display_for(doc,None).map(|display|display.to_rgba8(buffer)).map_err(|error|error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;use photocraft_engine::Session;use serde_json::json;
    #[test]
    fn tagged_wide_gamut_display_uses_native_icc_conversion_and_preserves_alpha_and_pixels() {
        let mut s=Session::new();s.execute("file.new",json!({"width":8,"height":8,"background":"#4080b0"})).unwrap();
        s.execute("edit.assignProfile",json!({"profile":"display-p3"})).unwrap();
        let source=s.active().unwrap().doc.clone();let buffer=photocraft_compose::render(&source,source.bounds());
        let mut color=ColorState::default();color.settings.monitor_profile="srgb".into();
        let expected=color.canvas_display_for(&source,None).unwrap().to_rgba8(&buffer);
        let presented=rgba(&source,&buffer).unwrap();assert_eq!(presented.pixels,expected.pixels);assert_eq!(presented.pixels[3],buffer.to_rgba8().pixels[3]);
        assert!(std::sync::Arc::ptr_eq(&source,&s.active().unwrap().doc));
    }
}

const LUT_SIDE: usize = 33;
pub(super) struct View {
    display: std::sync::Arc<photocraft_engine::display_color::CanvasDisplay>,
    lut: Option<Vec<u8>>,
    hdr: Option<photocraft_engine::proof_sim::HdrPreview>,
    gamut: bool,
}
impl View {
    pub(super) fn new(color:&ColorState,doc:&Document)->Result<std::sync::Arc<Self>,String>{
        use std::{collections::VecDeque,sync::{Arc,Mutex}};
        static CACHE:OnceLock<Mutex<VecDeque<(u64,Arc<View>)>>>=OnceLock::new();
        let signature=color.display_signature_for(doc,None);
        let cache=CACHE.get_or_init(||Mutex::new(VecDeque::new()));
        if let Some((_,view))=cache.lock().map_err(|_|"Color view cache needs to be restarted")?.iter().find(|(key,_)|*key==signature){return Ok(view.clone());}
        let view=Arc::new(Self{display:color.canvas_display_for(doc,None).map_err(|e|e.to_string())?,lut:if color.proof(doc.id).enabled||color.proof(doc.id).gamut_warning||color.hdr_preview(doc).is_some(){color.gpu_canvas_lut_for(doc,LUT_SIDE,None).map_err(|e|e.to_string())?}else{None},hdr:color.hdr_preview(doc),gamut:color.proof(doc.id).gamut_warning});
        let mut cache=cache.lock().map_err(|_|"Color view cache needs to be restarted")?;
        cache.push_back((signature,view.clone()));while cache.len()>16{cache.pop_front();}Ok(view)
    }
    pub(super) fn rgba(&self,buffer:&Buffer)->Rgba8Image {
        if self.hdr.is_none() && self.lut.is_none(){return self.display.to_rgba8(buffer);}
        let mut image=Rgba8Image::new(buffer.rect.width(),buffer.rect.height());
        for (out,pixel) in image.pixels.chunks_exact_mut(4).zip(&buffer.px) {
            let mut rgb=[pixel[0],pixel[1],pixel[2]];
            if self.display.encode_srgb {rgb=rgb.map(encode);}
            if let Some(hdr)=self.hdr {rgb=rgb.map(|value|encode((decode(value.max(0.0))*2f32.powf(hdr.exposure)).max(1e-12).powf(1.0/hdr.gamma).min(1.0)));}
            if let Some(lut)=&self.lut {let shown=sample(lut,rgb);rgb=if self.gamut&&shown[3]>0.5 {[128.0/255.0;3]}else{[shown[0],shown[1],shown[2]]};}
            for c in 0..3{out[c]=(rgb[c].clamp(0.0,1.0)*255.0+0.5) as u8;}
            out[3]=(pixel[3].clamp(0.0,1.0)*255.0+0.5) as u8;
        }
        image
    }
}
fn decode(v:f32)->f32{if v<=0.04045{v/12.92}else{((v+0.055)/1.055).powf(2.4)}}
fn encode(v:f32)->f32{if v<=0.0031308{v*12.92}else{1.055*v.powf(1.0/2.4)-0.055}}
fn sample(lut:&[u8],rgb:[f32;3])->[f32;4]{
    let position=rgb.map(|v|v.clamp(0.0,1.0)*(LUT_SIDE-1) as f32);
    let lower=position.map(|v|v.floor() as usize);let upper=lower.map(|v|(v+1).min(LUT_SIDE-1));let fraction=std::array::from_fn::<_,3,_>(|c|position[c]-lower[c] as f32);
    let mut output=[0.0;4];
    for z in 0..2{for y in 0..2{for x in 0..2{
        let indices=[x,y,z];let coordinates=std::array::from_fn::<_,3,_>(|c|if indices[c]==0{lower[c]}else{upper[c]});
        let weight=(0..3).map(|c|if indices[c]==0{1.0-fraction[c]}else{fraction[c]}).product::<f32>();
        let index=(coordinates[0]+LUT_SIDE*(coordinates[1]+LUT_SIDE*coordinates[2]))*4;
        for c in 0..4{output[c]+=f32::from(lut[index+c])/255.0*weight;}
    }}}output
}
