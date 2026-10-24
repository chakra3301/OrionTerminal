//! Channel math over bounded 512×256 regions. Source snapshots never change
//! while output is assembled, including self-sources and mixed document modes.
use photocraft_algo::selection::{combine, mask_from_surface, SelectionMode};
use photocraft_engine::{channel_cmds::{Blending, ChanRef, ChannelTarget}, doc::{AlphaChannel, ColorMode, Document, Layer, LayerId, PixelFormat, Rect, Surface}, DocState, Session};
use photocraft_raster::{from_rgba, to_rgba};
use serde_json::{json, Value};

fn regions(doc: &Document) -> impl Iterator<Item = Rect> + '_ {
    (0..doc.size.height).step_by(256).flat_map(move |y| {
        (0..doc.size.width).step_by(512).map(move |x| Rect::from_xywh(x as i32, y as i32, 512.min(doc.size.width-x), 256.min(doc.size.height-y)))
    })
}

fn plane(surface: &Surface, rect: Rect) -> Vec<f32> {
    surface.read_region(rect).chunks_exact(surface.channels()).map(|px| px[0]).collect()
}

fn native(state: &DocState, layer: Option<LayerId>, rect: Rect) -> Result<Vec<f32>, String> {
    let fmt = state.doc.pixel_format();
    match layer {
        Some(id) => {
            let surface = state.doc.layer(id).and_then(Layer::surface).ok_or("The source layer has no pixels")?;
            let raw = surface.read_region(rect);
            if surface.format() == fmt { Ok(raw) }
            else { Ok(raw.chunks_exact(surface.channels()).flat_map(|px| from_rgba(&fmt, to_rgba(&surface.format(), px))).collect()) }
        },
        None => Ok(photocraft_compose::render(&state.doc, rect).px.into_iter().flat_map(|px| from_rgba(&fmt, px)).collect()),
    }
}

fn source(engine: &Session, spec: &Value, rect: Rect, gray: bool) -> Result<Vec<Vec<f32>>, String> {
    let index = spec["document"].as_u64().map(|i| i as usize).or(engine.active_index()).ok_or("No source image")?;
    let state = engine.documents().get(index).ok_or("The source image is unavailable")?;
    let layer = spec["layer"].as_u64().map(LayerId);
    let channel = photocraft_engine::channel_cmds::parse_ref(spec.get("channel").unwrap_or(&json!("composite")), &state.doc).ok_or("Unknown source channel")?;
    let fmt = state.doc.pixel_format();
    let cc = fmt.mode.color_channels();
    let mut planes = match channel {
        ChanRef::Composite | ChanRef::Color(_) => {
            let px = native(state, layer, rect)?;
            match channel {
                ChanRef::Color(c) => vec![px.chunks_exact(fmt.channels()).map(|p| p[c]).collect()],
                _ if gray && cc == 1 => vec![px.chunks_exact(fmt.channels()).map(|p|p[0]).collect()],
                _ if gray => vec![px.chunks_exact(fmt.channels()).map(|p| {
                    let mut opaque = p.to_vec(); if fmt.alpha { opaque[cc] = 1.0; }
                    let rgb = to_rgba(&fmt, &opaque); 0.299*rgb[0]+0.587*rgb[1]+0.114*rgb[2]
                }).collect()],
                _ => (0..cc).map(|c| px.chunks_exact(fmt.channels()).map(|p| p[c]).collect()).collect(),
            }
        },
        ChanRef::Alpha(i) => vec![plane(&state.doc.channels.get(i).ok_or("Missing alpha channel")?.surface, rect)],
        ChanRef::QuickMask => vec![plane(&state.doc.quick_mask.as_ref().ok_or("Not in Quick Mask mode")?.surface, rect)],
        ChanRef::Selection => vec![mask_from_surface(state.doc.selection.as_ref(), rect)],
        other => {
            let layer = layer.or(state.active_layer).and_then(|id| state.doc.layer(id)).ok_or("Choose a source layer")?;
            vec![match other {
                ChanRef::Transparency => match layer.surface() {
                    Some(s) => s.read_region(rect).chunks_exact(s.channels()).map(|p| to_rgba(&s.format(), p)[3]).collect(),
                    None => vec![1.0; rect.width() as usize*rect.height() as usize],
                },
                ChanRef::LayerMask => plane(&layer.mask.as_ref().ok_or("Missing layer mask")?.surface, rect),
                ChanRef::VectorMask => {
                    let mask = layer.vector_mask.as_ref().ok_or("Missing vector mask")?;
                    let shape = photocraft_engine::doc::VectorMask { enabled: true, density: 1.0, feather: 0.0, ..mask.clone() };
                    photocraft_vector::vector_mask_values(&shape, rect)
                },
                _ => return Err("Unsupported channel source".into()),
            }]
        },
    };
    if spec["invert"].as_bool() == Some(true) { for pl in &mut planes { for v in pl { *v = 1.0-*v; } } }
    Ok(planes)
}

