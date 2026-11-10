use super::*;
use std::{cell::Cell, path::PathBuf};

struct Temp(PathBuf);
impl Drop for Temp {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}
fn temp() -> Temp {
    let path = std::env::temp_dir().join(format!("xdesign-history-admission-{}", ulid::Ulid::new()));
    std::fs::create_dir_all(&path).unwrap();
    Temp(path)
}
fn fixture(past: usize, redo: usize) -> Session {
    let mut engine = Session::new();
    engine.execute("file.new", json!({"width":2,"height":2,"background":"#905080"})).unwrap();
    let state = engine.active_mut().unwrap();
    state.history.max_states = MAX_STATES;
    for _ in 0..past + redo {
        state.history.record("Shared snapshot", state.doc.clone(), Default::default());
    }
    for _ in 0..redo { state.doc = state.history.undo(state.doc.clone()).unwrap().0; }
    state.coalesce = Some("unchanged gesture".into());
    state.layer_anchor = state.active_layer;
    state.revision = 71;
    state.saved_revision = 23;
    engine
}
fn binding(doc: &Arc<Document>) -> Option<(String, HashMap<PathBuf, String>)> {
    identities().lock().unwrap().get(&(Arc::as_ptr(doc) as usize))
        .filter(|entry| entry.doc.upgrade().is_some_and(|old| Arc::ptr_eq(&old, doc)))
        .map(|entry| (entry.id.clone(), entry.versions.clone()))
}
fn history_targets(state: &DocState) -> Vec<(usize, Option<LayerId>, Vec<LayerId>)> {
    let mut result = Vec::new();
    let mut probe = state.history.clone();
    probe.max_states = probe.max_states.max(1);
    probe.record("target probe", state.doc.clone(), Default::default());
    let (current, layers) = probe.undo(state.doc.clone()).unwrap();
    result.push((Arc::as_ptr(&current) as usize, layers.active, layers.selected));
    drop(probe);
    let mut history = state.history.clone();
    let mut doc = state.doc.clone();
    while let Some((previous, layers)) = history.undo(doc) {
        result.push((Arc::as_ptr(&previous) as usize, layers.active, layers.selected));
        doc = previous;
    }
    let mut history = state.history.clone();
    let mut doc = state.doc.clone();
    while let Some((next, layers)) = history.redo(doc) {
        result.push((Arc::as_ptr(&next) as usize, layers.active, layers.selected));
        doc = next;
    }
    result
}
fn directory_names(dir: &Path) -> Vec<std::ffi::OsString> {
    let mut names: Vec<_> = std::fs::read_dir(dir).unwrap().map(|entry| entry.unwrap().file_name()).collect();
    names.sort();
    names
}
fn assert_early_refusal(engine: &Session, prebound: bool) {
    let dir = temp();
    std::fs::write(dir.0.join("keep.bin"), b"existing bytes").unwrap();
    let state = engine.active().unwrap();
    if prebound { bind(&state.doc, ulid::Ulid::new().to_string(), &dir.0, ulid::Ulid::new().to_string()); }
    let identity = binding(&state.doc);
    let doc = state.doc.clone();
    let strong = Arc::strong_count(&doc);
    let labels = state.history.entries();
    let redo = state.history.redo_labels().map(str::to_owned).collect::<Vec<_>>();
    let targets = history_targets(state);
    let selected = state.selected_layers.clone();
    let active = state.active_layer;
    let anchor = state.layer_anchor;
    let channel_view = serde_json::to_value(&state.channel_view).unwrap();
    let revision = state.revision;
    let saved_revision = state.saved_revision;
    let damage = state.last_damage;
    let coalesce = state.coalesce.clone();
    let limits = (state.history.max_states, state.history.max_bytes);
    let journal = engine.journal.clone();
    let files = directory_names(&dir.0);
    let mut view = json!({"existingView":{"untouched":true}});
    view[KEY] = json!({"previousHistory":"untouched"});
    let previous_view = view.clone();
    let entered = Cell::new(false);
    assert!(with_admitted_history(state, || { entered.set(true); Ok(()) }).is_err());
    assert!(!entered.get(), "cloning/binding/writing continuation must remain unentered");
    assert!(save(&dir.0, &ulid::Ulid::new().to_string(), state, &mut view).is_err());
    assert_eq!(view, previous_view);
    assert_eq!(binding(&state.doc), identity);
    assert_eq!(directory_names(&dir.0), files);
    assert_eq!(std::fs::read(dir.0.join("keep.bin")).unwrap(), b"existing bytes");
    assert!(Arc::ptr_eq(&state.doc, &doc));
    assert_eq!(Arc::strong_count(&doc), strong);
    assert_eq!(state.history.entries(), labels);
    assert_eq!(state.history.redo_labels().collect::<Vec<_>>(), redo.iter().map(String::as_str).collect::<Vec<_>>());
    assert_eq!(history_targets(state), targets);
    assert_eq!(state.selected_layers, selected);
    assert_eq!(state.active_layer, active);
    assert_eq!(state.layer_anchor, anchor);
    assert_eq!(serde_json::to_value(&state.channel_view).unwrap(), channel_view);
    assert_eq!(state.revision, revision);
    assert_eq!(state.saved_revision, saved_revision);
    assert_eq!(state.last_damage, damage);
    assert_eq!(state.coalesce, coalesce);
    assert_eq!((state.history.max_states, state.history.max_bytes), limits);
    assert_eq!(engine.journal, journal);
}

