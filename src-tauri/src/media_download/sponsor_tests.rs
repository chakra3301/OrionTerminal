use super::*;
use serde_json::json;
fn choice(mode: Mode, categories: &[&str]) -> Choice {
    Choice {
        mode,
        categories: categories.iter().map(|s| (*s).into()).collect(),
    }
}
fn metadata(extractor: &str) -> Metadata {
    super::super::policy::metadata(
        &json!({"id":"abcdefghijk","extractor_key":extractor,"title":"Generated","duration":12}),
        "https://example.com/generated",
    )
    .unwrap()
}
#[test]
fn options_are_off_bounded_and_literal_with_source_and_timeline_guards() {
    let mut o = Options::default();
    assert_eq!(o.sponsorblock.mode, Mode::Off);
    assert!(o.sponsorblock.categories().is_empty());
    for raw in [r#"{"mode":"execute"}"#, r#"{"api":"http://localhost"}"#] {
        assert!(serde_json::from_str::<Choice>(raw).is_err());
    }
    for cats in [
        vec!["all"],
        vec!["sponsor", "sponsor"],
        vec!["--exec"],
        vec![],
    ] {
        o.sponsorblock = choice(Mode::Mark, &cats);
        assert!(o.validate_preset(&Preset::Video1080, None).is_err());
    }
    o.sponsorblock = choice(Mode::Mark, &["sponsor", "poi_highlight", "chapter", "hook"]);
    assert!(o
        .validate_preset(&Preset::Video1080, Some(&metadata("Youtube")))
        .is_ok());
    assert!(o
        .validate_preset(&Preset::Video1080, Some(&metadata("Generic")))
        .is_err());
    assert!(o.validate_preset(&Preset::AudioMp3, None).is_err());
    assert!(o.validate_preset(&Preset::AudioM4a, None).is_ok());
    o.sponsorblock = choice(Mode::Remove, &["chapter"]);
    assert!(o.validate_preset(&Preset::Video1080, None).is_err());
    o.sponsorblock = choice(Mode::Remove, &["sponsor"]);
    assert!(o.validate_preset(&Preset::AudioMp3, None).is_ok());
    o.start_seconds = Some(1.0);
    assert!(o
        .validate_preset(&Preset::Video1080, None)
        .unwrap_err()
        .contains("clip ranges"));
    o.start_seconds = None;
    o.embed_subtitles = true;
    o.subtitle_langs = vec!["en".into()];
    assert!(o.validate_preset(&Preset::Video1080, None).is_err());
}
#[test]
fn command_has_no_default_lookup_and_fixed_opt_in_service_and_chapters() {
    let mut c = Command::new("fake");
    configure(&mut c, &Choice::default(), &Preset::Video1080);
    assert_eq!(
        c.as_std().get_args().collect::<Vec<_>>(),
        vec!["--no-sponsorblock"]
    );
    let mut c = Command::new("fake");
    configure(
        &mut c,
        &choice(Mode::Mark, &["sponsor", "intro"]),
        &Preset::Video1080,
    );
    let args: Vec<_> = c.as_std().get_args().map(|s| s.to_str().unwrap()).collect();
    assert!(args
        .windows(2)
        .any(|w| w == ["--sponsorblock-mark", "intro,sponsor"]));
    assert!(args
        .windows(2)
        .any(|w| w == ["--sponsorblock-api", "https://sponsor.ajay.app"]));
    assert!(args.contains(&"--embed-chapters"));
    assert!(!args.contains(&"--no-sponsorblock"));
    assert!(!args.contains(&"--force-keyframes-at-cuts"));
    assert!(args.contains(&SOURCE_RECEIPT));
    assert!(args.contains(&RECEIPT));
}
fn receipt(dir: &Path, rows: serde_json::Value, duration: f64) {
    fs::write(dir.join(SOURCE_RECEIPT), b"12\n").unwrap();
    fs::write(
        dir.join(RECEIPT),
        serde_json::to_vec(&json!({"duration":duration,"segments":rows})).unwrap(),
    )
    .unwrap();
}
#[test]
fn lookup_receipts_fail_closed_and_overlap_removal_matches_actual_duration() {
    let dir = std::env::temp_dir().join(format!("orion-sponsor-unit-{}", ulid::Ulid::new()));
    fs::create_dir(&dir).unwrap();
    let c = choice(Mode::Remove, &["sponsor"]);
    assert!(report(&dir, &Choice::default(), Some(12.0))
        .unwrap()
        .is_none());
    assert!(report(&dir, &c, Some(12.0)).is_err());
    receipt(&dir, json!([]), 12.0);
    assert_eq!(report(&dir, &c, Some(12.0)).unwrap().unwrap().segments, 0);
    let rows = json!([{"start_time":2,"end_time":4,"category":"sponsor"},{"start_time":3,"end_time":5,"category":"sponsor"}]);
    receipt(&dir, rows, 9.0);
    let r = report(&dir, &c, Some(9.03)).unwrap().unwrap();
    assert_eq!(r.segments, 2);
    assert_eq!(r.processed_duration, 9.0);
    assert!(report(&dir, &c, Some(12.0)).is_err());
    receipt(
        &dir,
        json!([{"start_time":0,"end_time":12,"category":"sponsor"}]),
        12.0,
    );
    assert!(report(&dir, &c, Some(12.0)).is_err());
    receipt(
        &dir,
        json!([{"start_time":1,"end_time":2,"category":"intro"}]),
        11.0,
    );
    assert!(report(&dir, &c, Some(11.0)).is_err());
    fs::write(dir.join(RECEIPT), vec![b' '; MAX_RECEIPT as usize + 1]).unwrap();
    assert!(report(&dir, &c, Some(12.0)).is_err());
    assert!(reset(&dir, &c).is_err());
    receipt(&dir, json!([]), 12.0);
    reset(&dir, &c).unwrap();
    assert!(!dir.join(RECEIPT).exists());
    assert!(!dir.join(SOURCE_RECEIPT).exists());
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn marking_requires_source_duration_and_complete_merged_category_timing() {
    let dir = std::env::temp_dir().join(format!("orion-sponsor-timing-{}", ulid::Ulid::new()));
    fs::create_dir(&dir).unwrap();
    let c = choice(Mode::Mark, &["sponsor", "intro"]);
    receipt(
        &dir,
        json!([{"start_time":2,"end_time":4,"category":"sponsor"},{"start_time":3,"end_time":5,"category":"sponsor"},{"start_time":6,"end_time":8,"category":"intro"}]),
        11.0,
    );
    assert!(report(&dir, &c, Some(12.0)).is_err());
    receipt(
        &dir,
        json!([{"start_time":2,"end_time":4,"category":"sponsor"},{"start_time":3,"end_time":5,"category":"sponsor"},{"start_time":6,"end_time":8,"category":"intro"}]),
        12.0,
    );
    assert!(report(&dir, &c, None).is_err());
    assert!(report(&dir, &c, Some(10.0)).is_err());
    let r = report(&dir, &c, Some(12.0)).unwrap().unwrap();
    assert!(verify_final_duration(&r, Some(12.0), None, None).is_ok());
    for actual in [
        None,
        Some(f64::NAN),
        Some(f64::INFINITY),
        Some(0.0),
        Some(10.0),
    ] {
        assert!(verify_final_duration(&r, actual, None, None).is_err());
    }
    assert!(verify_final_duration(&r, Some(4.0), Some(3.0), Some(7.0)).is_ok());
    assert!(verify_final_duration(&r, Some(5.1), Some(3.0), Some(7.0)).is_err());
    let mut long = r.clone();
    long.processed_duration = 1200.0;
    assert!(verify_final_duration(&long, Some(1189.0), None, None).is_err());
    let marker = |start, end, category: &str| Marker {
        start,
        end,
        categories: vec![category.into()],
    };
    let actual = vec![marker(2.0, 5.0, "sponsor"), marker(6.0, 8.0, "intro")];
    assert!(verify_markers(&r, &actual, None, None).is_ok());
    assert!(verify_markers(&r, &actual[..1], None, None).is_err());
    assert!(verify_markers(
        &r,
        &[marker(2.0, 5.0, "sponsor"), marker(7.0, 9.0, "intro")],
        None,
        None
    )
    .is_err());
    assert!(verify_markers(
        &r,
        &[marker(0.0, 2.0, "sponsor"), marker(3.0, 4.0, "intro")],
        Some(3.0),
        Some(7.0)
    )
    .is_ok());
    assert!(verify_markers(
        &r,
        &[marker(0.0, 2.0, "sponsor"), marker(4.0, 5.0, "intro")],
        Some(3.0),
        Some(7.0)
    )
    .is_err());
    fs::remove_dir_all(dir).unwrap();
}
#[cfg(unix)]
#[test]
fn receipt_links_are_refused_without_reading_or_removing_the_target() {
    let dir = std::env::temp_dir().join(format!("orion-sponsor-links-{}", ulid::Ulid::new()));
    fs::create_dir(&dir).unwrap();
    let target = dir.join("outside");
    fs::write(&target, b"untouched").unwrap();
    std::os::unix::fs::symlink(&target, dir.join(RECEIPT)).unwrap();
    let c = choice(Mode::Mark, &["sponsor"]);
    assert!(report(&dir, &c, Some(12.0)).is_err());
    assert!(reset(&dir, &c).is_err());
    assert_eq!(fs::read(&target).unwrap(), b"untouched");
    fs::remove_dir_all(dir).unwrap();
}
