use photocraft_engine::DocState;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum HistoryPolicy {
    Keep,
    Discard,
}

pub(super) fn capture(state: &DocState, policy: HistoryPolicy) -> DocState {
    DocState {
        doc: state.doc.clone(),
        history: match policy {
            HistoryPolicy::Keep => state.history.clone(),
            HistoryPolicy::Discard => Default::default(),
        },
        active_layer: state.active_layer,
        selected_layers: state.selected_layers.clone(),
        layer_anchor: state.layer_anchor,
        path: state.path.clone(),
        revision: state.revision,
        saved_revision: state.saved_revision,
        last_damage: state.last_damage.clone(),
        coalesce: state.coalesce.clone(),
        channel_view: state.channel_view.clone(),
        isolated_layers: state.isolated_layers.clone(),
        symmetry_path: state.symmetry_path.clone(),
        fx_collapsed: state.fx_collapsed.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::Session;
    use serde_json::json;
    use std::sync::Arc;

    fn source_with_history() -> Session {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":32,"height":24,"background":"#805040"}),
            )
            .unwrap();
        engine
            .execute(
                "paint.stroke",
                json!({"points":[[4,7],[19,12]],"size":7,"color":"#20b0c0","seed":21}),
            )
            .unwrap();
        engine
            .execute(
                "paint.stroke",
                json!({"points":[[4,12],[19,7]],"size":7,"color":"#f05010","seed":22}),
            )
            .unwrap();
        engine
            .execute("select.rect", json!({"x":3,"y":4,"width":20,"height":15}))
            .unwrap();
        engine
    }

    fn history_source(
        engine: &Session,
    ) -> (serde_json::Value, Arc<photocraft_engine::doc::Document>) {
        let source_id = super::super::history::describe(engine)[1]["id"].clone();
        let params = json!({"historySource":source_id});
        let doc = super::super::history::resolve(engine, &params).unwrap().doc;
        (params, doc)
    }

    fn assert_non_history_state_copy(source: &DocState, copied: &DocState) {
        assert!(Arc::ptr_eq(&source.doc, &copied.doc));
        assert_eq!(source.active_layer, copied.active_layer);
        assert_eq!(source.selected_layers, copied.selected_layers);
        assert_eq!(source.layer_anchor, copied.layer_anchor);
        assert_eq!(source.path, copied.path);
        assert_eq!(source.revision, copied.revision);
        assert_eq!(source.saved_revision, copied.saved_revision);
        assert_eq!(source.last_damage, copied.last_damage);
        assert_eq!(source.coalesce, copied.coalesce);
        assert_eq!(
            format!("{:?}", source.channel_view),
            format!("{:?}", copied.channel_view)
        );
        assert_eq!(source.isolated_layers, copied.isolated_layers);
        assert_eq!(
            format!("{:?}", source.symmetry_path),
            format!("{:?}", copied.symmetry_path)
        );
        assert_eq!(source.fx_collapsed, copied.fx_collapsed);
    }

    #[test]
    fn discard_copies_every_non_history_field_and_releases_retained_snapshot_documents() {
        let mut engine = source_with_history();
        let source = engine.active_mut().unwrap();
        let layer = source.active_layer.unwrap();
        source.path = Some("snapshot/source.pcraft".into());
        source.layer_anchor = None;
        source.revision = 42;
        source.saved_revision = 19;
        source.last_damage = Some(photocraft_engine::doc::Rect::new(3, 4, 20, 15));
        source.coalesce = Some("snapshot-coalesce".into());
        source.isolated_layers = vec![layer];
        source.fx_collapsed = vec![layer];
        source.channel_view.set_color_visible(1, false);
        source.symmetry_path = Some(photocraft_engine::symmetry_cmds::SymmetryAxis {
            source: "Snapshot axis".into(),
            segments: vec![[[1.0, 2.0], [9.0, 14.0]]],
        });
        let (history_params, historical_doc) = history_source(&engine);
        let historical = Arc::downgrade(&historical_doc);
        let old_tile = historical_doc.layers[0]
            .surface()
            .unwrap()
            .tiles()
            .next()
            .map(|(_, tile)| Arc::downgrade(tile))
            .unwrap();
        drop(historical_doc);
        let source = engine.active().unwrap();
        let copied = capture(source, HistoryPolicy::Discard);
        assert_non_history_state_copy(source, &copied);
        assert!(copied.history.past_len() == 0);
        assert!(
            super::super::history::resolve(&engine, &history_params).is_ok(),
            "source history remains intact"
        );
        drop(engine);
        assert!(
            historical.upgrade().is_none(),
            "history-only document is no longer retained by the preview copy"
        );
        assert!(
            old_tile.upgrade().is_none(),
            "history-only raster tile is released"
        );
        assert_eq!(copied.history.past_len(), 0);
    }

    #[test]
    fn keep_preserves_history_brush_sources_until_the_copy_is_dropped() {
        let engine = source_with_history();
        let (history_params, historical_doc) = history_source(&engine);
        let historical = Arc::downgrade(&historical_doc);
        let old_tile = historical_doc.layers[0]
            .surface()
            .unwrap()
            .tiles()
            .next()
            .map(|(_, tile)| Arc::downgrade(tile))
            .unwrap();
        drop(historical_doc);
        let source = engine.active().unwrap();
        let copied = capture(source, HistoryPolicy::Keep);
        assert_non_history_state_copy(source, &copied);
        assert_eq!(copied.history.past_len(), source.history.past_len());

        let mut preview = Session::new();
        preview.add_document((*copied.doc).clone(), None);
        *preview.active_mut().unwrap() = copied.clone();
        assert!(Arc::ptr_eq(
            &super::super::history::resolve(&engine, &history_params)
                .unwrap()
                .doc,
            &super::super::history::resolve(&preview, &history_params)
                .unwrap()
                .doc,
        ));
        drop(engine);
        assert!(
            historical.upgrade().is_some(),
            "History Brush source stays available while retained history is copied"
        );
        assert!(old_tile.upgrade().is_some());
        drop(preview);
        drop(copied);
        assert!(
            historical.upgrade().is_none(),
            "history source is released with the retained-history copy"
        );
        assert!(old_tile.upgrade().is_none());
    }
}