#[test]
fn current_past_and_redo_share_the_4096_state_limit_with_bounded_iteration() {
    for (past, redo, admitted) in [
        (4095, 0, true), (0, 4095, true), (2047, 2048, true),
        (4096, 0, false), (2047, 2049, false), (0, 4096, false), (usize::MAX, 0, false),
    ] {
        assert_eq!(admit_history(past, MAX_STATES, None, std::iter::repeat("redo").take(redo)).is_ok(), admitted, "past={past} redo={redo}");
    }
    for (past, expected_visits) in [(0, 4096), (2047, 2049), (4095, 1), (4096, 0), (usize::MAX, 0)] {
        let visited = Cell::new(0);
        let unbounded = std::iter::repeat("redo").inspect(|_| visited.set(visited.get() + 1));
        assert!(admit_history(past, MAX_STATES, None, unbounded).is_err());
        assert_eq!(visited.get(), expected_visits, "past={past}");
    }
}

#[test]
fn excess_past_mixed_redo_and_all_redo_refuse_before_any_save_side_effect() {
    for (past, redo, prebound) in [(4096, 0, false), (2048, 2048, true), (0, 4096, false)] {
        let engine = fixture(past, redo);
        assert_eq!(engine.active().unwrap().history.past_len(), past);
        assert_eq!(engine.active().unwrap().history.redo_labels().count(), redo);
        assert_early_refusal(&engine, prebound);
    }
}

#[test]
fn existing_history_limit_and_coalesce_constraints_refuse_before_iteration_or_binding() {
    for (max_states, coalesce) in [(0, None), (4097, None), (4096, Some("x".repeat(4097))), (4096, Some("é".repeat(2049)))] {
        let visited = Cell::new(false);
        let redo = std::iter::repeat("redo").inspect(|_| visited.set(true));
        assert!(admit_history(0, max_states, coalesce.as_deref(), redo).is_err());
        assert!(!visited.get());
        let mut engine = fixture(2, 1);
        let state = engine.active_mut().unwrap();
        state.history.max_states = max_states;
        state.coalesce = coalesce;
        assert_early_refusal(&engine, true);
    }
    assert!(admit_history(0, 1, Some(&"x".repeat(4096)), std::iter::empty()).is_ok());
    assert!(admit_history(0, 4096, Some(&"é".repeat(2048)), std::iter::empty()).is_ok());
}