fn mask(engine: &Session, params: &Value, rect: Rect) -> Result<Option<Vec<f32>>, String> {
    if params["mask"].is_object() { Ok(Some(source(engine, &params["mask"], rect, true)?.remove(0))) } else { Ok(None) }
}

pub(super) fn execute(engine: &mut Session, command: &str, params: &Value, recorded: &Value) -> Result<Value, String> {
    let recorded = super::mask_filters::clean_parameters(recorded)?;
    let state = engine.active().cloned().ok_or("No image document")?;
    let mut out = (*state.doc).clone();
    let blending = Blending::parse(params)?;
    let opacity = params["opacity"].as_f64().unwrap_or(100.0) as f32 / 100.0;
    if command == "image.applyImage" {
        let target = super::channels::target(&state, params)?;
        let original = match target {
            super::channels::Target::Pixels(id) => {
                let layer = state.doc.layer(id).ok_or("Missing target layer")?;
                if layer.locks.all || layer.locks.pixels { return Err("The target layer is locked".into()); }
                let s = layer.surface().ok_or("The target layer has no pixels")?;
                if s.format() != state.doc.pixel_format() { return Err("The target layer's format does not match the document".into()); }
                s
            },
            super::channels::Target::Mask(id) => {
                let layer = state.doc.layer(id).ok_or("Missing target layer")?;
                if layer.locks.all { return Err("The target layer is locked".into()); }
                &layer.mask.as_ref().ok_or("The target layer has no mask")?.surface
            },
            super::channels::Target::Alpha(i) => &state.doc.channels.get(i).ok_or("Missing target channel")?.surface,
            super::channels::Target::QuickMask => &state.doc.quick_mask.as_ref().ok_or("Not in Quick Mask mode")?.surface,
        };
        let mut surface = original.clone();
        for rect in regions(&state.doc) {
            let src = source(engine, &params["source"], rect, false)?;
            let weights = mask(engine, params, rect)?;
            let selection = state.doc.selection.as_ref().map(|s| mask_from_surface(Some(s), rect));
            let weight = |i: usize| opacity * weights.as_ref().map_or(1.0, |v| v[i]) * selection.as_ref().map_or(1.0, |v| v[i]);
            let mut data = original.read_region(rect);
            if let super::channels::Target::Pixels(id) = target {
                let fmt = original.format(); let colors = fmt.mode.color_channels();
                let preserve = params["preserveTransparency"].as_bool().unwrap_or(false) || state.doc.layer(id).is_some_and(|l| l.locks.transparency);
                for (i, px) in data.chunks_exact_mut(fmt.channels()).enumerate() {
                    let old = px.to_vec(); let base_a = if fmt.alpha { px[colors].clamp(0.0,1.0) } else { 1.0 };
                    let w = weight(i) * if preserve { base_a } else { 1.0 }; if w <= 0.0 { continue; }
                    let out_a = if preserve { base_a } else { w+base_a*(1.0-w) };
                    for (c,b) in px[..colors].iter_mut().enumerate() {
                        let top = src.get(c).unwrap_or(&src[0])[i];
                        let blended = top+(blending.apply(*b,top)-top)*base_a;
                        *b = if preserve { *b+(blended-*b)*w } else { (w*blended+base_a*(1.0-w)* *b)/out_a };
                    }
                    if fmt.alpha { px[colors]=out_a; }
                    if let ChannelTarget::Color(k) = state.channel_view.target {
                        for c in 0..px.len() { if c != k { px[c]=old[c]; } }
                    }
                }
            } else {
                for (i,px) in data.chunks_exact_mut(original.channels()).enumerate() {
                    let top = src.iter().map(|pl| pl[i]).sum::<f32>()/src.len() as f32;
                    px[0] += (blending.apply(px[0],top)-px[0])*weight(i);
                }
            }
            surface.write_region(rect, &data);
        }
        surface.prune();
        match target {
            super::channels::Target::Pixels(id) => *out.layer_mut(id).and_then(Layer::surface_mut).ok_or("Missing target layer")?=surface,
            super::channels::Target::Mask(id) => out.layer_mut(id).and_then(|l|l.mask.as_mut()).ok_or("Missing target mask")?.surface=surface,
            super::channels::Target::Alpha(i) => out.channels[i].surface=surface,
            super::channels::Target::QuickMask => out.quick_mask.as_mut().ok_or("Missing Quick Mask")?.surface=surface,
        }
        let fade = match target {
            super::channels::Target::Pixels(id) => super::mask_filters::FadeTarget::Pixels(id),
            super::channels::Target::Mask(id) => super::mask_filters::FadeTarget::Coverage(super::mask_filters::Target::Mask(id)),
            super::channels::Target::Alpha(index) => super::mask_filters::FadeTarget::Coverage(super::mask_filters::Target::Alpha(index)),
            super::channels::Target::QuickMask => super::mask_filters::FadeTarget::Coverage(super::mask_filters::Target::QuickMask),
        };
        super::mask_filters::commit_host_edit(engine, command, &recorded, "Apply Image", Some(fade), move |doc,_| { *doc=out; Ok(()) })?;
        return Ok(Value::Null);
    }
    let selection_output = command == "select.loadSelection" || params["result"] == "selection";
    let mut coverage = Surface::new(if selection_output { PixelFormat::GRAY8 } else { photocraft_engine::channel_cmds::channel_format(&state.doc) });
    let operation = params["operation"].as_str().unwrap_or("new");
    if command == "select.loadSelection" && !["new","replace","add","subtract","intersect"].contains(&operation) { return Err("Unknown selection operation".into()); }
    let mut selected=false;
    for rect in regions(&state.doc) {
        let vals = if command == "select.loadSelection" { source(engine, params, rect, true)?.remove(0) }
        else {
            let s1 = source(engine, &params["source1"], rect, true)?.remove(0);
            let s2 = source(engine, &params["source2"], rect, true)?.remove(0);
            let m = mask(engine, params, rect)?;
            s2.iter().zip(&s1).enumerate().map(|(i,(&b,&t))|b+(blending.apply(b,t)-b)*opacity*m.as_ref().map_or(1.0,|v|v[i])).collect()
        };
        if selection_output {
            let mode = if command == "select.loadSelection" { SelectionMode::parse(operation) } else { SelectionMode::Replace };
            if let Some(s) = combine(state.doc.selection.as_ref(), &vals, rect, mode) { coverage.write_region(rect,&s.read_region(rect)); selected=true; }
        } else { coverage.write_region(rect,&vals.iter().map(|v|v.clamp(0.0,1.0)).collect::<Vec<_>>()); }
    }
    coverage.prune();
    if selection_output {
        out.selection = selected.then_some(coverage);
        super::mask_filters::commit_host_edit(engine, command, &recorded, if command=="select.loadSelection" {"Load Selection"} else {"Calculations"}, None, move|doc,_|{*doc=out;Ok(())})?;
        return Ok(json!({"selected":selected}));
    }
    if params["result"] == "newDocument" {
        let document = gray_document(params["name"].as_str().unwrap_or("Calculation"), &state.doc, &coverage);
        let index=engine.add_document(document,None);
        engine.edit_state.fade=None;
        engine.journal.push((command.to_owned(),recorded));
        return Ok(json!({"document":index}));
    }
    let index=out.channels.len();
    let name = params["name"].as_str().map(str::to_owned).unwrap_or_else(||(1..=index+1).map(|i|format!("Alpha {i}")).find(|name|!out.channels.iter().any(|c|c.name==*name)).unwrap_or_else(||format!("Alpha {}",index+1)));
    out.channels.push(AlphaChannel::new(name,coverage));
    super::mask_filters::commit_host_edit(engine, command, &recorded, "Calculations", None, move|doc,_|{*doc=out;Ok(())})?;
    Ok(json!({"channel":index}))
}

