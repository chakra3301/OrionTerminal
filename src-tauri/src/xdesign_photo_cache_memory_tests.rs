use super::*;
use photocraft_engine::{Session, channel_cmds::ChannelTarget, doc::{
    Color, ColorMode, Document, Fill, FillCache, Layer, LayerMask, Pattern, PixelFormat, Rect,
    SampleType, SmartObject, Surface, VideoData,
}};
use serde_json::json;
use std::sync::Arc;

const TEST_LIMIT: usize = 32 * 1024 * 1024;

fn session() -> PhotoSession {
    let mut engine = Session::new();
    engine.execute("file.new", json!({"width":24,"height":24,"background":"white"})).unwrap();
    PhotoSession { engine, color_settings:None, version:"pinned".into(), original_path:None, writer:Default::default() }
}

fn tile(gray: bool) -> Surface {
    let format = if gray { PixelFormat::new(ColorMode::Grayscale, SampleType::U8, false) } else { PixelFormat::RGBA8 };
    let mut surface = Surface::new(format);
    let value: &[f32] = if gray { &[0.5] } else { &[0.2, 0.4, 0.6, 1.0] };
    surface.write_region(Rect::new(0, 0, 1, 1), value);
    surface
}

fn add_extra(document: &mut Document, kind: usize) -> usize {
    let surface = tile(kind == 0 || kind == 3);
    let tile_bytes = surface.tiles().map(|(_, tile)| tile.bytes().len()).sum::<usize>();
    match kind {
        0 => {
            let mut smart = SmartObject::new(SmartSource::Linked { path:"unresolved.psd".into() }, Default::default(), None);
            smart.filter_mask = Some(LayerMask { surface, ..LayerMask::reveal_all() });
            document.layers.push(Layer::new("extra", LayerContent::Smart(smart)));
        }
        1 => {
            let mut layer = Layer::new("extra", LayerContent::Fill(Fill::Solid(Color::BLACK)));
            layer.fill_cache = Some(FillCache { fill:Fill::Solid(Color::BLACK), surface });
            document.layers.push(layer);
        }
        2 => {
            let mut layer = Layer::raster("extra", PixelFormat::RGBA8);
            layer.video = Some(VideoData::new(vec![surface], 24.0));
            document.layers.push(layer);
        }
        3 => document.selection = Some(surface),
        4 => document.patterns.push(Pattern::new("extra", surface, 1, 1)),
        5 => {
            let bytes = Arc::new(Vec::with_capacity(512 * 1024));
            let smart = SmartObject::new(SmartSource::Embedded { file_name:"empty-capacity.psd".into(), bytes }, Default::default(), None);
            document.layers.push(Layer::new("extra", LayerContent::Smart(smart)));
            return 512 * 1024;
        }
        6 => {
            document.layers[0].psd_blocks.push((*b"test", Arc::new(Vec::with_capacity(512 * 1024))));
            return 512 * 1024;
        }
        _ => unreachable!(),
    }
    tile_bytes
}

fn remove_extra(document: &mut Document) {
    document.layers.retain(|layer| layer.name != "extra");
    for layer in &mut document.layers { layer.psd_blocks.clear(); }
    document.selection = None;
    document.patterns.clear();
}

#[test]
fn measures_current_and_borrowed_undo_resources_native_history_omits() {
    for kind in 0..7 {
        let mut value = session();
        let initial = estimate(&value, TEST_LIMIT);
        let payload = add_extra(Arc::make_mut(&mut value.engine.active_mut().unwrap().doc), kind);
        let current = estimate(&value, TEST_LIMIT);
        assert!(current >= initial + payload, "current kind {kind}: {initial} -> {current}");
        assert!(current >= legacy_estimate(&value).0);
        value.engine.edit("Remove extra", |doc, _| { remove_extra(doc); Ok(()) }).unwrap();
        let old = value.engine.active().unwrap().history.state(0).unwrap();
        assert_eq!(old.id, value.engine.active().unwrap().doc.id);
        let retained = estimate(&value, TEST_LIMIT);
        assert!(retained >= legacy_estimate(&value).0 + payload, "historical kind {kind}");
        assert!(retained >= initial + payload);
    }
}

#[test]
fn never_drops_below_prior_estimate_with_selection_patterns_metadata_and_long_history() {
    let mut value = session();
    let doc = Arc::make_mut(&mut value.engine.active_mut().unwrap().doc);
    add_extra(doc, 3); add_extra(doc, 4); add_extra(doc, 5);
    doc.metadata.exif = Some(Arc::new(vec![7; 32 * 1024]));
    doc.metadata.xmp = Some("retained metadata".repeat(1024));
    doc.icc_profile = Some(Arc::new(vec![8; 1024]));
    doc.metadata.psd_resources.push((9000, "resource".into(), Arc::new(vec![9; 1024])));
    doc.metadata.psd_global_blocks.push((*b"8BIM", *b"test", Arc::new(vec![10; 1024])));
    for index in 0..20 {
        value.engine.edit("Rename", |doc, _| { doc.name = format!("history {index}"); Ok(()) }).unwrap();
        for limit in [1, 128 * 1024, TEST_LIMIT] { assert!(estimate(&value, limit) >= legacy_estimate(&value).0); }
    }
    value.engine.undo();
    assert!(value.engine.active().unwrap().history.can_redo());
    for limit in [1, 128 * 1024, TEST_LIMIT] { assert!(estimate(&value, limit) >= legacy_estimate(&value).0); }
}