#[test]
fn admitted_boundary_passes_the_existing_serialized_history_format_gate() {
    let engine = fixture(2047, 2048);
    let state = engine.active().unwrap();
    let entered = Cell::new(false);
    with_admitted_history(state, || {
        entered.set(true);
        let states: Vec<_> = (0..MAX_STATES).map(|index| Snapshot {
            id: ulid::Ulid::from(index as u128 + 1).to_string(),
            version: ulid::Ulid::from(index as u128 + 10_000).to_string(),
            label: format!("State {index}"), active: state.active_layer.map(|id| id.0),
            selected: state.selected_layers.iter().map(|id| id.0).collect(),
        }).collect();
        let version = states[2047].version.clone();
        let saved = Saved { schema_version:1, document_id:state.doc.id.0, current:2047, states, max_states:MAX_STATES, max_bytes:0, coalesce:Some("x".repeat(4096)) };
        let mut view = json!({});
        view[KEY] = serde_json::to_value(saved).unwrap();
        let admitted = parsed(&view, &version)?.unwrap();
        assert_eq!(admitted.states.len(), 4096);
        assert_eq!(admitted.current, 2047);
        assert_eq!(admitted.coalesce.as_ref().unwrap().len(), 4096);
        assert!(serde_json::to_vec(&view).unwrap().len() < MAX_VIEW as usize);
        Ok(())
    }).unwrap();
    assert!(entered.get());
}

#[test]
fn normal_save_keeps_exact_wire_bytes_and_reopens_real_bundles_with_redo() {
    let dir = temp();
    let mut engine = fixture(0, 0);
    engine.active_mut().unwrap().history.max_bytes = 8 * 1024 * 1024;
    engine.edit("Second", |doc, _| { doc.name = "second".into(); Ok(()) }).unwrap();
    engine.edit("Third", |doc, _| { doc.name = "third".into(); Ok(()) }).unwrap();
    let last = engine.active().unwrap().doc.clone();
    assert!(engine.undo());
    let state = engine.active().unwrap();
    let docs = [state.history.state(0).unwrap(), state.doc.clone(), last];
    let versions: Vec<_> = (100u128..103).map(|index| ulid::Ulid::from(index).to_string()).collect();
    let ids: Vec<_> = (200u128..203).map(|index| ulid::Ulid::from(index).to_string()).collect();
    let mut writer = super::super::super::bundle::IncrementalWriter::default();
    for (index, doc) in docs.iter().enumerate() {
        super::super::super::bundle::write_document(&dir.0, &versions[index], doc, &mut writer).unwrap();
        bind(doc, ids[index].clone(), &dir.0, versions[index].clone());
    }
    let files = directory_names(&dir.0);
    let mut view = json!({"existingView":"preserved"});
    save(&dir.0, &versions[1], state, &mut view).unwrap();
    let active = state.active_layer.map(|id| id.0);
    let selected = state.selected_layers.iter().map(|id| id.0).collect::<Vec<_>>();
    let mut expected = json!({"existingView":"preserved"});
    expected[KEY] = json!({
        "schemaVersion":1,"documentId":state.doc.id.0,"current":1,
        "states":[
            {"id":ids[0],"version":versions[0],"label":"Open","active":active,"selected":selected},
            {"id":ids[1],"version":versions[1],"label":"Second","active":active,"selected":selected},
            {"id":ids[2],"version":versions[2],"label":"Third","active":active,"selected":selected}
        ],
        "maxStates":MAX_STATES,"maxBytes":8388608,"coalesce":null
    });
    assert_eq!(serde_json::to_vec(&view).unwrap(), serde_json::to_vec(&expected).unwrap());
    assert_eq!(directory_names(&dir.0), files);
    let mut reopened = DocState::new((*state.doc).clone(), None);
    restore(&dir.0, &versions[1], &mut reopened, &view).unwrap();
    assert_eq!(reopened.history.entries(), ["Open", "Second"]);
    assert_eq!(reopened.history.redo_labels().collect::<Vec<_>>(), ["Third"]);
    assert_eq!(reopened.doc.name, "second");
    let (next, layers) = reopened.history.redo(reopened.doc.clone()).unwrap();
    assert_eq!(next.name, "third");
    assert_eq!(layers.active, state.active_layer);
    assert_eq!(layers.selected, state.selected_layers);
}

