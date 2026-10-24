//! Small editable descriptions of live gradients and the selected text layer.
use photocraft_engine::doc::{
    text::{Caps, CharStyle, Kerning},
    Document, Fill, Layer, LayerContent,
};
use serde_json::{json, Value};

fn character(style: &CharStyle) -> Value {
    let rgb = style.color.to_rgb();
    let byte = |value: f32| (value.clamp(0.0, 1.0) * 255.0).round() as u8;
    let color = format!(
        "#{:02x}{:02x}{:02x}{:02x}",
        byte(rgb[0]),
        byte(rgb[1]),
        byte(rgb[2]),
        byte(style.color.alpha)
    );
    json!({
        "font":style.font_family,"fontStyle":style.font_style,"weight":style.weight,"italic":style.italic,
        "size":style.size_pt,"color":color,"tracking":style.tracking,"leading":style.leading_pt.map_or(json!("auto"),|v|json!(v)),
        "baselineShift":style.baseline_shift_pt,"horizontalScale":style.horizontal_scale*100.0,"verticalScale":style.vertical_scale*100.0,
        "underline":style.underline,"strikethrough":style.strikethrough,"fauxBold":style.faux_bold,"fauxItalic":style.faux_italic,
        "ligatures":style.ligatures,"discretionaryLigatures":style.discretionary_ligatures,
        "kerning":if style.kern!=0.0 {json!(style.kern)} else {json!(match style.kerning {Kerning::Metrics=>"metrics",Kerning::Optical=>"optical",Kerning::Off=>"off"})},
        "caps":match style.caps {Caps::Normal=>"normal",Caps::SmallCaps=>"small",Caps::AllCaps=>"all"},
        "language":style.language,
        "features":style.features.iter().map(|v|(v.tag.clone(),json!(v.value))).collect::<serde_json::Map<_,_>>(),
        "variations":style.variations.iter().map(|v|(v.axis.clone(),json!(v.value))).collect::<serde_json::Map<_,_>>()
    })
}