#[test]
fn shared_resource_allocations_are_not_charged_again_for_distinct_snapshot_ids() {
    let mut shared = session();
    let source = Arc::new(vec![7; 1024 * 1024]);
    let make = |bytes| Layer::new("extra", LayerContent::Smart(SmartObject::new(
        SmartSource::Embedded { file_name:"source.psd".into(), bytes }, Default::default(), None)));
    shared.engine.edit("Add", |doc, _| { doc.layers.push(make(source.clone())); Ok(()) }).unwrap();
    shared.engine.edit("Rename", |doc, _| { doc.name = "next".into(); Ok(()) }).unwrap();
    let shared_cost = estimate(&shared, TEST_LIMIT);
    let old = shared.engine.active().unwrap().history.state(1).unwrap();
    let current = shared.engine.active().unwrap().doc.clone();
    assert_eq!(old.id, current.id);
    assert!(!Arc::ptr_eq(&old, &current));
    if let LayerContent::Smart(smart) = &mut Arc::make_mut(&mut shared.engine.active_mut().unwrap().doc).layers.last_mut().unwrap().content {
        smart.source = SmartSource::Embedded { file_name:"source.psd".into(), bytes:Arc::new(vec![7; 1024 * 1024]) };
    }
    assert!(estimate(&shared, TEST_LIMIT) >= shared_cost + 1024 * 1024);
}

#[test]
fn estimation_preserves_history_redo_journal_targets_and_arc_ownership() {
    let mut value = session();
    value.engine.edit("Extra", |doc, _| { add_extra(doc, 0); add_extra(doc, 5); Ok(()) }).unwrap();
    value.engine.edit("Name", |doc, _| { doc.name = "redo name".into(); Ok(()) }).unwrap();
    value.engine.undo();
    let state = value.engine.active_mut().unwrap();
    state.channel_view.target = ChannelTarget::Color(1);
    state.coalesce = Some("gesture".into());
    let current = state.doc.clone();
    let past: Vec<_> = (0..state.history.past_len()).map(|index| state.history.state(index).unwrap()).collect();
    let counts: Vec<_> = past.iter().map(Arc::strong_count).collect();
    let current_count = Arc::strong_count(&current);
    let labels = state.history.entries();
    let redo = state.history.redo_labels().map(str::to_owned).collect::<Vec<_>>();
    let selected = state.selected_layers.clone();
    let active = state.active_layer;
    let target = state.channel_view.clone();
    let revision = state.revision;
    let journal = value.engine.journal.clone();
    for limit in [1, 128 * 1024, TEST_LIMIT] { assert!(estimate(&value, limit) >= legacy_estimate(&value).0); }
    let state = value.engine.active().unwrap();
    assert!(Arc::ptr_eq(&current, &state.doc));
    assert_eq!(Arc::strong_count(&current), current_count);
    assert_eq!(past.iter().map(Arc::strong_count).collect::<Vec<_>>(), counts);
    assert_eq!(state.history.entries(), labels);
    assert_eq!(state.history.redo_labels().collect::<Vec<_>>(), redo.iter().map(String::as_str).collect::<Vec<_>>());
    assert_eq!(state.selected_layers, selected); assert_eq!(state.active_layer, active);
    assert_eq!(state.channel_view, target); assert_eq!(state.revision, revision);
    assert_eq!(state.coalesce.as_deref(), Some("gesture"));
    assert_eq!(value.engine.journal, journal); assert_eq!(value.version, "pinned");
}

#[test]
fn refresh_evicts_only_measured_over_budget_peer_and_preserves_normal_redo_sessions() {
    let a = session(); let mut b = session();
    b.engine.edit("Rename", |doc, _| { doc.name = "next".into(); Ok(()) }).unwrap();
    b.engine.undo();
    assert!(b.engine.active().unwrap().history.can_redo());
    let budget = estimate(&a, TEST_LIMIT) + estimate(&b, TEST_LIMIT) + 128 * 1024;
    let mut cache = PhotoCache { max_bytes:budget, ..Default::default() };
    cache.insert("a".into(), a); cache.insert("b".into(), b);
    assert_eq!(cache.entries.len(), 2);
    cache.get_mut("b").unwrap().engine.edit("Opaque payload", |doc, _| { add_extra(doc, 6); Ok(()) }).unwrap();
    cache.refresh("b");
    assert!(!cache.contains_key("a")); assert!(cache.contains_key("b"));
    assert_eq!(cache.get("b").unwrap().version, "pinned");
    cache.max_bytes = 1; cache.refresh("b");
    assert_eq!(cache.entries.len(), 1); assert!(cache.contains_key("b"));
}

#[test]
fn borrowed_root_admission_is_bounded_without_history_clones() {
    let mut value = session();
    let doc = value.engine.active().unwrap().doc.clone();
    let state = value.engine.active_mut().unwrap();
    state.history.max_states = MAX_MEASURED_ROOTS + 1;
    for _ in 0..MAX_MEASURED_ROOTS { state.history.record("shared", doc.clone(), Default::default()); }
    let before = Arc::strong_count(&doc);
    assert_eq!(estimate_with(&value, TEST_LIMIT, || panic!("over-count history must not enter native or legacy traversal")), TEST_LIMIT + 1);
    assert_eq!(estimate(&value, TEST_LIMIT), TEST_LIMIT + 1);
    assert_eq!(Arc::strong_count(&doc), before);
    assert!(value.engine.undo());
    assert_eq!(value.engine.active().unwrap().history.past_len(), MAX_MEASURED_ROOTS - 1);
    assert_eq!(value.engine.active().unwrap().history.redo_labels().count(), 1);
    assert_eq!(estimate_with(&value, TEST_LIMIT, || panic!("redo roots must join the preflight before native traversal")), TEST_LIMIT + 1);
}