fn saved_cursor(undo: usize) -> (Temp, Session, Value, String) {
    let dir = temp();
    let mut engine = fixture(0, 0);
    let first = engine.active().unwrap().active_layer.unwrap();
    engine.execute("layer.new.layer", json!({"name":"Second saved layer"})).unwrap();
    let second = engine.active().unwrap().active_layer.unwrap();
    engine.active_mut().unwrap().history.clear();
    engine.active_mut().unwrap().history.set_current_label("Saved open");
    engine.select_layer(first).unwrap();
    engine.edit("Saved first rename", |doc, _| { doc.name = "saved second state".into(); Ok(()) }).unwrap();
    engine.select_layer(second).unwrap();
    engine.edit("Saved second rename", |doc, _| { doc.name = "saved third state".into(); Ok(()) }).unwrap();
    for _ in 0..undo { assert!(engine.undo()); }
    let creation_target = [second, first, second][2 - undo];
    engine.select_layer(if creation_target == first { second } else { first }).unwrap();
    let state = engine.active_mut().unwrap();
    state.history.max_states = 17;
    state.history.max_bytes = 4 * 1024 * 1024;
    state.coalesce = Some("saved coalescing key".into());
    let version = ulid::Ulid::new().to_string();
    let mut writer = super::super::super::bundle::IncrementalWriter::default();
    super::super::super::bundle::write_document(&dir.0, &version, &state.doc, &mut writer).unwrap();
    let mut view = json!({"unchangedView":"saved"});
    save(&dir.0, &version, state, &mut view).unwrap();
    let saved = parsed(&view, &version).unwrap().unwrap();
    assert_eq!(saved.states.len(), 3);
    assert_eq!(saved.current, 2 - undo);
    assert_eq!(saved.states.iter().map(|row| row.active).collect::<Vec<_>>(), [Some(second.0), Some(first.0), Some(second.0)]);
    assert_eq!(saved.states[saved.current].active, Some(creation_target.0));
    assert_ne!(state.active_layer, Some(creation_target));
    (dir, engine, view, version)
}

fn large_resident(current: &Arc<Document>) -> Session {
    let mut engine = Session::new();
    engine.add_document((**current).clone(), None);
    let state = engine.active_mut().unwrap();
    let mut probe = state.history.clone();
    probe.record("target probe", state.doc.clone(), Default::default());
    let (_, mut target) = probe.undo(state.doc.clone()).unwrap();
    let first = state.doc.layers[0].id;
    target.active = Some(first);
    target.selected = vec![first; 32];
    state.history.max_states = 1024;
    let label = "resident metadata ".repeat(32);
    for _ in 0..512 { state.history.record(label.clone(), state.doc.clone(), target.clone()); }
    for _ in 0..128 { state.doc = state.history.undo(state.doc.clone()).unwrap().0; }
    state.history.max_bytes = 123_456;
    state.history.set_current_label("resident current label");
    state.coalesce = Some("resident coalescing key".into());
    state.active_layer = Some(first);
    state.selected_layers = vec![first];
    state.layer_anchor = Some(first);
    state.revision = 818;
    state.saved_revision = 715;
    engine.journal.push(("resident.context".into(), json!({"unchanged":true})));
    engine
}