fn gray_document(name: &str, like: &Document, coverage: &Surface) -> Document {
    let mut doc=Document::new(name,like.size,ColorMode::Grayscale,like.depth); doc.resolution_dpi=like.resolution_dpi;
    let mut bg=Layer::raster("Background",doc.pixel_format()); bg.locks.transparency=true; bg.locks.position=true;
    if let Some(surface)=bg.surface_mut() { for rect in regions(like) { let data:Vec<_>=plane(coverage,rect).into_iter().flat_map(|v|[v.clamp(0.0,1.0),1.0]).collect();surface.write_region(rect,&data); } surface.prune(); }
    doc.layers.push(bg); doc
}

pub(super) fn split(engine: &Session) -> Result<Vec<Document>, String> {
    let state=engine.active().ok_or("No source image")?;
    if state.doc.channels.len()>64 { return Err("Split Channels supports up to 64 saved channels at once".into()); }
    let colors=photocraft_engine::channel_cmds::color_count(&state.doc);
    (0..colors+state.doc.channels.len()).map(|i| {
        let spec=if i<colors {json!({"channel":{"color":i}})} else {json!({"channel":i-colors})};
        let mut coverage=Surface::new(photocraft_engine::channel_cmds::channel_format(&state.doc));
        for rect in regions(&state.doc) {coverage.write_region(rect,&source(engine,&spec,rect,true)?.remove(0));} coverage.prune();
        let name=if i<colors {photocraft_engine::channel_cmds::color_names(state.doc.pixel_format().mode)[i].to_owned()} else {state.doc.channels[i-colors].name.clone()};
        Ok(gray_document(&format!("{} · {name}",state.doc.name),&state.doc,&coverage))
    }).collect()
}

