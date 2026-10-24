use super::completed_cache::{Cache, Request};
use super::tests::{ordinary_filter_fixture, reference_region_pixels};
use super::*;
use base64::Engine;
use serde_json::{json, Value};
use std::sync::Mutex;

fn cached(
    state: &DocState,
    color: &super::color_views::Snapshot,
    command: &str,
    params: Value,
    owner: &str,
    version: &str,
    cache: &Mutex<Cache>,
    regions: Option<&[PreviewRegion]>,
) -> Result<PreviewWithRegions, String> {
    super::render_using_cache(
        state,
        Some(color),
        command,
        params,
        None,
        regions,
        Some(Request {
            owner,
            version,
            cache,
            control: None,
        }),
    )
}

fn oracle(
    state: &DocState,
    color: &super::color_views::Snapshot,
    command: &str,
    params: Value,
) -> (PhotoViewPreview, Session) {
    let mut engine = Session::new();
    engine.add_document((*state.doc).clone(), None);
    *engine.active_mut().unwrap() = state.clone();
    color.install(&mut engine).unwrap();
    super::execute_view_command(&mut engine, command, params).unwrap();
    let active = engine.active().unwrap();
    let display = super::display::View::new(&engine.color, &active.doc).unwrap();
    let preview =
        super::render_color_view_preview(&active.doc, &active.channel_view, Some(&display))
            .unwrap();
    (preview, engine)
}

fn decode_png(encoded: &str) -> Vec<u8> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .unwrap();
    photocraft_codecs::decode(&bytes)
        .unwrap()
        .as_u8()
        .unwrap()
        .to_vec()
}

