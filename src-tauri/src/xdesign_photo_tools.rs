//! One brush library per Orion profile, shared by every image session. Native
//! preset storage retains sampled tips without sending their pixels to the UI.
use photocraft_engine::{
    paint::{Pattern, TipShape},
    Session,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
#[path = "xdesign_photo_colors.rs"]
mod colors;

struct Tools {
    engine: Session,
    warnings: Vec<String>,
    colors_writable: bool,
}
fn stores() -> &'static Mutex<HashMap<PathBuf, Tools>> {
    static STORES: OnceLock<Mutex<HashMap<PathBuf, Tools>>> = OnceLock::new();
    STORES.get_or_init(|| Mutex::new(HashMap::new()))
}
fn loaded(dir: &Path) -> Tools {
    load_profile(dir, true)
}
fn load_profile(dir: &Path, attached: bool) -> Tools {
    let mut engine = Session::new();
    let opened=photocraft_engine::preset_store::open_dir(dir.join("brushes"));
    let mut warnings=if attached {engine.attach_preset_store(opened)} else {
        let photocraft_engine::preset_store::Opened{presets,hidden_builtins,order,warnings,..}=opened;
        let library=&mut engine.tools.presets;
        library.retain(|preset|!(preset.builtin&&hidden_builtins.iter().any(|name|name.eq_ignore_ascii_case(&preset.name))));
        for preset in presets {match library.iter_mut().find(|existing|existing.name.eq_ignore_ascii_case(&preset.name)){Some(existing)if existing.builtin=>*existing=preset,Some(_)=>{},None=>library.push(preset)}}
        if !order.is_empty(){let positions:HashMap<_,_>=order.iter().enumerate().map(|(index,name)|(name.to_lowercase(),index)).collect();library.sort_by_key(|preset|positions.get(&preset.name.to_lowercase()).copied().unwrap_or(usize::MAX));}
        engine.brush_presets_changed();
        warnings
    };
    let pattern_path = dir.join("patterns.pat");
    if pattern_path.is_file() {
        let result = (|| {
            if std::fs::metadata(&pattern_path)
                .map_err(|e| e.to_string())?
                .len()
                > 128 * 1024 * 1024
            {
                return Err("saved pattern library exceeds 128MB".to_string());
            }
            photocraft_io::pattern_map::read_pat(
                &std::fs::read(&pattern_path).map_err(|e| e.to_string())?,
            )
        })();
        match result {
            Ok(patterns) => engine.patterns.items = patterns,
            Err(error) => warnings.push(format!("Pattern library could not be restored: {error}")),
        }
    }
    let presets_path = dir.join("presets.json");
    if presets_path.is_file() {
        let result = (|| {
            if std::fs::metadata(&presets_path)
                .map_err(|error| error.to_string())?
                .len()
                > 32 * 1024 * 1024
            {
                return Err("saved preset library exceeds 32MB".to_string());
            }
            serde_json::from_slice::<Value>(
                &std::fs::read(&presets_path).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())
        })();
        match result {
            Ok(value) => engine.load_presets_json(value),
            Err(error) => warnings.push(format!("Preset library could not be restored: {error}")),
        }
    }
    let path = dir.join("brush.json");
    if path.is_file() {
        let result = (|| {
            if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 64 * 1024 * 1024 {
                return Err("saved brush settings exceed 64MB".to_string());
            }
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            serde_json::from_slice(&bytes).map_err(|e| e.to_string())
        })();
        match result {
            Ok(brush) => engine.tools.brush = brush,
            Err(error) => warnings.push(format!("Brush settings could not be restored: {error}")),
        }
    }
    photocraft_engine::presets::patterns::sync(&mut engine);
    let (colors_writable, warning) = colors::load(dir, &mut engine);
    warnings.extend(warning);
    Tools { engine, warnings, colors_writable }
}
pub(super) fn activate(dir: &Path, engine: &mut Session) -> Result<Vec<String>, String> {
    let mut stores = stores()
        .lock()
        .map_err(|_| "Brush library needs to be restarted")?;
    let tools = stores.entry(dir.into()).or_insert_with(|| loaded(dir));
    super::brush_library::enter(dir);
    engine.tools = tools.engine.tools.clone();
    engine.presets = tools.engine.presets.clone();
    engine.patterns = tools.engine.patterns.clone();
    engine.edit_state.custom_shapes = tools.engine.edit_state.custom_shapes.clone();
    engine.style_clipboard = tools.engine.style_clipboard.clone();
    Ok(std::mem::take(&mut tools.warnings))
}
/// Previews use the same profile brush and sampled tips without consuming
/// warnings or writing preferences/presets.
pub(super) fn preview_settings(dir: &Path, engine: &mut Session) -> Result<(), String> {
    let stores = stores()
        .lock()
        .map_err(|_| "Brush library needs to be restarted")?;
    super::brush_library::enter(dir);
    if let Some(tools)=stores.get(dir){copy_settings(&tools.engine,engine);}else{drop(stores);let staged=load_profile(dir,false);copy_settings(&staged.engine,engine);}
    Ok(())
}
fn copy_settings(source:&Session,target:&mut Session){
    target.tools=source.tools.clone();target.presets=source.presets.clone();target.patterns=source.patterns.clone();target.edit_state.custom_shapes=source.edit_state.custom_shapes.clone();target.style_clipboard=source.style_clipboard.clone();
}
pub(super) fn execute(
    dir: &Path,
    engine: &mut Session,
    command: &str,
    work: impl FnOnce(&mut Session) -> Result<Value, String>,
) -> Result<(Value, Vec<String>), String> {
    let mut stores = stores()
        .lock()
        .map_err(|_| "Brush library needs to be restarted")?;
    let tools = stores.entry(dir.into()).or_insert_with(|| loaded(dir));
    super::brush_library::enter(dir);
    engine.tools = tools.engine.tools.clone();
    engine.presets = tools.engine.presets.clone();
    engine.patterns = tools.engine.patterns.clone();
    engine.edit_state.custom_shapes = tools.engine.edit_state.custom_shapes.clone();
    engine.style_clipboard = tools.engine.style_clipboard.clone();
    let previous_presets = engine.presets.rev;
    let previous_colors = (engine.tools.foreground, engine.tools.background);
    // Custom shapes and Preset Manager pattern edits change the libraries without bumping a revision.
    let previous_shapes = engine.edit_state.custom_shapes.clone();
    let pattern_names = |engine: &Session| engine.patterns.items.iter().map(|pattern| (pattern.id.clone(), pattern.name.clone())).collect::<Vec<_>>();
    let previous_patterns = pattern_names(engine);
    let mut result = work(engine)?;
    if command == "tool.presets.select" {
        if let Some(background) = result["options"].get("background") {
            engine.tools.background = colors::preset_background(background)?;
        }
        // Brush state is already inspected separately without sampled bitmap
        // payloads. The shell only needs its own options and foreground here.
        if let Some(options) = result["options"].as_object_mut() {
            options.remove("brush");
        }
    }
    if command.starts_with("pattern.") {
        photocraft_engine::presets::patterns::sync(engine);
    }
    tools.engine.tools = engine.tools.clone();
    tools.engine.presets = engine.presets.clone();
    tools.engine.patterns = engine.patterns.clone();
    tools.engine.edit_state.custom_shapes = engine.edit_state.custom_shapes.clone();
    tools.engine.style_clipboard = engine.style_clipboard.clone();
    if previous_colors != (engine.tools.foreground, engine.tools.background)
        || ["tools.setColors", "tools.swapColors", "tools.defaultColors"].contains(&command)
    {
        if let Err(warning) = colors::save(dir, &tools.engine, tools.colors_writable) {
            tools.warnings.push(warning);
        }
    }
    if previous_presets != engine.presets.rev || previous_shapes != engine.edit_state.custom_shapes {
        let bytes = serde_json::to_vec(&tools.engine.presets.to_json(&tools.engine))
            .map_err(|error| error.to_string())?;
        if bytes.len() > 32 * 1024 * 1024 {
            tools.warnings.push("The preset library is too large to save; export imported presets before closing Orion".into());
        } else if let Err(error) =
            photocraft_format::atomic_write(&dir.join("presets.json"), &bytes)
        {
            tools
                .warnings
                .push(format!("Preset library could not be saved: {error}"));
        }
    }
    tools.engine.sync_preset_store();
    if command.starts_with("pattern.")
        && ![
            "pattern.list",
            "pattern.export",
            "pattern.presets.list",
            "pattern.presets.select",
            "pattern.presets.apply",
        ]
        .contains(&command)
        || command == "edit.definePattern"
        || previous_patterns != pattern_names(engine)
    {
        match photocraft_io::pattern_map::write_pat(&tools.engine.patterns.items) {
            Ok(bytes) if bytes.len() <= 128 * 1024 * 1024 => {
                if let Err(error) =
                    photocraft_format::atomic_write(&dir.join("patterns.pat"), &bytes)
                {
                    tools
                        .warnings
                        .push(format!("Pattern library could not be saved: {error}"));
                }
            }
            Ok(_) => tools.warnings.push(
                "The pattern library exceeds 128MB; export its patterns before closing Orion"
                    .into(),
            ),
            Err(error) => tools
                .warnings
                .push(format!("Pattern library could not be saved: {error}")),
        }
    }
    if [
        "tools.setBrush",
        "brush.presets.select",
        "brush.texturePattern",
        "tool.presets.select",
    ]
    .contains(&command)
    {
        let bytes = serde_json::to_vec(&tools.engine.tools.brush).map_err(|e| e.to_string())?;
        if bytes.len() > 64 * 1024 * 1024 {
            tools.warnings.push(
                "Current brush settings are too large to save; its library preset is retained"
                    .into(),
            );
        } else if let Err(error) = photocraft_format::atomic_write(&dir.join("brush.json"), &bytes)
        {
            tools
                .warnings
                .push(format!("Brush settings could not be saved: {error}"));
        }
    }
    if let Some(store) = tools.engine.preset_store.as_mut() {
        tools.warnings.extend(store.take_warnings());
    }
    Ok((result, std::mem::take(&mut tools.warnings)))
}
pub(super) fn inspect(engine: &Session) -> Value {
    let mut brush = engine.tools.brush.clone();
    let sampled = matches!(brush.tip, TipShape::Sampled(_));
    brush.tip = TipShape::Round;
    brush.dual_brush.tip = TipShape::Round;
    let tiled = matches!(brush.texture.pattern, Pattern::Tile(_));
    if tiled {
        brush.texture.pattern = Pattern::default();
    }
    let mut state = json!({"revision":engine.tools.presets_rev,"settings":brush,"sampledTip":sampled,"sampledTexture":tiled,"presets":engine.tools.presets.iter().map(|preset|json!({"name":preset.name,"group":preset.group,"builtin":preset.builtin,"size":preset.brush.size,"hardness":preset.brush.hardness})).collect::<Vec<_>>()});
    super::brush_library::describe(engine, &mut state);
    state
}
pub(super) fn colors(engine: &Session) -> Value { colors::inspect(engine) }
pub(super) fn presets(engine: &Session) -> Value {
    let mut state = json!({"revision":engine.presets.rev,"gradient":engine.presets.gradient.to_json(),
        "cloneSource":{"active":engine.presets.clone.active,"sources":engine.presets.clone.slots.iter().enumerate().map(|(index,slot)|json!({"index":index,"source":slot.source,"anchor":slot.anchor,"offset":slot.offset(),"layer":slot.layer,"width":slot.scale[0],"height":slot.scale[1],"rotation":slot.rotation,"flipH":slot.flip_h,"flipV":slot.flip_v})).collect::<Vec<_>>(),"overlay":engine.presets.clone.overlay},
        "gradients":engine.presets.gradients.iter().map(|group|json!({"name":group.name,"presets":group.items.iter().map(|preset|preset.to_json()).collect::<Vec<_>>()})).collect::<Vec<_>>(),
        "styles":engine.presets.styles.iter().map(|group|json!({"name":group.name,"presets":group.items.iter().map(|preset|preset.to_json()).collect::<Vec<_>>()})).collect::<Vec<_>>(),
        "patterns":engine.presets.pattern_groups.iter().map(|group|json!({"name":group.name,"presets":group.items.iter().filter_map(|id|engine.patterns.items.iter().find(|pattern|&pattern.id==id)).map(|pattern|json!({"id":pattern.id,"name":pattern.display_name(),"width":pattern.width,"height":pattern.height})).collect::<Vec<_>>()})).collect::<Vec<_>>(),
        "pattern":engine.presets.pattern,
        "shapes":photocraft_engine::presets::shapes::all_groups(engine).iter().map(|group|json!({"name":group.name,"presets":group.items.iter().map(|shape|json!({"name":shape.name})).collect::<Vec<_>>()})).collect::<Vec<_>>(),
        "tools":engine.presets.tool_presets.iter().map(|preset|json!({"name":preset.name,"tool":preset.tool})).collect::<Vec<_>>()});
    super::gradient_midpoints::describe(&mut state);
    state
}