pub(super) fn merge(engine: &Session, params: &Value) -> Result<Document, String> {
    let mode=match params["mode"].as_str().unwrap_or("rgb") {"rgb"=>ColorMode::Rgb,"cmyk"=>ColorMode::Cmyk,"lab"=>ColorMode::Lab,_=>return Err("Choose RGB, CMYK or Lab".into())};
    let indices=params["documents"].as_array().ok_or("Choose grayscale source images")?;
    if indices.len()<mode.color_channels() || indices.len()>mode.color_channels()+64 {return Err("Choose one grayscale source per color channel, plus at most 64 alpha channels".into());}
    let states:Vec<_>=indices.iter().map(|index|index.as_u64().and_then(|i|engine.documents().get(i as usize)).ok_or("Invalid merge source")).collect::<Result<_,_>>()?;
    let first=states[0];
    if states.iter().any(|s|s.doc.mode!=ColorMode::Grayscale||s.doc.size!=first.doc.size||s.doc.depth!=first.doc.depth) {return Err("Merge sources must be grayscale images with matching dimensions and bit depth".into());}
    let mut out=Document::new(params["name"].as_str().unwrap_or("Merged channels"),first.doc.size,mode,first.doc.depth);out.resolution_dpi=first.doc.resolution_dpi;
    let fmt=out.pixel_format();let cc=mode.color_channels();let mut bg=Layer::raster("Background",fmt);bg.locks.transparency=true;bg.locks.position=true;
    for i in cc..states.len() {out.channels.push(AlphaChannel::new(format!("Alpha {}",i-cc+1),Surface::new(photocraft_engine::channel_cmds::channel_format(&out))));}
    for rect in regions(&first.doc) {
        let planes:Vec<_>=indices.iter().map(|index|source(engine,&json!({"document":index,"channel":"composite"}),rect,true).map(|mut v|v.remove(0))).collect::<Result<_,_>>()?;
        let data:Vec<_>=(0..planes[0].len()).flat_map(|i|planes[..cc].iter().map(move|pl|pl[i].clamp(0.0,1.0)).chain(std::iter::once(1.0))).collect();
        bg.surface_mut().ok_or("Missing merged pixels")?.write_region(rect,&data);
        for (alpha,values) in out.channels.iter_mut().zip(&planes[cc..]) {alpha.surface.write_region(rect,values);}
    }
    bg.surface_mut().ok_or("Missing merged pixels")?.prune();for alpha in &mut out.channels {alpha.surface.prune();}out.layers.push(bg);Ok(out)
}
