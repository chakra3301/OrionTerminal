use super::super::{mask_filters, preview_requests::Token};
use photocraft_engine::{
    jobs::{JobId, JobOutcome, Started},
    Session,
};
use serde_json::Value;

pub(super) fn execute(
    engine: &mut Session,
    command: &str,
    params: Value,
    control: Option<&Token>,
) -> Result<Value, String> {
    if let Some(control) = control {
        control.check()?;
    }
    let job = control.is_some()
        && photocraft_engine::filters::params_for(command, &params).is_some()
        && engine.is_enabled(command)
        && mask_filters::pixel_preview_job(engine, &params)?;
    let result = if job {
        super::validate_filter_input(command, &params)?;
        match engine
            .start(command, params)
            .map_err(|error| error.to_string())?
        {
            Started::Done(result) => Ok(result),
            Started::Job(id) => wait(engine, id, control.unwrap()),
        }
    } else {
        super::super::execute_view_command(engine, command, params)
    }?;
    if let Some(control) = control {
        control.check()?;
    }
    Ok(result)
}

fn wait(engine: &mut Session, id: JobId, control: &Token) -> Result<Value, String> {
    loop {
        if control.canceled() {
            engine.cancel_job(id);
            // Cancellation events precede worker exit; keep the request's slot
            // until every canceled worker has released its document snapshot.
            engine.join_cancelled_jobs();
            engine.poll_jobs();
            return Err("Image preview canceled".into());
        }
        for event in engine.poll_jobs() {
            if event.id == id {
                control.check()?;
                return match event.outcome {
                    JobOutcome::Done(result) => Ok(result),
                    JobOutcome::Failed(error) => Err(error),
                    JobOutcome::Cancelled => {
                        engine.join_cancelled_jobs();
                        Err("Image preview canceled".into())
                    }
                };
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}

#[cfg(test)]
mod tests {
    use super::super::super as host;
    use super::*;
    use serde_json::json;
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc,
        },
        time::Duration,
    };

    #[test]
    fn cancellable_displacement_retains_host_file_limits_before_starting_a_worker() {
        let directory = std::env::temp_dir().join(format!("xdesign-job-input-{}", ulid::Ulid::new()));
        std::fs::create_dir_all(&directory).unwrap();
        let oversized = directory.join("oversized.png");
        std::fs::File::create(&oversized).unwrap().set_len(host::MAX_INPUT_BYTES + 1).unwrap();
        let mut engine = super::super::tests::ordinary_filter_fixture(8);
        let source = engine.active().unwrap().doc.clone();
        let history = engine.active().unwrap().history.entries().to_vec();
        let journal = engine.journal.clone();
        let lease = host::preview_requests::acquire("job-input-validation", None).unwrap();
        for path in [&directory, &oversized] {
            let params = json!({"mapPath":path});
            assert!(photocraft_engine::filters::params_for("filter.distort.displace", &params).is_some());
            assert!(engine.is_enabled("filter.distort.displace"));
            assert!(mask_filters::pixel_preview_job(&engine, &params).unwrap());
            assert!(execute(&mut engine, "filter.distort.displace", params, Some(lease.token()))
                .unwrap_err().contains("512MB"));
            assert!(Arc::ptr_eq(&source, &engine.active().unwrap().doc));
            assert_eq!(engine.active().unwrap().history.entries(), history);
            assert_eq!(engine.journal, journal);
            assert!(!engine.has_jobs());
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn native_filter_cancellation_keeps_source_pixels_and_history_and_drains_the_worker() {
        let owner = format!("actual-cancel-{}", ulid::Ulid::new());
        let request = ulid::Ulid::new().to_string();
        let lease = host::preview_requests::acquire(&owner, Some(&request)).unwrap();
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":512,"height":512,"background":"#4080b0"}),
            )
            .unwrap();
        let before = engine.active().unwrap().doc.clone();
        let weak = Arc::downgrade(&before);
        let history = engine.active().unwrap().history.entries().to_vec();
        let journal = engine.journal.clone();
        let Started::Job(id) = engine
            .start("filter.blur.gaussianBlur", json!({"radius":200}))
            .unwrap()
        else {
            panic!("native filter job")
        };
        host::preview_requests::cancel(&owner, &request).unwrap();
        assert!(wait(&mut engine, id, lease.token()).is_err());
        assert!(Arc::ptr_eq(&before, &engine.active().unwrap().doc));
        assert_eq!(engine.active().unwrap().history.entries(), history);
        assert_eq!(engine.journal, journal);
        assert!(!engine.has_jobs());
        drop(before);
        drop(engine);
        assert!(weak.upgrade().is_none());
    }

    #[test]
    fn cancellable_native_filters_match_synchronous_pixels_result_history_and_journal() {
        for depth in [8, 16, 32] {
            for (command, params) in [
                (
                    "filter.blurGallery.fieldBlur",
                    json!({"pins":[{"x":0.4,"y":0.3,"blur":9}]}),
                ),
                (
                    "filter.blurGallery.irisBlur",
                    json!({"pins":[{"x":0.4,"y":0.3,"radiusX":0.3,"radiusY":0.2,"blur":8}]}),
                ),
                (
                    "filter.blurGallery.pathBlur",
                    json!({"paths":[{"points":[[0.1,0.2],[0.8,0.7]],"speed":10}]}),
                ),
                (
                    "filter.blurGallery.spinBlur",
                    json!({"pins":[{"x":0.5,"y":0.5,"radiusX":0.3,"radiusY":0.3,"blurAngle":30}]}),
                ),
                (
                    "filter.blurGallery.tiltShift",
                    json!({"blur":10,"focus":0.25,"transition":0.2}),
                ),
                ("filter.blur.gaussianBlur", json!({"radius":2.25})),
                (
                    "filter.noise.addNoise",
                    json!({"amount":18,"seed":7,"monochromatic":true}),
                ),
            ] {
                let mut actual = super::super::tests::ordinary_filter_fixture(depth);
                actual
                    .execute("select.rect", json!({"x":2,"y":3,"width":25,"height":16}))
                    .unwrap();
                let mut expected = Session::new();
                expected.add_document((*actual.active().unwrap().doc).clone(), None);
                *expected.active_mut().unwrap() = actual.active().unwrap().clone();
                expected.journal = actual.journal.clone();
                let result =
                    host::execute_view_command(&mut expected, command, params.clone()).unwrap();
                let lease = host::preview_requests::acquire(
                    &format!("native-job-parity-{}", ulid::Ulid::new()),
                    None,
                )
                .unwrap();
                let actual_result =
                    execute(&mut actual, command, params, Some(lease.token())).unwrap();
                let a = actual.active().unwrap();
                let e = expected.active().unwrap();
                assert_eq!(actual_result, result, "{depth} {command}");
                assert_eq!(*a.doc, *e.doc);
                assert_eq!(a.history.entries(), e.history.entries());
                assert_eq!(a.revision, e.revision);
                assert_eq!(a.active_layer, e.active_layer);
                assert_eq!(a.selected_layers, e.selected_layers);
                assert_eq!(actual.journal, expected.journal);
            }
        }
    }

    #[test]
    fn cancellation_joins_workers_before_releasing_the_global_preview_slot() {
        let owner = format!("drain-test-{}", ulid::Ulid::new());
        let request = ulid::Ulid::new().to_string();
        let lease = host::preview_requests::acquire(&owner, Some(&request)).unwrap();
        let other = host::preview_requests::acquire("drain-other", None).unwrap();
        let mut engine = Session::new();
        engine
            .execute("file.new", json!({"width":32,"height":24}))
            .unwrap();
        let source = Arc::downgrade(&engine.active().unwrap().doc);
        let snapshot = engine.active().unwrap().doc.clone();
        let dropped = Arc::new(AtomicBool::new(false));
        let done = dropped.clone();
        let (started_tx, started_rx) = mpsc::channel();
        let (draining_tx, draining_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let Started::Job(id) = engine
            .start_job(
                "preview-drain",
                json!({}),
                "Drain test",
                true,
                move |ctx| {
                    let _snapshot = snapshot;
                    started_tx.send(()).unwrap();
                    while !ctx.cancelled() {
                        std::thread::sleep(Duration::from_millis(1));
                    }
                    draining_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    done.store(true, Ordering::Release);
                    Ok(())
                },
                |_, _| Ok(Value::Null),
            )
            .unwrap()
        else {
            panic!("native job")
        };
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        host::preview_requests::cancel(&owner, &request).unwrap();
        let waiter = std::thread::spawn(move || {
            let result = wait(&mut engine, id, lease.token());
            assert!(result.is_err());
            assert!(Arc::ptr_eq(
                &source.upgrade().unwrap(),
                &engine.active().unwrap().doc
            ));
            assert!(!engine.has_jobs());
            assert!(engine.journal.len() == 1);
            drop(engine);
            assert!(source.upgrade().is_none());
            drop(lease);
        });
        draining_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(!dropped.load(Ordering::Acquire));
        assert!(host::preview_requests::acquire("drain-third", None).is_err());
        release_tx.send(()).unwrap();
        waiter.join().unwrap();
        assert!(dropped.load(Ordering::Acquire));
        let next = host::preview_requests::acquire("drain-third", None).unwrap();
        drop(next);
        drop(other);
    }
}