/// Upstream's virtual Custom Shapes group supports rename/delete only. Move
/// defined paths into real preset groups for the remaining organization actions.
pub(super) fn edit_shapes(engine: &mut Session, params: &Value) -> Option<Result<Value, String>> {
    use photocraft_engine::presets::{
        shapes::{ShapePreset, CUSTOM_GROUP},
        Group,
    };
    let action = params["action"].as_str()?;
    let custom_group = params["group"].as_str() == Some(CUSTOM_GROUP)
        && !engine
            .presets
            .shapes
            .iter()
            .any(|group| group.name == CUSTOM_GROUP);
    if (action == "newGroup" || action == "renameGroup")
        && params["name"].as_str() == Some(CUSTOM_GROUP)
        || action == "move" && params["to"].as_str() == Some(CUSTOM_GROUP)
    {
        return Some(Err(
            "Custom Shapes is the inbox for newly defined shapes. Choose another group name."
                .into(),
        ));
    }
    if !custom_group || !["move", "renameGroup", "deleteGroup"].contains(&action) {
        return None;
    }
    Some((|| {
        if engine.edit_state.custom_shapes.is_empty() {
            return Err("This custom shape group is empty".into());
        }
        let result = match action {
            "deleteGroup" => {
                let count = engine.edit_state.custom_shapes.len();
                engine.edit_state.custom_shapes.clear();
                json!({"deleted": count})
            }
            "renameGroup" => {
                let name = params["name"].as_str().unwrap_or("").trim();
                if name.is_empty()
                    || name.len() > 255
                    || engine.presets.shapes.iter().any(|group| group.name == name)
                {
                    return Err("Enter a new, unique shape group name up to 255 characters".into());
                }
                let items = std::mem::take(&mut engine.edit_state.custom_shapes)
                    .into_iter()
                    .map(|shape| ShapePreset {
                        name: shape.name,
                        path: shape.path,
                    })
                    .collect();
                engine.presets.shapes.push(Group::new(name, items));
                json!({"name": name})
            }
            "move" => {
                let preset = params["preset"].as_str().ok_or("Choose a custom shape")?;
                let to = params["to"].as_str().unwrap_or("").trim();
                if to.is_empty() || to.len() > 255 {
                    return Err("Enter a destination group up to 255 characters".into());
                }
                let index = engine
                    .edit_state
                    .custom_shapes
                    .iter()
                    .position(|shape| shape.name == preset)
                    .ok_or("The custom shape is no longer available")?;
                let destination = engine
                    .presets
                    .shapes
                    .iter()
                    .position(|group| group.name == to);
                if destination.is_some_and(|i| {
                    engine.presets.shapes[i]
                        .items
                        .iter()
                        .any(|shape| shape.name == preset)
                }) {
                    return Err("A shape with this name already exists in that group".into());
                }
                let shape = engine.edit_state.custom_shapes.remove(index);
                let item = ShapePreset {
                    name: shape.name,
                    path: shape.path,
                };
                if let Some(i) = destination {
                    engine.presets.shapes[i].items.push(item);
                } else {
                    engine.presets.shapes.push(Group::new(to, vec![item]));
                }
                json!({"name": preset, "group": to})
            }
            _ => unreachable!(),
        };
        engine.presets.rev = engine.presets.rev.saturating_add(1);
        Ok(result)
    })())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defined_brushes_custom_shapes_and_managed_patterns_are_saved_for_the_next_launch() {
        let dir=std::env::temp_dir().join(format!("orion-define-presets-{}",ulid::Ulid::new()));
        let mut engine=Session::new();engine.execute("file.new",json!({"width":32,"height":32,"background":"#ffffff"})).unwrap();activate(&dir,&mut engine).unwrap();
        let run=|engine:&mut Session,command:&str,params:Value|{execute(&dir,engine,command,|engine|engine.execute(command,params).map_err(|error|error.to_string())).unwrap();};
        engine.execute("shape.create",json!({"rect":[4,4,20,20],"fill":[1.,0.,0.,1.]})).unwrap();
        run(&mut engine,"edit.defineCustomShape",json!({"name":"Badge"}));
        run(&mut engine,"edit.definePattern",json!({"name":"Swatch","rect":[0,0,8,8]}));
        run(&mut engine,"edit.presets.presetManager",json!({"action":"rename","kind":"patterns","name":"Swatch","newName":"Tile"}));
        engine.execute("layer.new.layer",json!({})).unwrap();engine.execute("select.rect",json!({"x":2,"y":2,"width":8,"height":8})).unwrap();engine.execute("edit.fill",json!({"contents":"black"})).unwrap();
        run(&mut engine,"edit.defineBrushPreset",json!({"name":"Dot"}));
        let reopened=load_profile(&dir,false).engine;
        assert!(reopened.edit_state.custom_shapes.iter().any(|shape|shape.name=="Badge"));
        assert!(reopened.patterns.items.iter().any(|pattern|pattern.name=="Tile"));
        assert!(reopened.tools.presets.iter().any(|preset|preset.name=="Dot"));
        stores().lock().unwrap().remove(&dir);std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn native_clone_source_crosshair_mapping_has_known_inverse_transform_coordinates() {
        use photocraft_engine::presets::clone_source::{Mapping,transform_matrix};
        for(rotation,flip_h,flip_v,expected)in [(0.0,false,false,(12.0,32.0)),(90.0,false,false,(7.0,28.0)),(90.0,true,false,(13.0,28.0)),(90.0,true,true,(13.0,12.0))]{
            let mapping=Mapping{source:(10.0,20.0),anchor:(40.0,30.0),m:transform_matrix([200.0,50.0],rotation,flip_h,flip_v)};let actual=mapping.map(44.0,36.0);assert!((actual.0-expected.0).abs()<1e-12);assert!((actual.1-expected.1).abs()<1e-12);
        }
        let identity=Mapping{source:(10.0,20.0),anchor:(30.0,25.0),m:transform_matrix([100.0,100.0],0.0,false,false)};assert_eq!(identity.map(50.0,40.0),(30.0,35.0));
    }

    #[test]
    fn native_clone_source_offsets_pair_before_or_after_first_anchor_without_document_edits() {
        let _guard = crate::xdesign_photo::feedback_serial();
        use photocraft_engine::presets::clone_source::mapping;
        for paired in [false,true]{
            let dir=std::env::temp_dir().join(format!("orion-clone-offset-{}",ulid::Ulid::new()));let mut engine=clone_canvas_fixture(16);activate(&dir,&mut engine).unwrap();
            color_command(&dir,&mut engine,"cloneSource.set",json!({"index":1,"source":[55,35]}));let other=engine.presets.clone.slots[1].clone();color_command(&dir,&mut engine,"cloneSource.set",json!({"index":2,"source":[10,20]}));let paired_slot=engine.presets.clone.slots[2].clone();for params in [json!({"index":2,"width":200}),json!({"index":2,"height":50}),json!({"index":2,"rotation":90}),json!({"index":2,"flipH":true})]{color_command(&dir,&mut engine,"cloneSource.set",params);}let transformed=&engine.presets.clone.slots[2];assert_eq!(transformed.source,paired_slot.source);assert_eq!(transformed.anchor,paired_slot.anchor);assert_eq!(transformed.offset(),paired_slot.offset());assert_eq!(transformed.layer,paired_slot.layer);let layer=transformed.layer;
            if paired{clone_canvas_paint(&dir,&mut engine,"paint.cloneStamp",json!({"points":[[40,30]],"size":5,"hardness":100,"aligned":true,"seed":1967}),false);assert_eq!(engine.presets.clone.slots[2].anchor,Some([40.0,30.0]));}else{assert_eq!(engine.presets.clone.slots[2].anchor,None);}let before=engine.active().unwrap().clone();
            color_command(&dir,&mut engine,"cloneSource.set",json!({"index":2,"offset":[-2.5,4.25]}));let slot=&engine.presets.clone.slots[2];assert_eq!(slot.anchor,Some(if paired{[40.0,30.0]}else{[10.0,20.0]}));assert_eq!(slot.source,Some(if paired{[37.5,34.25]}else{[7.5,24.25]}));assert_eq!(slot.offset(),Some([-2.5,4.25]));assert_eq!(slot.layer,layer);assert_eq!(slot.scale,[200.0,50.0]);
            let actual=mapping(&mut engine,&json!({}),(50.0,40.0),"paint.cloneStamp").unwrap();let point=if paired{(44.0,36.0)}else{(14.0,26.0)};let expected=if paired{(40.5,42.25)}else{(10.5,32.25)};let sample=actual.map(point.0,point.1);assert!((sample.0-expected.0).abs()<1e-12);assert!((sample.1-expected.1).abs()<1e-12);
            color_command(&dir,&mut engine,"cloneSource.set",json!({"index":2,"offset":[-2.5,-1.5]}));assert_eq!(engine.presets.clone.slots[2].offset(),Some([-2.5,-1.5]));assert_eq!(engine.presets.clone.slots[1],other);assert_eq!(engine.presets.clone.active,2);
            let current=engine.active().unwrap();assert!(std::sync::Arc::ptr_eq(&before.doc,&current.doc));assert_eq!(before.history.entries(),current.history.entries());assert_eq!(before.revision,current.revision);assert_eq!(before.active_layer,current.active_layer);assert_eq!(before.selected_layers,current.selected_layers);
            let pairing=engine.presets.clone.slots[2].clone();for params in [json!({"index":2,"width":-125.5}),json!({"index":2,"height":1000}),json!({"index":2,"rotation":180}),json!({"index":2,"flipV":true})]{color_command(&dir,&mut engine,"cloneSource.set",params);}let transformed=&engine.presets.clone.slots[2];assert_eq!(transformed.scale,[-125.5,1000.0]);assert_eq!(transformed.rotation,-180.0);assert!(transformed.flip_h&&transformed.flip_v);assert_eq!(transformed.source,pairing.source);assert_eq!(transformed.anchor,pairing.anchor);assert_eq!(transformed.offset(),pairing.offset());assert_eq!(engine.presets.clone.slots[1],other);
            let slots=engine.presets.clone.clone();let journal=engine.journal.clone();assert!(execute(&dir,&mut engine,"cloneSource.set",|engine|engine.execute("cloneSource.set",json!({"index":4,"offset":[1,2]})).map_err(|error|error.to_string())).is_err());assert_eq!(engine.presets.clone,slots);assert_eq!(engine.journal,journal);assert!(execute(&dir,&mut engine,"cloneSource.set",|engine|engine.execute("cloneSource.set",json!({"index":99,"width":200})).map_err(|error|error.to_string())).is_err());assert_eq!(engine.presets.clone,slots);assert_eq!(engine.journal,journal);assert!(std::sync::Arc::ptr_eq(&before.doc,&engine.active().unwrap().doc));
            stores().lock().unwrap().remove(&dir);if dir.exists(){std::fs::remove_dir_all(dir).unwrap();}
        }
    }

    #[test]
    fn native_clone_source_offsets_reset_preserves_pairing_and_explicit_stroke_transform_precedence() {
        let _guard = crate::xdesign_photo::feedback_serial();
        use photocraft_engine::presets::clone_source::mapping;
        for depth in [8,16,32]{for cached in [false,true]{for command in ["paint.cloneStamp","paint.healingBrush"]{
            let dir=std::env::temp_dir().join(format!("orion-clone-reset-{}",ulid::Ulid::new()));let mut engine=clone_canvas_fixture(depth);activate(&dir,&mut engine).unwrap();color_command(&dir,&mut engine,"cloneSource.set",json!({"index":1,"source":[55,35]}));color_command(&dir,&mut engine,"cloneSource.set",json!({"index":2,"source":[10,10],"width":200,"height":50,"rotation":90,"flipH":true,"flipV":true}));clone_canvas_paint(&dir,&mut engine,command,json!({"points":[[40,30]],"size":5,"hardness":100,"aligned":true,"seed":1967}),cached);assert_eq!(engine.presets.clone.slots[2].anchor,Some([40.0,30.0]));let before=engine.active().unwrap().clone();let brush=engine.tools.brush.clone();color_command(&dir,&mut engine,"cloneSource.set",json!({"index":2,"offset":[-30,-20]}));let slots=engine.presets.clone.clone();
            color_command(&dir,&mut engine,"cloneSource.resetTransform",json!({"index":2}));let mut expected=slots.clone();let slot=&mut expected.slots[2];slot.scale=[100.0,100.0];slot.rotation=0.0;slot.flip_h=false;slot.flip_v=false;assert_eq!(engine.presets.clone,expected);assert_eq!(presets(&engine)["cloneSource"]["sources"][2]["offset"],json!([-30.0,-20.0]));assert!(std::sync::Arc::ptr_eq(&before.doc,&engine.active().unwrap().doc));assert_eq!(before.history.entries(),engine.active().unwrap().history.entries());assert_eq!(before.revision,engine.active().unwrap().revision);assert_eq!(engine.tools.brush,brush);
            let identity=mapping(&mut engine,&json!({}),(50.0,40.0),command).unwrap();assert_eq!(identity.map(44.0,36.0),(14.0,16.0));let explicit=mapping(&mut engine,&json!({"scale":[200,50],"rotation":90,"flipH":true}),(50.0,40.0),command).unwrap();let sample=explicit.map(44.0,36.0);assert!((sample.0-13.0).abs()<1e-12);assert!((sample.1-18.0).abs()<1e-12);
            let layer=engine.active().unwrap().active_layer.unwrap();let donor=before.doc.layer(layer).unwrap().surface().unwrap().pixel(20,20);clone_canvas_paint(&dir,&mut engine,command,json!({"points":[[50,40]],"size":5,"hardness":100,"opacity":100,"flow":100,"seed":1967}),cached);if command=="paint.cloneStamp"{let actual=engine.active().unwrap().doc.layer(layer).unwrap().surface().unwrap().pixel(50,40);for(actual,expected)in actual.iter().zip(donor){assert!((actual-expected).abs()<0.02,"reset donor/{depth}/{cached}: {actual} vs {expected}");}}
            stores().lock().unwrap().remove(&dir);if dir.exists(){std::fs::remove_dir_all(dir).unwrap();}
        }}}
    }

    fn clone_canvas_fixture(depth:u32)->Session {
        let mut engine=Session::new();engine.execute("file.new",json!({"width":64,"height":48,"depth":depth,"background":"black"})).unwrap();
        engine.edit("Known clone donors",|doc,active|{let surface=doc.layer_mut(active.unwrap()).unwrap().surface_mut().unwrap();for y in 0..48{for x in 0..64{surface.write_pixel(x,y,&[x as f32/63.0,y as f32/47.0,((x*17+y*11+x*y)%29)as f32/40.0,1.0]);}}Ok(())}).unwrap();engine
    }
    fn clone_canvas_twin(engine:&Session)->Session {
        let mut result=Session::new();result.add_document((*engine.active().unwrap().doc).clone(),None);*result.active_mut().unwrap()=engine.active().unwrap().clone();result.tools=engine.tools.clone();result.presets=engine.presets.clone();result.patterns=engine.patterns.clone();result.journal=engine.journal.clone();result.edit_state=engine.edit_state.clone();result
    }
    fn clone_canvas_paint(dir:&Path,engine:&mut Session,command:&str,params:Value,cached:bool) {
        let mut expected=clone_canvas_twin(engine);let mut invocation=params.clone();let context=super::super::mask_filters::prepare_paint_fade(&expected,command,&mut invocation);let native=expected.execute(command,invocation).unwrap();super::super::mask_filters::finish_paint_fade(&mut expected,context);
        let identity=format!("clone-slot-{}",ulid::Ulid::new());let before=engine.active().unwrap().doc.clone();
        if cached{let sources=engine.presets.clone.clone();super::super::stroke::render_with_identity(engine,Some(&identity),command,&params,0,0,64,48,1).unwrap();assert!(std::sync::Arc::ptr_eq(&before,&engine.active().unwrap().doc));assert_eq!(engine.presets.clone,sources);}
        let result=execute(dir,engine,command,|engine|if cached{super::super::stroke::commit_feedback(engine,&identity,command,&params).unwrap()}else{super::super::execute_view_command(engine,command,params)}).unwrap().0;
        if cached{assert_eq!(engine.jobs_with_recent().last().unwrap().state,"done");super::super::stroke::release(&identity,1967).unwrap();}
        let actual=engine.active().unwrap();let reference=expected.active().unwrap();assert_eq!(result,native);assert_eq!(actual.doc,reference.doc);assert_eq!(actual.history.entries(),reference.history.entries());assert_eq!(actual.revision,reference.revision);assert_eq!(actual.coalesce,reference.coalesce);assert_eq!(actual.last_damage,reference.last_damage);assert_eq!(actual.active_layer,reference.active_layer);assert_eq!(actual.selected_layers,reference.selected_layers);assert_eq!(actual.channel_view,reference.channel_view);assert_eq!(engine.tools.brush,expected.tools.brush);assert_eq!(engine.presets.clone,expected.presets.clone);assert_eq!(engine.journal,expected.journal);assert_eq!(engine.edit_state.fade,expected.edit_state.fade);
    }

    #[test]
    fn native_clone_source_canvas_state_is_bounded_and_matches_native_slots_without_pixel_or_history_changes() {
        let dir=std::env::temp_dir().join(format!("orion-clone-state-{}",ulid::Ulid::new()));let mut engine=clone_canvas_fixture(16);activate(&dir,&mut engine).unwrap();let before=engine.active().unwrap().clone();
        for index in 0..5{color_command(&dir,&mut engine,"cloneSource.set",json!({"index":index,"source":[index+3,index+7],"width":135,"height":80,"rotation":27,"flipH":true}));}
        color_command(&dir,&mut engine,"cloneSource.select",json!({"index":2}));let actual=presets(&engine)["cloneSource"].clone();let expected=engine.execute("cloneSource.list",json!({})).unwrap();assert_eq!(actual,expected);assert_eq!(actual["sources"].as_array().unwrap().len(),5);assert_eq!(actual["active"],2);assert!(std::sync::Arc::ptr_eq(&before.doc,&engine.active().unwrap().doc));assert_eq!(before.history.entries(),engine.active().unwrap().history.entries());assert_eq!(before.revision,engine.active().unwrap().revision);
        let mut staged=Session::new();preview_settings(&dir,&mut staged).unwrap();assert_eq!(presets(&staged)["cloneSource"],actual);let mut opened=clone_canvas_fixture(8);activate(&dir,&mut opened).unwrap();assert_eq!(presets(&opened)["cloneSource"],actual);assert_ne!(opened.active().unwrap().doc.id,engine.active().unwrap().doc.id);
        stores().lock().unwrap().remove(&dir);if dir.exists(){std::fs::remove_dir_all(dir).unwrap();}
    }

    #[test]
    fn native_clone_source_canvas_ordinary_and_cached_strokes_keep_donors_alignment_and_slot_transforms() {
        let _guard = crate::xdesign_photo::feedback_serial();
        for depth in [8,16,32]{for command in ["paint.cloneStamp","paint.healingBrush"]{for aligned in [false,true]{for cached in [false,true]{
            let dir=std::env::temp_dir().join(format!("orion-clone-strokes-{}",ulid::Ulid::new()));let mut engine=clone_canvas_fixture(depth);activate(&dir,&mut engine).unwrap();color_command(&dir,&mut engine,"cloneSource.set",json!({"index":2,"source":[10,10]}));let layer=engine.active().unwrap().active_layer.unwrap();let before=engine.active().unwrap().doc.clone();let first=before.layer(layer).unwrap().surface().unwrap().pixel(10,10);let second=before.layer(layer).unwrap().surface().unwrap().pixel(if aligned{20}else{10},if aligned{20}else{10});
            for point in [[40,30],[50,40]]{clone_canvas_paint(&dir,&mut engine,command,json!({"points":[point],"size":5,"hardness":100,"opacity":100,"flow":100,"aligned":aligned,"seed":1967}),cached);if command=="paint.cloneStamp"{let expected=if point[0]==40{&first}else{&second};let actual=engine.active().unwrap().doc.layer(layer).unwrap().surface().unwrap().pixel(point[0],point[1]);for(actual,expected)in actual.iter().zip(expected){assert!((actual-expected).abs()<0.02,"known donor/{depth}/{aligned}/{cached}: {actual} vs {expected}");}}}
            assert_ne!(engine.active().unwrap().doc.layer(layer).unwrap().surface().unwrap().read_region(before.bounds()),before.layer(layer).unwrap().surface().unwrap().read_region(before.bounds()));let source=presets(&engine)["cloneSource"].clone();assert_eq!(source["sources"][2]["anchor"],if aligned{json!([40.0,30.0])}else{Value::Null});
            color_command(&dir,&mut engine,"cloneSource.set",json!({"index":3,"source":[28,8],"width":150,"height":80,"rotation":27,"flipV":true}));let mut transformed=clone_canvas_twin(&engine);let mut omitted=clone_canvas_twin(&engine);let explicit=json!({"points":[[40,16]],"size":7,"hardness":100,"source":[28,8],"scale":[150,80],"rotation":27,"flipH":false,"flipV":true,"seed":1967});transformed.execute(command,explicit).unwrap();omitted.execute(command,json!({"points":[[40,16]],"size":7,"hardness":100,"seed":1967})).unwrap();assert_eq!(omitted.active().unwrap().doc,transformed.active().unwrap().doc);
            clone_canvas_paint(&dir,&mut engine,command,json!({"points":[[40,16]],"size":7,"hardness":100,"seed":1967}),cached);assert_eq!(engine.active().unwrap().doc,transformed.active().unwrap().doc);assert_eq!(presets(&engine)["cloneSource"]["sources"][2],source["sources"][2]);
            stores().lock().unwrap().remove(&dir);if dir.exists(){std::fs::remove_dir_all(dir).unwrap();}
        }}}}
    }

    #[test]
    fn native_clone_source_canvas_activation_samples_current_document_and_missing_source_refuses_unchanged() {
        let _guard = crate::xdesign_photo::feedback_serial();
        for cached in [false,true]{let dir=std::env::temp_dir().join(format!("orion-clone-docs-{}",ulid::Ulid::new()));let mut first=clone_canvas_fixture(16);activate(&dir,&mut first).unwrap();color_command(&dir,&mut first,"cloneSource.set",json!({"source":[10,10]}));clone_canvas_paint(&dir,&mut first,"paint.cloneStamp",json!({"points":[[40,30]],"size":5,"hardness":100,"seed":1967}),cached);
            let mut second=clone_canvas_fixture(16);second.edit("Different image donor",|doc,active|{doc.layer_mut(active.unwrap()).unwrap().surface_mut().unwrap().fill_rect(photocraft_engine::doc::Rect::from_xywh(0,0,32,24),&[0.2,0.8,0.4,1.0]);Ok(())}).unwrap();activate(&dir,&mut second).unwrap();assert_ne!(first.active().unwrap().doc.id,second.active().unwrap().doc.id);assert_eq!(presets(&first)["cloneSource"],presets(&second)["cloneSource"]);clone_canvas_paint(&dir,&mut second,"paint.cloneStamp",json!({"points":[[50,40]],"size":5,"hardness":100,"seed":1967}),cached);let pixel=second.active().unwrap().doc.layer(second.active().unwrap().active_layer.unwrap()).unwrap().surface().unwrap().pixel(50,40);for(actual,expected)in pixel.iter().zip([0.2,0.8,0.4,1.0]){assert!((actual-expected).abs()<0.02);}
            color_command(&dir,&mut second,"cloneSource.select",json!({"index":4}));let before=second.active().unwrap().clone();let sources=second.presets.clone.clone();let journal=second.journal.clone();let fade=second.edit_state.fade.clone();let params=json!({"points":[[40,30]],"size":5,"seed":1967});assert!(execute(&dir,&mut second,"paint.cloneStamp",|engine|super::super::execute_view_command(engine,"paint.cloneStamp",params.clone())).is_err());assert!(super::super::stroke::render_with_identity(&second,Some("clone-missing"),"paint.cloneStamp",&params,0,0,64,48,1).is_err());assert!(std::sync::Arc::ptr_eq(&before.doc,&second.active().unwrap().doc));assert_eq!(second.active().unwrap().history.entries(),before.history.entries());assert_eq!(second.active().unwrap().revision,before.revision);assert_eq!(second.presets.clone,sources);assert_eq!(second.journal,journal);assert_eq!(second.edit_state.fade,fade);
            stores().lock().unwrap().remove(&dir);if dir.exists(){std::fs::remove_dir_all(dir).unwrap();}
        }
    }

    #[test]
    fn readonly_profile_staging_retains_style_clipboard_tools_and_unconsumed_warnings() {
        let dir=std::env::temp_dir().join(format!("orion-stage-profile-{}",ulid::Ulid::new()));
        let mut source=Session::new();activate(&dir,&mut source).unwrap();
        source.execute("file.new",json!({"width":8,"height":8,"background":"white"})).unwrap();
        for(command,params)in [("layer.layerStyle.dropShadow",json!({"size":7})),("layer.layerStyle.copyLayerStyle",json!({}))]{execute(&dir,&mut source,command,|engine|engine.execute(command,params).map_err(|error|error.to_string())).unwrap();}
        stores().lock().unwrap().get_mut(&dir).unwrap().warnings.push("Retained staging warning".into());
        let before:Vec<_>=["brush.json","colors.json","presets.json"].into_iter().map(|name|std::fs::read(dir.join(name)).ok()).collect();
        for _ in 0..2{let mut staged=Session::new();staged.execute("file.new",json!({"width":8,"height":8})).unwrap();preview_settings(&dir,&mut staged).unwrap();assert_eq!(inspect(&staged),inspect(&source));assert_eq!(colors(&staged),colors(&source));assert_eq!(presets(&staged),presets(&source));assert_eq!(staged.style_clipboard,source.style_clipboard);assert!(staged.is_enabled("layer.layerStyle.pasteLayerStyle"));}
        let after:Vec<_>=["brush.json","colors.json","presets.json"].into_iter().map(|name|std::fs::read(dir.join(name)).ok()).collect();assert_eq!(before,after);
        let mut opened=Session::new();assert_eq!(activate(&dir,&mut opened).unwrap(),vec!["Retained staging warning"]);
        stores().lock().unwrap().remove(&dir);if dir.exists(){std::fs::remove_dir_all(dir).unwrap();}
    }

    #[test]
    fn cold_profile_staging_never_attaches_syncs_or_installs_an_authoritative_store() {
        let dir=std::env::temp_dir().join(format!("orion-cold-stage-profile-{}",ulid::Ulid::new()));
        std::fs::create_dir_all(dir.join("brushes/tips")).unwrap();
        let orphan=dir.join("brushes/tips/orphan.pctip");std::fs::write(&orphan,b"retain unreferenced tip").unwrap();
        let mut brush=photocraft_engine::BrushSettings::default();brush.size=37.0;let brush_bytes=serde_json::to_vec(&brush).unwrap();std::fs::write(dir.join("brush.json"),&brush_bytes).unwrap();
        let hidden=Session::new().tools.presets[0].name.clone();
        let replaced=Session::new().tools.presets[1].name.clone();let mut replacement=brush.clone();replacement.size=77.0;
        let group=json!({"format":"photocraft-brush-group","version":1,"group":"Cold fixture","presets":[{"name":"Cold custom","brush":brush},{"name":replaced,"brush":replacement}]});std::fs::write(dir.join("brushes/Cold.pcbrushes"),serde_json::to_vec(&group).unwrap()).unwrap();
        let index=json!({"version":1,"groups":["Cold.pcbrushes"],"hiddenBuiltins":[hidden],"order":["Cold custom"],"retainedMetadata":"untouched"});std::fs::write(dir.join("brushes/index.json"),serde_json::to_vec(&index).unwrap()).unwrap();
        let saved_colors=json!({"schemaVersion":1,"foreground":[0.2,0.3,0.4,0.5],"background":[0.6,0.7,0.8,0.9]});let colors_bytes=serde_json::to_vec(&saved_colors).unwrap();std::fs::write(dir.join("colors.json"),&colors_bytes).unwrap();
        fn fingerprint(root:&Path,dir:&Path,files:&mut std::collections::BTreeMap<PathBuf,Option<Vec<u8>>>){for entry in std::fs::read_dir(dir).unwrap(){let path=entry.unwrap().path();if path.is_dir(){files.insert(path.strip_prefix(root).unwrap().to_owned(),None);fingerprint(root,&path,files);}else{files.insert(path.strip_prefix(root).unwrap().to_owned(),Some(std::fs::read(&path).unwrap()));}}}
        let mut before=std::collections::BTreeMap::new();fingerprint(&dir,&dir,&mut before);
        let mut staged=Session::new();preview_settings(&dir,&mut staged).unwrap();assert_eq!(staged.tools.brush.size,37.0);assert_eq!(staged.tools.foreground,[0.2,0.3,0.4,0.5]);assert_eq!(staged.tools.presets[0].name,"Cold custom");assert!(!staged.tools.presets.iter().any(|preset|preset.name.eq_ignore_ascii_case(&hidden)));assert!(staged.preset_store.is_none());assert!(!stores().lock().unwrap().contains_key(&dir));assert_eq!(std::fs::read(&orphan).unwrap(),b"retain unreferenced tip");assert_eq!(std::fs::read(dir.join("brush.json")).unwrap(),brush_bytes);assert_eq!(std::fs::read(dir.join("colors.json")).unwrap(),colors_bytes);let mut after=std::collections::BTreeMap::new();fingerprint(&dir,&dir,&mut after);assert_eq!(before,after);
        let missing=dir.join("absent");preview_settings(&missing,&mut Session::new()).unwrap();assert!(!missing.exists());assert!(!stores().lock().unwrap().contains_key(&missing));
        let copied=dir.with_extension("attached");std::fs::create_dir_all(&copied).unwrap();for(path,bytes)in &before{match bytes{Some(bytes)=>std::fs::write(copied.join(path),bytes).unwrap(),None=>std::fs::create_dir_all(copied.join(path)).unwrap()}}
        let native=load_profile(&copied,true);assert_eq!(inspect(&staged),inspect(&native.engine));assert_eq!(colors(&staged),colors(&native.engine));assert_eq!(presets(&staged),presets(&native.engine));assert_eq!(staged.tools.presets.iter().find(|preset|preset.name.eq_ignore_ascii_case(&replaced)).unwrap().brush.size,77.0);let mut retained=std::collections::BTreeMap::new();fingerprint(&dir,&dir,&mut retained);assert_eq!(before,retained);drop(native);std::fs::remove_dir_all(copied).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn color_command(dir: &Path, engine: &mut Session, command: &str, params: Value) -> Vec<String> {
        execute(dir, engine, command, |engine| engine.execute(command, params).map_err(|error| error.to_string())).unwrap().1
    }
    #[test]
    fn selection_gestures_tool_preset_aliases_and_options_survive_profile_reopen(){
        let dir=std::env::temp_dir().join(format!("orion-selection-presets-{}",ulid::Ulid::new()));let mut engine=Session::new();activate(&dir,&mut engine).unwrap();
        let options=json!({"toolOptions":{"selectionMode":"subtract","paintOptions":{"style":"fixedRatio","ratioWidth":3,"ratioHeight":2,"fromCenter":true,"feather":2.5,"antiAlias":false,"scope":"layers"}}});
        for tool in ["ellipseSelection","polygonLasso","magneticLasso","select.quick","select.object","crop","straighten"]{let name=format!("Saved {tool}");color_command(&dir,&mut engine,"tool.presets.new",json!({"name":name,"tool":tool,"options":options}));}
        stores().lock().unwrap().remove(&dir);let mut reopened=Session::new();activate(&dir,&mut reopened).unwrap();reopened.execute("file.new",json!({"width":16,"height":16})).unwrap();let before=reopened.active().unwrap().doc.clone();let count=reopened.active().unwrap().history.past_len();
        for tool in ["ellipseSelection","polygonLasso","magneticLasso","select.quick","select.object","crop","straighten"]{let result=execute(&dir,&mut reopened,"tool.presets.select",|engine|engine.execute("tool.presets.select",json!({"preset":format!("Saved {tool}")})).map_err(|error|error.to_string())).unwrap();assert!(result.1.is_empty());assert_eq!(result.0["tool"],tool);assert_eq!(result.0["options"],options);assert!(std::sync::Arc::ptr_eq(&before,&reopened.active().unwrap().doc));assert_eq!(reopened.active().unwrap().history.past_len(),count);}
        stores().lock().unwrap().remove(&dir);std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn native_colors_share_exact_values_reopen_presets_and_drive_pencil_background() {
        let dir = std::env::temp_dir().join(format!("orion-native-colors-{}", ulid::Ulid::new()));
        let mut first = Session::new();
        activate(&dir, &mut first).unwrap();
        assert!(!dir.join("colors.json").exists());
        first.execute("file.new", json!({"width":16,"height":16,"depth":16,"background":"#ff0000"})).unwrap();
        let original = first.active().unwrap().doc.clone();
        let undo = first.active().unwrap().history.past_len();
        let foreground = [0.123456f32, 0.4, 1.2, 0.75];
        let background = [0.8f32, 0.2, 0.4, 0.9];
        assert!(color_command(&dir, &mut first, "tools.setColors", json!({"foreground":foreground,"background":background})).is_empty());
        assert!(std::sync::Arc::ptr_eq(&original, &first.active().unwrap().doc));
        assert_eq!(undo, first.active().unwrap().history.past_len());
        let mut preview = Session::new();
        preview_settings(&dir, &mut preview).unwrap();
        assert_eq!(colors(&preview), colors(&first));
        let mut second = Session::new();
        activate(&dir, &mut second).unwrap();
        assert_eq!(second.tools.foreground, foreground);
        assert_eq!(second.tools.background, background);
        stores().lock().unwrap().remove(&dir);
        activate(&dir, &mut second).unwrap();
        assert_eq!(second.tools.foreground, foreground);
        assert_eq!(second.tools.background, background);
        color_command(&dir, &mut second, "tool.presets.new", json!({"name":"Color pair","tool":"pencil","options":{"foreground":foreground,"background":background}}));
        color_command(&dir, &mut second, "tools.defaultColors", json!({}));
        color_command(&dir, &mut second, "tool.presets.select", json!({"preset":"Color pair"}));
        assert_eq!(second.tools.foreground, foreground);
        assert_eq!(second.tools.background, background);
        color_command(&dir, &mut second, "tools.swapColors", json!({}));
        assert_eq!(second.tools.foreground, background);
        assert_eq!(second.tools.background, foreground);
        stores().lock().unwrap().remove(&dir);
        activate(&dir, &mut second).unwrap();
        assert_eq!(second.tools.foreground, background);
        assert_eq!(second.tools.background, foreground);
        color_command(&dir, &mut first, "tools.setColors", json!({"foreground":"#ff0000","background":"#00ffff"}));
        color_command(&dir, &mut first, "paint.pencil", json!({"points":[[8,8]],"size":8,"opacity":1,"autoErase":true,"seed":9}));
        let mut pixel = [[0.0f32;4]];
        first.active().unwrap().doc.layers[0].surface().unwrap().read_rgba_into(photocraft_engine::doc::Rect::new(8,8,9,9), &mut pixel);
        assert_eq!(pixel[0], [0.0,1.0,1.0,1.0]);
        stores().lock().unwrap().remove(&dir);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn native_colors_preserve_unreadable_and_newer_profile_records() {
        for raw in [b"broken".to_vec(), serde_json::to_vec(&json!({"schemaVersion":2,"foreground":[1,0,0,1],"background":[0,1,0,1]})).unwrap(), vec![b' ';4097], serde_json::to_vec(&json!({"schemaVersion":1,"foreground":[1,0,0,1],"background":[0,1,0,1],"future":true})).unwrap()] {
            let dir = std::env::temp_dir().join(format!("orion-unreadable-colors-{}",ulid::Ulid::new()));
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("colors.json"), &raw).unwrap();
            let mut engine = Session::new();
            assert!(activate(&dir,&mut engine).unwrap().iter().any(|warning|warning.contains("could not be restored")));
            let warnings = color_command(&dir,&mut engine,"tools.setColors",json!({"foreground":"#ff0000"}));
            assert!(warnings.iter().any(|warning|warning.contains("retained")));
            assert_eq!(engine.tools.foreground,[1.0,0.0,0.0,1.0]);
            assert_eq!(std::fs::read(dir.join("colors.json")).unwrap(),raw);
            stores().lock().unwrap().remove(&dir);
            std::fs::remove_dir_all(dir).unwrap();
        }
    }
    #[test]
    fn native_colors_write_failures_keep_session_values_and_allow_a_later_retry() {
        let dir=std::env::temp_dir().join(format!("orion-color-write-failure-{}",ulid::Ulid::new()));
        let mut engine=Session::new();
        activate(&dir,&mut engine).unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir(dir.join("colors.json")).unwrap();
        let warnings=color_command(&dir,&mut engine,"tools.setColors",json!({"background":"#20b0c0"}));
        assert!(warnings.iter().any(|warning|warning.contains("could not be saved")));
        let background=engine.tools.background;
        let mut other=Session::new();
        preview_settings(&dir,&mut other).unwrap();
        assert_eq!(other.tools.background,background);
        std::fs::remove_dir(dir.join("colors.json")).unwrap();
        assert!(color_command(&dir,&mut engine,"tools.setColors",json!({"background":background})).is_empty());
        stores().lock().unwrap().remove(&dir);
        activate(&dir,&mut other).unwrap();
        assert_eq!(other.tools.background,background);
        stores().lock().unwrap().remove(&dir);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn custom_shape_group_moves_preserve_paths_and_persist_across_sessions() {
        let dir = std::env::temp_dir().join(format!("orion-custom-shapes-{}", ulid::Ulid::new()));
        let mut engine = Session::new();
        activate(&dir, &mut engine).unwrap();
        let path = photocraft_engine::presets::shapes::parse("M 0 0 L 20 0 L 10 20 Z").unwrap();
        engine
            .edit_state
            .custom_shapes
            .push(photocraft_engine::edit_menu_cmds::CustomShape {
                name: "Triangle".into(),
                path: path.clone(),
            });
        // Share the newly defined custom shape as the real define command does.
        stores()
            .lock()
            .unwrap()
            .get_mut(&dir)
            .unwrap()
            .engine
            .edit_state
            .custom_shapes = engine.edit_state.custom_shapes.clone();
        execute(&dir, &mut engine, "shape.presets.edit", |engine| super::super::execute_view_command(engine, "shape.presets.edit", json!({"action":"move","group":"Custom Shapes","preset":"Triangle","to":"My symbols"}))).unwrap();
        assert!(engine.edit_state.custom_shapes.is_empty());
        stores().lock().unwrap().remove(&dir);
        let mut reopened = Session::new();
        assert!(activate(&dir, &mut reopened).unwrap().is_empty());
        assert_eq!(
            reopened
                .presets
                .shapes
                .iter()
                .find(|group| group.name == "My symbols")
                .unwrap()
                .items[0]
                .path,
            path
        );
        stores().lock().unwrap().remove(&dir);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn custom_shape_group_failures_do_not_partially_move_or_delete_paths() {
        let mut engine = Session::new();
        let path = photocraft_engine::presets::shapes::parse("M 0 0 L 20 0 L 10 20 Z").unwrap();
        engine
            .edit_state
            .custom_shapes
            .push(photocraft_engine::edit_menu_cmds::CustomShape {
                name: "Triangle".into(),
                path,
            });
        let before = engine.presets.to_json(&engine);
        for params in [
            json!({"action":"move","group":"Custom Shapes","preset":"gone","to":"Symbols"}),
            json!({"action":"renameGroup","group":"Custom Shapes","name":""}),
            json!({"action":"move","group":"Custom Shapes","preset":"Triangle","to":"Custom Shapes"}),
        ] {
            assert!(edit_shapes(&mut engine, &params).unwrap().is_err());
            assert_eq!(engine.presets.to_json(&engine), before);
        }
        edit_shapes(
            &mut engine,
            &json!({"action":"renameGroup","group":"Custom Shapes","name":"My custom paths"}),
        )
        .unwrap()
        .unwrap();
        assert!(engine.edit_state.custom_shapes.is_empty());
        assert_eq!(
            engine
                .presets
                .shapes
                .iter()
                .find(|group| group.name == "My custom paths")
                .unwrap()
                .items
                .len(),
            1
        );
        // A later Define Custom Shape still uses the original virtual inbox.
        engine
            .edit_state
            .custom_shapes
            .push(photocraft_engine::edit_menu_cmds::CustomShape {
                name: "Later".into(),
                path: photocraft_engine::presets::shapes::parse("O 10 10 5").unwrap(),
            });
        edit_shapes(
            &mut engine,
            &json!({"action":"deleteGroup","group":"Custom Shapes"}),
        )
        .unwrap()
        .unwrap();
        assert!(engine.edit_state.custom_shapes.is_empty());
        assert!(engine
            .presets
            .shapes
            .iter()
            .any(|group| group.name == "My custom paths"));
    }
    #[test]
    fn pattern_pixels_shapes_and_tool_options_are_shared_and_survive_profile_reopen() {
        let dir = std::env::temp_dir().join(format!("orion-pattern-library-{}", ulid::Ulid::new()));
        let mut first = Session::new();
        first
            .execute(
                "file.new",
                json!({"width":8,"height":8,"background":"white"}),
            )
            .unwrap();
        activate(&dir, &mut first).unwrap();
        first
            .execute(
                "paint.stroke",
                json!({"points":[[4,4,1]],"size":6,"color":"#dd0033"}),
            )
            .unwrap();
        let pattern = execute(&dir, &mut first, "pattern.presets.new", |engine| {
            engine
                .execute(
                    "pattern.presets.new",
                    json!({"name":"Red weave","group":"My patterns"}),
                )
                .map_err(|e| e.to_string())
        })
        .unwrap()
        .0;
        let pattern_id = pattern["pattern"].as_str().unwrap();
        let original = first
            .patterns
            .items
            .iter()
            .find(|pattern| pattern.id == pattern_id)
            .unwrap()
            .clone();
        execute(&dir,&mut first,"shape.presets.new",|engine|engine.execute("shape.presets.new",json!({"name":"My triangle","group":"My shapes","path":"M 0 0 L 100 0 L 50 100 Z"})).map_err(|e|e.to_string())).unwrap();
        execute(&dir,&mut first,"tool.presets.new",|engine|engine.execute("tool.presets.new",json!({"name":"My radial","tool":"gradient","options":{"toolOptions":{"gradientStyle":"radial","gradientReverse":true},"foreground":[1,0,0,1]}})).map_err(|e|e.to_string())).unwrap();
        let mut second = Session::new();
        activate(&dir, &mut second).unwrap();
        assert!(second
            .patterns
            .items
            .iter()
            .any(|pattern| pattern.id == pattern_id));
        stores().lock().unwrap().remove(&dir);
        let mut reopened = Session::new();
        assert!(activate(&dir, &mut reopened).unwrap().is_empty());
        let saved = reopened
            .patterns
            .items
            .iter()
            .find(|pattern| pattern.id == pattern_id)
            .unwrap();
        assert_eq!(
            original.surface.read_region(original.rect()),
            saved.surface.read_region(saved.rect())
        );
        assert!(reopened
            .presets
            .shapes
            .iter()
            .any(|group| group.items.iter().any(|shape| shape.name == "My triangle")));
        let selected = execute(&dir, &mut reopened, "tool.presets.select", |engine| {
            engine
                .execute("tool.presets.select", json!({"preset":"My radial"}))
                .map_err(|e| e.to_string())
        })
        .unwrap()
        .0;
        assert_eq!(
            selected["options"]["toolOptions"]["gradientStyle"],
            "radial"
        );
        assert_eq!(reopened.tools.foreground, [1.0, 0.0, 0.0, 1.0]);
        stores().lock().unwrap().remove(&dir);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn shared_presets_and_settings_survive_new_sessions_and_store_reopen() {
        let dir = std::env::temp_dir().join(format!("orion-brush-library-{}", ulid::Ulid::new()));
        let mut first = Session::new();
        activate(&dir, &mut first).unwrap();
        execute(&dir, &mut first, "tools.setBrush", |engine| {
            engine
                .execute("tools.setBrush", json!({"size":37,"spacing":0.3}))
                .map_err(|e| e.to_string())
        })
        .unwrap();
        execute(&dir, &mut first, "brush.presets.save", |engine| {
            engine
                .execute("brush.presets.save", json!({"name":"My pencil"}))
                .map_err(|e| e.to_string())
        })
        .unwrap();
        execute(&dir, &mut first, "gradient.presets.new", |engine| {
            engine
                .execute(
                    "gradient.presets.new",
                    json!({"name":"Sunset","stops":[[0,"#ff0000"],[1,"#0000ff"]]}),
                )
                .map_err(|error| error.to_string())
        })
        .unwrap();
        execute(&dir, &mut first, "gradient.presets.select", |engine| {
            engine
                .execute(
                    "gradient.presets.select",
                    json!({"preset":"Sunset","applyToLayer":false}),
                )
                .map_err(|error| error.to_string())
        })
        .unwrap();
        first
            .execute(
                "file.new",
                json!({"width":8,"height":8,"background":"white"}),
            )
            .unwrap();
        execute(&dir, &mut first, "layer.layerStyle.dropShadow", |engine| {
            engine
                .execute("layer.layerStyle.dropShadow", json!({"size":7}))
                .map_err(|error| error.to_string())
        })
        .unwrap();
        execute(
            &dir,
            &mut first,
            "layer.layerStyle.copyLayerStyle",
            |engine| {
                engine
                    .execute("layer.layerStyle.copyLayerStyle", json!({}))
                    .map_err(|error| error.to_string())
            },
        )
        .unwrap();
        execute(&dir, &mut first, "style.presets.new", |engine| {
            engine
                .execute("style.presets.new", json!({"name":"My shadow"}))
                .map_err(|error| error.to_string())
        })
        .unwrap();
        let mut second = Session::new();
        second
            .execute(
                "file.new",
                json!({"width":8,"height":8,"background":"white"}),
            )
            .unwrap();
        activate(&dir, &mut second).unwrap();
        assert_eq!(second.tools.brush.size, 37.0);
        assert_eq!(second.presets.gradient.name, "Sunset");
        execute(
            &dir,
            &mut second,
            "layer.layerStyle.pasteLayerStyle",
            |engine| {
                engine
                    .execute("layer.layerStyle.pasteLayerStyle", json!({}))
                    .map_err(|error| error.to_string())
            },
        )
        .unwrap();
        let state = second.active().unwrap();
        assert_eq!(
            state
                .doc
                .layer(state.active_layer.unwrap())
                .unwrap()
                .effects
                .items
                .len(),
            1
        );
        assert!(second
            .tools
            .presets
            .iter()
            .any(|preset| preset.name == "My pencil"));
        stores().lock().unwrap().remove(&dir);
        let mut reopened = Session::new();
        assert!(activate(&dir, &mut reopened).unwrap().is_empty());
        assert_eq!(reopened.tools.brush.size, 37.0);
        assert_eq!(reopened.presets.gradient.name, "Sunset");
        assert!(reopened
            .presets
            .styles
            .iter()
            .any(|group| group.items.iter().any(|preset| preset.name == "My shadow")));
        assert!(reopened
            .presets
            .gradients
            .iter()
            .any(|group| group.items.iter().any(|preset| preset.name == "Sunset")));
        assert!(reopened
            .tools
            .presets
            .iter()
            .any(|preset| preset.name == "My pencil"));
        stores().lock().unwrap().remove(&dir);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
