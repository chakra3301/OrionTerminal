//! Small native samples of real preset content, isolated from image/tool history.
use super::{render_view_preview, PhotoViewPreview};
use photocraft_engine::Session;
use serde_json::json;

pub(super) fn render(source: &Session, kind: &str, preset: &str, group: Option<&str>) -> Result<PhotoViewPreview, String> {
    if !["brush", "style", "pattern", "shape"].contains(&kind)
        || preset.is_empty() || preset.len() > 1024
        || group.is_some_and(|value| value.len() > 1024)
    { return Err("Invalid preset preview request".into()); }
    let mut sample = Session::new();
    sample.tools = source.tools.clone(); sample.presets = source.presets.clone();
    sample.patterns = source.patterns.clone();
    sample.edit_state.custom_shapes = source.edit_state.custom_shapes.clone();
    let run = |sample: &mut Session, command, params| sample.execute(command, params).map_err(|error| error.to_string());
    run(&mut sample, "file.new", json!({"width":96,"height":64,"background":"transparent"}))?;
    match kind {
        "brush" => {
            run(&mut sample, "tools.setBrush", json!({"preset":preset,"size":24,"color":[0.8157,0.8471,0.9098,1],"opacity":1,"erase":false}))?;
            let points: Vec<_> = (0..=12).map(|index| json!([12+index*6,32.0+(index as f64/12.0*std::f64::consts::TAU).sin()*8.0,1])).collect();
            run(&mut sample, "paint.stroke", json!({"points":points,"seed":17}))?;
        }
        "style" => {
            run(&mut sample, "select.rect", json!({"x":18,"y":12,"width":60,"height":40}))?;
            run(&mut sample, "edit.fill", json!({"color":"#8396b7"}))?;
            run(&mut sample, "select.deselect", json!({}))?;
            run(&mut sample, "style.presets.apply", json!({"preset":preset,"group":group}))?;
        }
        "pattern" => { run(&mut sample, "pattern.presets.apply", json!({"pattern":preset,"scale":100,"angle":0}))?; }
        "shape" => { run(&mut sample, "shape.presets.place", json!({"preset":preset,"group":group,"rect":[12,8,72,48],"keepAspect":true,"fill":"#d0d8e8"}))?; }
        _ => unreachable!(),
    }
    let state=sample.active().ok_or("No preset sample")?;
    render_view_preview(&state.doc, &state.channel_view)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    #[test]
    fn real_preset_samples_have_visible_pixels_and_preserve_source_state() {
        let mut source=Session::new();source.execute("file.new",json!({"width":24,"height":24})).unwrap();
        source.execute("tools.setBrush",json!({"size":77,"opacity":0.4})).unwrap();
        let before=source.active().unwrap().doc.clone();let brush=serde_json::to_value(&source.tools.brush).unwrap();
        let history=source.active().unwrap().history.entries().len();let presets=source.presets.rev;
        let brush_name=source.tools.presets[0].name.clone();
        let shapes=photocraft_engine::presets::shapes::all_groups(&source);
        let shape=&shapes[0].items[0];
        let style=&source.presets.styles[0].items[0];
        for (kind,name,group) in [("brush",brush_name.as_str(),None),("shape",shape.name.as_str(),Some(shapes[0].name.as_str())),("style",style.name.as_str(),Some(source.presets.styles[0].name.as_str()))] {
            let preview=render(&source,kind,name,group).unwrap();assert_eq!((preview.width,preview.height),(96,64));
            let bytes=base64::engine::general_purpose::STANDARD.decode(preview.png).unwrap();
            let image=photocraft_codecs::decode(&bytes).unwrap();assert!(image.as_u8().unwrap().chunks_exact(4).any(|pixel|pixel[3]>0),"{kind}");
        }
        assert!(std::sync::Arc::ptr_eq(&before,&source.active().unwrap().doc));assert_eq!(source.active().unwrap().history.entries().len(),history);
        assert_eq!(serde_json::to_value(&source.tools.brush).unwrap(),brush);assert_eq!(source.presets.rev,presets);
        assert!(render(&source,"script","x",None).is_err());assert!(render(&source,"brush","missing",None).is_err());
        let pattern=source.execute("pattern.presets.new",json!({"name":"Sample pixels"})).unwrap();
        let id=pattern["pattern"].as_str().unwrap();let preview=render(&source,"pattern",id,None).unwrap();
        let image=photocraft_codecs::decode(&base64::engine::general_purpose::STANDARD.decode(preview.png).unwrap()).unwrap();
        assert!(image.as_u8().unwrap().chunks_exact(4).any(|pixel|pixel[3]>0));
    }
}