fn detail_cases() -> [(&'static str, Value); 5] {
    [
        (
            "filter.blurGallery.fieldBlur",
            json!({"pins":[{"x":0.1,"y":0.2,"blur":3},{"x":0.8,"y":0.7,"blur":15}]}),
        ),
        (
            "filter.blurGallery.irisBlur",
            json!({"pins":[{"x":0.2,"y":0.3,"radiusX":0.2,"radiusY":0.3,"blur":8},{"x":0.8,"y":0.7,"radiusX":0.15,"radiusY":0.2,"blur":15}]}),
        ),
        (
            "filter.blurGallery.spinBlur",
            json!({"pins":[{"x":0.3,"y":0.4,"radiusX":0.3,"radiusY":0.4,"blurAngle":45},{"x":0.7,"y":0.6,"radiusX":0.2,"radiusY":0.3,"blurAngle":20}]}),
        ),
        (
            "filter.blurGallery.pathBlur",
            json!({"paths":[{"points":[[0.1,0.3],[0.5,0.7],[0.9,0.3]],"speed":20,"taper":15},{"points":[[0.3,0.1],[0.7,0.9]],"speed":10,"taper":0}]}),
        ),
        (
            "filter.blurGallery.tiltShift",
            json!({"blur":12,"centerX":0.4,"centerY":0.55,"angle":23,"focus":0.2,"transition":0.25}),
        ),
    ]
}

#[test]
fn completed_gallery_cache_reuses_native_result_for_fit_pan_and_scaled_detail_at_all_depths() {
    let regions = [
        PreviewRegion {
            x: 3,
            y: 2,
            width: 16,
            height: 12,
            scale: 1,
        },
        PreviewRegion {
            x: 11,
            y: 7,
            width: 17,
            height: 13,
            scale: 2,
        },
        PreviewRegion {
            x: 25,
            y: 19,
            width: 7,
            height: 5,
            scale: 2,
        },
    ];
    for depth in [8, 16, 32] {
        for (command, params) in detail_cases() {
            let mut source = ordinary_filter_fixture(depth);
            if depth == 16 {
                super::execute_view_command(&mut source,"view.proofSetup",json!({"profile":"coated-cmyk","intent":"absolute","simulatePaper":true,"on":true})).unwrap();
            }
            if depth == 32 {
                super::execute_view_command(
                    &mut source,
                    "view.thirtyTwoBitPreviewOptions",
                    json!({"exposure":1.25,"gamma":0.9}),
                )
                .unwrap();
            }
            let state = source.active().unwrap();
            let source_doc = state.doc.clone();
            let source_history = state.history.entries().to_vec();
            let source_state = state.clone();
            let color = super::color_views::Snapshot::capture(&source).unwrap();
            let cache = Mutex::new(Cache::default());
            let (expected_base, expected_engine) = oracle(state, &color, command, params.clone());

            let fit = cached(
                state,
                &color,
                command,
                params.clone(),
                "photo-cache-parity",
                "version-1",
                &cache,
                None,
            )
            .unwrap();
            assert_eq!(
                fit.preview.png, expected_base.png,
                "cold base {depth} {command}"
            );
            let after_cold = {
                let cache = cache.lock().unwrap();
                (
                    cache.hits,
                    cache.misses,
                    cache.executions,
                    cache.base_encodes,
                )
            };
            assert_eq!(after_cold, (0, 1, 1, 1), "cold counters {depth} {command}");

            let panned = cached(
                state,
                &color,
                command,
                params.clone(),
                "photo-cache-parity",
                "version-1",
                &cache,
                Some(&regions),
            )
            .unwrap();
            assert_eq!(
                panned.preview.png, fit.preview.png,
                "base retained for detail {depth} {command}"
            );
            assert_eq!(panned.tiles.as_ref().unwrap().len(), regions.len());
            assert_eq!(panned.original_tiles.as_ref().unwrap().len(), regions.len());
            let original_color = color.render(&source_doc).unwrap();
            let expected = expected_engine.active().unwrap();
            let filtered_color =
                super::display::View::new(&expected_engine.color, &expected.doc).unwrap();
            for (index, region) in regions.iter().copied().enumerate() {
                assert_eq!(
                    decode_png(&panned.original_tiles.as_ref().unwrap()[index].png),
                    reference_region_pixels(
                        &source_doc,
                        &source_state.channel_view,
                        &original_color,
                        region
                    ),
                    "original {depth} {command} {index}"
                );
                assert_eq!(
                    decode_png(&panned.tiles.as_ref().unwrap()[index].png),
                    reference_region_pixels(
                        &expected.doc,
                        &expected.channel_view,
                        &filtered_color,
                        region
                    ),
                    "filtered {depth} {command} {index}"
                );
            }
            let after_detail = {
                let cache = cache.lock().unwrap();
                (
                    cache.hits,
                    cache.misses,
                    cache.executions,
                    cache.base_encodes,
                )
            };
            assert_eq!(
                after_detail,
                (1, 1, 1, 1),
                "detail hit must skip execute and base encode {depth} {command}"
            );

            let repeated_fit = cached(
                state,
                &color,
                command,
                params,
                "photo-cache-parity",
                "version-1",
                &cache,
                None,
            )
            .unwrap();
            assert_eq!(repeated_fit.preview.png, fit.preview.png);
            let final_counts = {
                let cache = cache.lock().unwrap();
                (
                    cache.hits,
                    cache.misses,
                    cache.executions,
                    cache.base_encodes,
                )
            };
            assert_eq!(
                final_counts,
                (2, 1, 1, 1),
                "fit hit must skip execute and base encode {depth} {command}"
            );
            assert!(std::sync::Arc::ptr_eq(
                &source_doc,
                &source.active().unwrap().doc
            ));
            assert_eq!(source_history, source.active().unwrap().history.entries());
        }
    }
}

#[test]
fn completed_gallery_cache_keys_every_preview_owner_and_render_input() {
    let source = ordinary_filter_fixture(16);
    let state = source.active().unwrap();
    let command = "filter.blurGallery.tiltShift";
    let params =
        json!({"blur":12,"centerX":0.4,"centerY":0.55,"angle":23,"focus":0.2,"transition":0.25});
    let color = super::color_views::Snapshot::capture(&source).unwrap();
    let cache = Mutex::new(Cache::default());

    let mut changed = state.clone();
    changed.revision += 1;
    let mutations: Vec<(
        &str,
        String,
        String,
        DocState,
        super::color_views::Snapshot,
        Value,
    )> = vec![
        (
            "version",
            "key-owner".into(),
            "key-version-2".into(),
            state.clone(),
            color.clone(),
            params.clone(),
        ),
        (
            "owner",
            "key-owner-2".into(),
            "key-version".into(),
            state.clone(),
            color.clone(),
            params.clone(),
        ),
        (
            "revision",
            "key-owner".into(),
            "key-version".into(),
            changed,
            color.clone(),
            params.clone(),
        ),
        (
            "source Arc",
            "key-owner".into(),
            "key-version".into(),
            {
                let mut s = state.clone();
                s.doc = std::sync::Arc::new((*state.doc).clone());
                s
            },
            color.clone(),
            params.clone(),
        ),
        (
            "selected layers",
            "key-owner".into(),
            "key-version".into(),
            {
                let mut s = state.clone();
                s.selected_layers.clear();
                s
            },
            color.clone(),
            params.clone(),
        ),
        (
            "parameters",
            "key-owner".into(),
            "key-version".into(),
            state.clone(),
            color.clone(),
            json!({"blur":18,"centerX":0.4,"centerY":0.55,"angle":23,"focus":0.2,"transition":0.25}),
        ),
    ];
    for (label, owner, version, mutated_state, mutated_color, mutated_params) in mutations {
        let cache = Mutex::new(Cache::default());
        cached(
            state,
            &color,
            command,
            params.clone(),
            "key-owner",
            "key-version",
            &cache,
            None,
        )
        .unwrap();
        let before = cache.lock().unwrap().misses;
        cached(
            &mutated_state,
            &mutated_color,
            command,
            mutated_params,
            &owner,
            &version,
            &cache,
            None,
        )
        .unwrap();
        assert_eq!(
            cache.lock().unwrap().misses,
            before + 1,
            "{label} must miss"
        );
    }

    cached(
        state,
        &color,
        command,
        params.clone(),
        "key-owner",
        "key-version",
        &cache,
        None,
    )
    .unwrap();
    let before = cache.lock().unwrap().misses;
    cached(
        state,
        &color,
        "filter.blurGallery.fieldBlur",
        json!({"pins":[{"x":0.5,"y":0.5,"blur":12}]}),
        "key-owner",
        "key-version",
        &cache,
        None,
    )
    .unwrap();
    assert_eq!(
        cache.lock().unwrap().misses,
        before + 1,
        "command must miss"
    );

    let mut proof_engine = ordinary_filter_fixture(16);
    proof_engine
        .execute("view.proofSetup", json!({"profile":"display-p3","on":true}))
        .unwrap();
    let changed_color = super::color_views::Snapshot::capture(&proof_engine).unwrap();
    cached(
        state,
        &color,
        command,
        params.clone(),
        "key-owner",
        "key-version",
        &cache,
        None,
    )
    .unwrap();
    let before = cache.lock().unwrap().misses;
    cached(
        state,
        &changed_color,
        command,
        params.clone(),
        "key-owner",
        "key-version",
        &cache,
        None,
    )
    .unwrap();
    assert_eq!(
        cache.lock().unwrap().misses,
        before + 1,
        "color-view settings must miss"
    );

    let mut channel_state = state.clone();
    channel_state.channel_view.set_color_visible(1, false);
    cached(
        state,
        &color,
        command,
        params.clone(),
        "key-owner",
        "key-version",
        &cache,
        None,
    )
    .unwrap();
    let before = cache.lock().unwrap().misses;
    cached(
        &channel_state,
        &color,
        command,
        json!({"blur":12,"centerX":0.4,"centerY":0.55,"angle":23,"focus":0.2,"transition":0.25}),
        "key-owner",
        "key-version",
        &cache,
        None,
    )
    .unwrap();
    assert_eq!(
        cache.lock().unwrap().misses,
        before + 1,
        "channel view must miss"
    );
}

#[test]
fn completed_gallery_cache_keeps_target_selection_and_smart_filter_rendering_context() {
    let region = [PreviewRegion {
        x: 5,
        y: 3,
        width: 19,
        height: 15,
        scale: 2,
    }];
    for depth in [8, 16, 32] {
        for context in [
            "selection",
            "layer-mask",
            "alpha",
            "quick-mask",
            "smart-filter",
        ] {
            for (command, params) in detail_cases() {
                let mut engine = ordinary_filter_fixture(depth);
                let mut input = params.clone();
                match context {
                    "selection" => {
                        engine
                            .execute("select.rect", json!({"x":6,"y":4,"width":20,"height":16}))
                            .unwrap();
                    }
                    "layer-mask" => {
                        engine
                            .execute("layer.layerMask.revealAll", json!({}))
                            .unwrap();
                        engine
                            .execute("view.layerMask", json!({"mode":"gray"}))
                            .unwrap();
                        input["target"] = json!("mask");
                    }
                    "alpha" => {
                        engine
                            .execute("channel.new", json!({"name":"Cache alpha","fill":"white"}))
                            .unwrap();
                        engine
                            .execute("channel.target", json!({"channel":0}))
                            .unwrap();
                        input["target"] = json!({"channel":0});
                    }
                    "quick-mask" => {
                        engine
                            .execute("select.rect", json!({"x":5,"y":5,"width":21,"height":15}))
                            .unwrap();
                        engine
                            .execute("select.editInQuickMaskMode", json!({}))
                            .unwrap();
                        input["target"] = json!("quickMask");
                    }
                    "smart-filter" => {
                        engine
                            .execute("layer.smartObjects.convertToSmartObject", json!({}))
                            .unwrap();
                        engine
                            .execute("select.rect", json!({"x":7,"y":3,"width":19,"height":17}))
                            .unwrap();
                    }
                    _ => unreachable!(),
                }
                let state = engine.active().unwrap().clone();
                let source_doc = state.doc.clone();
                let history = state.history.entries().to_vec();
                let color = super::color_views::Snapshot::capture(&engine).unwrap();
                let (expected_base, expected) = oracle(&state, &color, command, input.clone());
                let cache = Mutex::new(Cache::default());
                let cold = cached(
                    &state,
                    &color,
                    command,
                    input.clone(),
                    "context",
                    "v1",
                    &cache,
                    None,
                )
                .unwrap();
                assert_eq!(
                    cold.preview.png, expected_base.png,
                    "cold {context} {depth}"
                );
                let warm = cached(
                    &state,
                    &color,
                    command,
                    input.clone(),
                    "context",
                    "v1",
                    &cache,
                    Some(&region),
                )
                .unwrap();
                assert_eq!(
                    warm.preview.png, cold.preview.png,
                    "base reuse {context} {depth}"
                );
                let active = expected.active().unwrap();
                let display = super::display::View::new(&expected.color, &active.doc).unwrap();
                let original_display = color.render(&source_doc).unwrap();
                assert_eq!(
                    decode_png(&warm.original_tiles.as_ref().unwrap()[0].png),
                    reference_region_pixels(
                        &source_doc,
                        &state.channel_view,
                        &original_display,
                        region[0]
                    ),
                    "original {context} {depth}"
                );
                assert_eq!(
                    decode_png(&warm.tiles.as_ref().unwrap()[0].png),
                    reference_region_pixels(&active.doc, &active.channel_view, &display, region[0]),
                    "filtered {context} {depth}"
                );
                let counts = cache.lock().unwrap();
                assert_eq!(
                    (
                        counts.hits,
                        counts.misses,
                        counts.executions,
                        counts.base_encodes
                    ),
                    if context == "smart-filter" { (0, 0, 2, 2) } else { (1, 1, 1, 1) },
                    "raster contexts reuse completed output; Smart input regions are refreshed {context} {depth}"
                );
                drop(counts);
                assert!(std::sync::Arc::ptr_eq(
                    &source_doc,
                    &engine.active().unwrap().doc
                ));
                assert_eq!(history, engine.active().unwrap().history.entries());
            }
        }
    }
}

#[test]
fn completed_gallery_cache_validates_before_hit_and_never_caches_failed_native_render() {
    let source = ordinary_filter_fixture(8);
    let state = source.active().unwrap();
    let color = super::color_views::Snapshot::capture(&source).unwrap();
    let command = "filter.blurGallery.fieldBlur";
    let params = json!({"pins":[{"x":0.2,"y":0.3,"blur":12}]});
    let cache = Mutex::new(Cache::default());
    cached(
        state,
        &color,
        command,
        params.clone(),
        "validation",
        "v1",
        &cache,
        None,
    )
    .unwrap();
    let before = {
        let c = cache.lock().unwrap();
        (c.hits, c.misses, c.executions, c.base_encodes)
    };
    let invalid_regions = [PreviewRegion {
        x: 30,
        y: 20,
        width: 8,
        height: 8,
        scale: 1,
    }];
    assert!(cached(
        state,
        &color,
        command,
        params.clone(),
        "validation",
        "v1",
        &cache,
        Some(&invalid_regions)
    )
    .is_err());
    assert!(cached(
        state,
        &color,
        command,
        json!({"oversize":"x".repeat(1024*1024)}),
        "validation",
        "v1",
        &cache,
        None
    )
    .is_err());
    assert_eq!(
        {
            let c = cache.lock().unwrap();
            (c.hits, c.misses, c.executions, c.base_encodes)
        },
        before,
        "invalid requests must be rejected before lookup/encode"
    );
    assert!(super::render_using_cache(
        state,
        Some(&color),
        command,
        params.clone(),
        Some("mask"),
        None,
        Some(Request {
            owner: "validation",
            version: "v1",
            cache: &cache,
            control: None,
        })
    )
    .is_err());
    cached(
        state,
        &color,
        command,
        params.clone(),
        "validation",
        "v1",
        &cache,
        None,
    )
    .unwrap();
    let after_valid_hit = {
        let c = cache.lock().unwrap();
        (c.hits, c.misses)
    };
    assert_eq!(after_valid_hit, (before.0 + 1, before.1));

    let mut missing_active = state.clone();
    missing_active.active_layer = None;
    let missing_active_params = json!({"pins":[{"x":0.5,"y":0.5,"blur":12}]});
    assert!(cached(
        &missing_active,
        &color,
        command,
        missing_active_params.clone(),
        "failed",
        "v1",
        &cache,
        None
    )
    .is_err());
    let after_failure = {
        let c = cache.lock().unwrap();
        (c.hits, c.misses, c.executions, c.base_encodes)
    };
    assert_eq!(after_failure.1, before.1 + 1);
    assert_eq!(after_failure.2, before.2 + 1);
    assert_eq!(after_failure.3, before.3);
    assert!(cached(
        &missing_active,
        &color,
        command,
        missing_active_params,
        "failed",
        "v1",
        &cache,
        None
    )
    .is_err());
    let retried = {
        let c = cache.lock().unwrap();
        (c.hits, c.misses, c.executions, c.base_encodes)
    };
    assert_eq!(retried.0, after_failure.0);
    assert_eq!(
        retried.1,
        after_failure.1 + 1,
        "a failed render must not become a cache hit"
    );
    assert_eq!(retried.2, after_failure.2 + 1);
    assert_eq!(retried.3, after_failure.3);
}

#[test]
fn completed_gallery_cache_keeps_linked_smart_sources_fresh_without_document_edits() {
    use photocraft_engine::doc::{LayerContent, SmartSource};
    let root = std::env::temp_dir().join(format!("xdesign-linked-preview-{}", ulid::Ulid::new()));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("source.png");
    let mut source = ordinary_filter_fixture(16);
    source
        .execute("layer.smartObjects.convertToSmartObject", json!({}))
        .unwrap();
    let layer = source.active().unwrap().active_layer.unwrap();
    source
        .edit("Linked preview source", |doc, _| {
            let LayerContent::Smart(smart) = &mut doc.layer_mut(layer).unwrap().content else {
                panic!("smart source")
            };
            smart.source = SmartSource::Linked {
                path: path.to_string_lossy().into_owned(),
            };
            Ok(())
        })
        .unwrap();
    let state = source.active().unwrap();
    let original = state.doc.clone();
    let history = state.history.entries().to_vec();
    let color = super::color_views::Snapshot::capture(&source).unwrap();
    let cache = Mutex::new(Cache::default());
    for (command, params) in detail_cases() {
        let mut outputs = Vec::new();
        for rgba in [[220, 30, 60, 255], [30, 180, 220, 255]] {
            let pixels = (0..32 * 24).flat_map(|_| rgba).collect();
            let image = photocraft_codecs::Image::from_u8(
                32,
                24,
                photocraft_codecs::ChannelLayout::Rgba,
                pixels,
            )
            .unwrap();
            let bytes = photocraft_codecs::encode(
                &image,
                photocraft_codecs::Format::Png,
                &Default::default(),
            )
            .unwrap();
            std::fs::write(&path, bytes).unwrap();
            let (expected, _) = oracle(state, &color, command, params.clone());
            let actual = cached(
                state,
                &color,
                command,
                params.clone(),
                "linked",
                "unchanged-version",
                &cache,
                None,
            )
            .unwrap();
            assert_eq!(actual.preview.png, expected.png);
            outputs.push(actual.preview.png);
        }
        assert_ne!(
            outputs[0], outputs[1],
            "{command}: external bytes must change the preview"
        );
    }
    let counters = cache.lock().unwrap();
    assert_eq!(
        (
            counters.hits,
            counters.misses,
            counters.executions,
            counters.base_encodes
        ),
        (0, 0, 10, 10)
    );
    assert!(std::sync::Arc::ptr_eq(
        &original,
        &source.active().unwrap().doc
    ));
    assert_eq!(history, source.active().unwrap().history.entries());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn history_free_command_snapshots_reuse_the_existing_completed_visual_result() {
    let source = ordinary_filter_fixture(16);
    let state = source.active().unwrap();
    let color = super::color_views::Snapshot::capture(&source).unwrap();
    let cache = Mutex::new(Cache::default());
    let (command, params) = detail_cases()[0].clone();
    let first = cached(
        state,
        &color,
        command,
        params.clone(),
        "no-history",
        "v1",
        &cache,
        None,
    )
    .unwrap();
    let stripped =
        super::super::snapshot::capture(state, super::super::snapshot::HistoryPolicy::Discard);
    assert_eq!(stripped.history.past_len(), 0);
    let second = cached(
        &stripped,
        &color,
        command,
        params,
        "no-history",
        "v1",
        &cache,
        None,
    )
    .unwrap();
    assert_eq!(first.preview.png, second.preview.png);
    let counts = cache.lock().unwrap();
    assert_eq!(
        (
            counts.hits,
            counts.misses,
            counts.executions,
            counts.base_encodes
        ),
        (1, 1, 1, 1)
    );
}

#[test]
fn canceled_command_previews_do_not_compute_reuse_or_publish_cache_entries() {
    let source = ordinary_filter_fixture(8);
    let state = source.active().unwrap();
    let color = super::color_views::Snapshot::capture(&source).unwrap();
    let cache = Mutex::new(Cache::default());
    let owner = format!("canceled-cache-{}", ulid::Ulid::new());
    let request = ulid::Ulid::new().to_string();
    let lease = super::super::preview_requests::acquire(&owner, Some(&request)).unwrap();
    super::super::preview_requests::cancel(&owner, &request).unwrap();
    let (command, params) = detail_cases()[0].clone();
    let render = || {
        super::render_using_cache(
            state,
            Some(&color),
            command,
            params.clone(),
            None,
            None,
            Some(Request {
                owner: &owner,
                version: "v1",
                cache: &cache,
                control: Some(lease.token()),
            }),
        )
    };
    assert!(render().is_err());
    {
        let counts = cache.lock().unwrap();
        assert_eq!(
            (
                counts.hits,
                counts.misses,
                counts.executions,
                counts.base_encodes
            ),
            (0, 0, 0, 0)
        );
    }
    cached(
        state,
        &color,
        command,
        params.clone(),
        &owner,
        "v1",
        &cache,
        None,
    )
    .unwrap();
    assert!(render().is_err());
    let counts = cache.lock().unwrap();
    assert_eq!(
        (
            counts.hits,
            counts.misses,
            counts.executions,
            counts.base_encodes
        ),
        (0, 1, 1, 1)
    );
}

#[test]
fn pixel_adjustments_preview_and_match_color_reads_a_second_document() {
    let source = ordinary_filter_fixture(8);
    let state = source.active().unwrap();
    let color = super::color_views::Snapshot::capture(&source).unwrap();
    let png = |preview: PreviewWithRegions| preview.preview.png;
    let original = png(super::render_using_cache(state, Some(&color), "image.adjustments.shadowsHighlights", json!({"shadowAmount":0}), None, None, None).unwrap());
    let lifted = png(super::render_using_cache(state, Some(&color), "image.adjustments.shadowsHighlights", json!({"shadowAmount":100,"blackClip":1}), None, None, None).unwrap());
    assert_ne!(original, lifted, "Shadows/Highlights previews with its Black Clip");
    assert!(super::render_using_cache(state, Some(&color), "image.adjustments.replaceColor", json!({"color":"#ff0000","hue":120}), None, None, None).is_ok());
    let mut brighter = Session::new();
    brighter.add_document((*state.doc).clone(), None);
    brighter.execute("image.adjustments.exposure", json!({"exposure":2})).unwrap();
    let doc = (*brighter.active().unwrap().doc).clone();
    assert!(super::render_using_cache(state, Some(&color), "image.adjustments.matchColor", json!({"source":1}), None, None, None).is_err(), "a missing source document is an error");
    let unmatched = png(super::render_using_cache(state, Some(&color), "image.adjustments.matchColor", json!({}), None, None, None).unwrap());
    let matched = png(super::render_using_cache_repeat(state, Some(&color), "image.adjustments.matchColor", json!({"source":1}), None, None, None, None, Some(doc)).unwrap());
    assert_ne!(unmatched, matched, "Match Color needs its source and uses it when given");
}