fn resident_mark(engine: &Session) -> Value {
    let state = engine.active().unwrap();
    json!({
        "doc":Arc::as_ptr(&state.doc) as usize,"strong":Arc::strong_count(&state.doc),
        "past":state.history.past_len(),"labels":state.history.entries(),
        "redo":state.history.redo_labels().collect::<Vec<_>>(),"targets":history_targets(state),
        "maxStates":state.history.max_states,"maxBytes":state.history.max_bytes,
        "active":state.active_layer,"selected":state.selected_layers,"anchor":state.layer_anchor,
        "revision":state.revision,"savedRevision":state.saved_revision,"damage":state.last_damage,
        "view":state.channel_view,"coalesce":state.coalesce,"journal":engine.journal,
        "identity":binding(&state.doc)
    })
}

#[test]
fn fresh_restore_replaces_large_resident_history_at_each_cursor_without_using_current_selection() {
    for undo in 0..=2 {
        let (dir, expected, view, version) = saved_cursor(undo);
        let source = expected.active().unwrap();
        let mut actual = large_resident(&source.doc);
        let before = resident_mark(&actual);
        let journal = actual.journal.clone();
        restore(&dir.0, &version, actual.active_mut().unwrap(), &view).unwrap();
        let state = actual.active().unwrap();
        assert_eq!(state.doc.as_ref(), source.doc.as_ref());
        assert_eq!(state.history.entries(), source.history.entries());
        assert_eq!(state.history.redo_labels().collect::<Vec<_>>(), source.history.redo_labels().collect::<Vec<_>>());
        let targets = |state: &DocState| history_targets(state).into_iter().map(|(_, active, selected)| (active, selected)).collect::<Vec<_>>();
        assert_eq!(targets(state), targets(source));
        assert_eq!(state.history.past_len(), 2 - undo);
        assert_eq!(state.history.redo_labels().count(), undo);
        assert_eq!(state.history.max_states, 17);
        assert_eq!(state.history.max_bytes, 4 * 1024 * 1024);
        assert_eq!(state.coalesce.as_deref(), Some("saved coalescing key"));
        assert_eq!(serde_json::to_value(state.active_layer).unwrap(), before["active"]);
        assert_eq!(serde_json::to_value(&state.selected_layers).unwrap(), before["selected"]);
        assert_eq!(serde_json::to_value(state.layer_anchor).unwrap(), before["anchor"]);
        assert_eq!(state.revision, 818);
        assert_eq!(state.saved_revision, 715);
        assert_eq!(actual.journal, journal);
    }
}

#[test]
fn failed_restore_keeps_large_resident_history_for_late_bundle_and_creation_target_errors() {
    let (dir, expected, view, version) = saved_cursor(2);
    let mut actual = large_resident(&expected.active().unwrap().doc);
    bind(&actual.active().unwrap().doc, ulid::Ulid::new().to_string(), &dir.0, "resident binding".into());
    let before = resident_mark(&actual);
    let files = directory_names(&dir.0);
    let mut bad_target = view.clone();
    bad_target[KEY]["states"][2]["active"] = json!(u64::MAX);
    assert!(restore(&dir.0, &version, actual.active_mut().unwrap(), &bad_target).is_err());
    assert_eq!(resident_mark(&actual), before);
    assert_eq!(directory_names(&dir.0), files);
    let saved = parsed(&view, &version).unwrap().unwrap();
    let manifest = dir.0.join(format!("{}.pcraft", saved.states[2].version)).join("manifest.json");
    let bytes = std::fs::read(&manifest).unwrap();
    std::fs::write(&manifest, b"invalid late saved bundle").unwrap();
    assert!(restore(&dir.0, &version, actual.active_mut().unwrap(), &view).is_err());
    assert_eq!(resident_mark(&actual), before);
    assert_eq!(directory_names(&dir.0), files);
    assert_eq!(std::fs::read(&manifest).unwrap(), b"invalid late saved bundle");
    std::fs::write(&manifest, bytes).unwrap();
}