pub(super) fn describe(native: &Layer, doc: &Document, layer: &mut Value, detailed: bool) {
    layer["hasVectorMask"] = json!(native.vector_mask.is_some());
    layer["hasPixels"] = json!(native.surface().is_some());
    if detailed {
        let bounds = photocraft_engine::transform_cmds::transform_bounds(doc, native);
        layer["transformBounds"] = json!([bounds.x0, bounds.y0, bounds.width(), bounds.height()]);
    }
    match &native.content {
        LayerContent::Fill(fill @ Fill::Gradient { .. }) => {
            layer["gradientFill"] = photocraft_engine::gradient_fill_cmds::describe_fill(
                fill,
                photocraft_compose::fill_frame(native, doc.bounds()),
            );
        }
        LayerContent::Text(text) if detailed => {
            let mut offset = 0;
            let mut characters = 0;
            let runs: Vec<_> = text
                .char_runs()
                .into_iter()
                .take(4096)
                .map(|run| {
                    let start = offset;
                    offset += run.len;
                    let first = characters;
                    characters += text
                        .text
                        .get(start..offset)
                        .map_or(0, |s| s.chars().count());
                    json!({"start":first,"end":characters,"style":character(&run.style)})
                })
                .collect();
            let truncated = offset < text.text.len();
            offset = 0;
            characters = 0;
            let paragraphs:Vec<_>=text.paragraph_runs().into_iter().take(4096).map(|run|{
                let start=offset;offset+=run.len;let style=run.style;let first=characters;characters+=text.text.get(start..offset).map_or(0,|s|s.chars().count());
                json!({"start":first,"end":characters,"style":{
                    "align":match style.align {photocraft_engine::doc::text::TextAlign::Left=>"left",photocraft_engine::doc::text::TextAlign::Center=>"center",photocraft_engine::doc::text::TextAlign::Right=>"right",photocraft_engine::doc::text::TextAlign::JustifyLeft=>"justify",photocraft_engine::doc::text::TextAlign::JustifyCenter=>"justifyCenter",photocraft_engine::doc::text::TextAlign::JustifyRight=>"justifyRight",photocraft_engine::doc::text::TextAlign::JustifyAll=>"justifyAll"},
                    "direction":match style.direction {photocraft_engine::doc::text::TextDirection::Auto=>"auto",photocraft_engine::doc::text::TextDirection::Ltr=>"ltr",photocraft_engine::doc::text::TextDirection::Rtl=>"rtl"},
                    "firstLineIndent":style.first_line_indent_pt,"startIndent":style.start_indent_pt,"endIndent":style.end_indent_pt,
                    "spaceBefore":style.space_before_pt,"spaceAfter":style.space_after_pt,"autoLeading":style.auto_leading*100.0,"hyphenate":style.hyphenate
                }})
            }).collect();
            layer["text"]["runs"] = json!(runs);
            layer["text"]["paragraphs"] = json!(paragraphs);
            layer["text"]["truncated"] = json!(truncated || offset < text.text.len());
            layer["text"]["antialias"] =
                json!(format!("{:?}", text.antialias).to_ascii_lowercase());
            layer["text"]["orientation"] =
                json!(format!("{:?}", text.orientation).to_ascii_lowercase());
            layer["text"]["transform"] = json!(text.transform.m);
            layer["text"]["shape"] = match text.shape {
                photocraft_engine::doc::text::TextShape::Point => json!({"kind":"point"}),
                photocraft_engine::doc::text::TextShape::Box {
                    x,
                    y,
                    width,
                    height,
                } => json!({"kind":"box","x":x,"y":y,"width":width,"height":height}),
            };
            layer["text"]["warp"] = text.warp.as_ref().map(|warp| json!({"style":warp.style,"bend":warp.value,"horizontalDistortion":warp.horizontal_distortion,"verticalDistortion":warp.vertical_distortion,"orientation":if warp.horizontal {"horizontal"} else {"vertical"}})).unwrap_or(Value::Null);
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn text_geometry_warp_and_run_styles_survive_native_save_and_undo() {
        let mut engine = photocraft_engine::Session::new();
        engine
            .execute("file.new", json!({"width":240,"height":180}))
            .unwrap();
        let id = engine
            .execute(
                "type.create",
                json!({"text":"A🖌é editable text","box":[10,15,170,100],"size":20}),
            )
            .unwrap()["layer"]
            .as_u64()
            .unwrap();
        engine
            .execute(
                "type.setStyle",
                json!({"layer":id,"range":[1,3],"weight":700,"color":"#123456"}),
            )
            .unwrap();
        engine
            .execute(
                "type.edit",
                json!({"layer":id,"transform":[0.8,0.4,-0.2,1,30,35]}),
            )
            .unwrap();
        let source = engine.active().unwrap().doc.clone();
        engine
            .execute("type.edit", json!({"layer":id,"box":[50,60,140,110]}))
            .unwrap();
        let layer_id = photocraft_engine::doc::LayerId(id);
        let as_text = |doc: &Document| {
            let LayerContent::Text(text) = &doc.layer(layer_id).unwrap().content else {
                panic!("text")
            };
            text.clone()
        };
        let before = as_text(&source);
        let after = as_text(&engine.active().unwrap().doc);
        assert_eq!(&before.transform.m[..4], &after.transform.m[..4]);
        assert_eq!(before.char_runs(), after.char_runs());
        engine.execute("edit.undo", json!({})).unwrap();
        assert_eq!(as_text(&engine.active().unwrap().doc).shape, before.shape);
        engine.execute("edit.redo", json!({})).unwrap();
        engine.execute("type.warpText",json!({"layer":id,"style":"arcLower","bend":-40,"horizontalDistortion":20,"verticalDistortion":-15,"orientation":"vertical"})).unwrap();
        let bytes =
            photocraft_format::save_to_bytes(&engine.active().unwrap().doc, &Default::default())
                .unwrap();
        let restored = photocraft_format::load_from_bytes(&bytes).unwrap();
        let native = restored.layer(layer_id).unwrap();
        let mut value = photocraft_engine::inspect::layer(native);
        describe(native, &restored, &mut value, true);
        assert_eq!(
            value["text"]["shape"],
            json!({"kind":"box","x":0.0,"y":0.0,"width":140.0,"height":110.0})
        );
        assert_eq!(
            value["text"]["transform"],
            json!([0.8, 0.4, -0.2, 1.0, 50.0, 60.0])
        );
        assert_eq!(value["text"]["warp"]["style"], "warpArcLower");
        assert_eq!(value["text"]["warp"]["orientation"], "vertical");
        assert_eq!(value["text"]["warp"]["bend"].as_f64(), Some(-40.0));
        assert_eq!(value["text"]["runs"][1]["style"]["color"], "#123456ff");
    }
    #[test]
    fn descriptions_preserve_unicode_ranges_paragraphs_and_gradient_units() {
        let mut engine = photocraft_engine::Session::new();
        engine
            .execute("file.new", json!({"width":128,"height":128}))
            .unwrap();
        let id = engine
            .execute(
                "type.create",
                json!({"text":"A🖌é\nمرحبا","size":12,"direction":"rtl"}),
            )
            .unwrap()["layer"]
            .as_u64()
            .unwrap();
        engine
            .execute(
                "type.setStyle",
                json!({"layer":id,"range":[1,3],"weight":700,"color":"#123456","tracking":50}),
            )
            .unwrap();
        let doc = &engine.active().unwrap().doc;
        let native = doc.layer(photocraft_engine::doc::LayerId(id)).unwrap();
        let mut value = photocraft_engine::inspect::layer(native);
        describe(native, doc, &mut value, true);
        assert_eq!(value["text"]["runs"][1]["start"], 1);
        assert_eq!(value["text"]["runs"][1]["end"], 3);
        assert_eq!(value["text"]["runs"][1]["style"]["weight"], 700);
        assert_eq!(value["text"]["runs"][1]["style"]["color"], "#123456ff");
        assert_eq!(value["text"]["paragraphs"][0]["style"]["direction"], "rtl");
        let id = engine
            .execute(
                "gradient.fill.create",
                json!({"from":[10,20],"to":[100,20],"stops":[[0,"#000000"],[1,"#ffffff"]]}),
            )
            .unwrap()["layer"]
            .as_u64()
            .unwrap();
        engine
            .execute(
                "gradient.fill.set",
                json!({"layer":id,"scale":50,"transparency":[[0,20],[1,100]]}),
            )
            .unwrap();
        let doc = &engine.active().unwrap().doc;
        let native = doc.layer(photocraft_engine::doc::LayerId(id)).unwrap();
        let mut value = photocraft_engine::inspect::layer(native);
        describe(native, doc, &mut value, true);
        assert_eq!(value["gradientFill"]["scale"].as_f64(), Some(50.0));
        assert_eq!(
            value["gradientFill"]["transparency"][0][1].as_f64(),
            Some(20.0)
        );
    }
}
