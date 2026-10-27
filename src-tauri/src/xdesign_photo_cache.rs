//! Resident sessions are a cache of immutable disk versions. Evict one least
//! recently edited session at a time, keeping the active operation's document.
use super::PhotoSession;
use photocraft_engine::doc::{LayerContent, SmartSource};
use std::collections::HashMap;

struct Entry {
    session: PhotoSession,
    used: u64,
    bytes: usize,
}
pub(super) struct PhotoCache {
    entries: HashMap<String, Entry>,
    clock: u64,
    max_count: usize,
    max_bytes: usize,
}
impl Default for PhotoCache {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
            clock: 0,
            max_count: 8,
            max_bytes: 512 * 1024 * 1024,
        }
    }
}
const SESSION_OVERHEAD: usize = 64 * 1024;
const MAX_MEASURED_ROOTS: usize = 4096;

fn legacy_estimate(session: &PhotoSession) -> (usize, usize) {
    session
        .engine
        .documents()
        .iter()
        .fold((SESSION_OVERHEAD, 0usize), |(total, pixel_floor), state| {
            let doc = &state.doc;
            let native_pixels = state.history.pixel_bytes(doc);
            let mut bytes = native_pixels;
            if let Some(selection) = &doc.selection {
                bytes = bytes.saturating_add(
                    selection
                        .tiles()
                        .map(|(_, tile)| tile.bytes().len())
                        .sum::<usize>(),
                );
            }
            for pattern in &doc.patterns {
                bytes = bytes.saturating_add(
                    pattern
                        .surface
                        .tiles()
                        .map(|(_, tile)| tile.bytes().len())
                        .sum::<usize>(),
                );
            }
            for (_, _, layer) in doc.walk() {
                if let LayerContent::Smart(smart) = &layer.content {
                    if let SmartSource::Embedded { bytes: source, .. } = &smart.source {
                        bytes = bytes.saturating_add(source.len());
                    }
                }
            }
            bytes = bytes.saturating_add(doc.metadata.xmp.as_ref().map_or(0, String::len));
            bytes = bytes.saturating_add(doc.metadata.exif.as_ref().map_or(0, |data| data.len()));
            bytes = bytes.saturating_add(doc.icc_profile.as_ref().map_or(0, |data| data.len()));
            for data in doc
                .metadata
                .psd_resources
                .iter()
                .map(|(_, _, data)| data)
                .chain(
                    doc.metadata
                        .psd_global_blocks
                        .iter()
                        .map(|(_, _, data)| data),
                )
            {
                bytes = bytes.saturating_add(data.len());
            }
            (total.saturating_add(bytes), pixel_floor.saturating_add(native_pixels))
        })
}

fn estimate(session: &PhotoSession, limit: usize) -> usize {
    estimate_with(session, limit, || legacy_estimate(session))
}

fn estimate_with(session: &PhotoSession, limit: usize, legacy: impl FnOnce() -> (usize, usize)) -> usize {
    let mut roots = 0usize;
    for state in session.engine.documents() {
        let past = state.history.past_len();
        let redo = state.history.redo_labels().take(MAX_MEASURED_ROOTS + 1).count();
        let Some(count) = past.checked_add(redo).and_then(|count| count.checked_add(1)) else { return limit.saturating_add(1) };
        let Some(total) = roots.checked_add(count).filter(|total| *total <= MAX_MEASURED_ROOTS) else { return limit.saturating_add(1) };
        roots = total;
    }
    let (legacy, pixel_floor) = legacy();
    let measured = || -> Option<usize> {
        let mut budget = super::memory::DocumentBudget::new(limit, pixel_floor, SESSION_OVERHEAD)?;
        for state in session.engine.documents() {
            budget.include(&state.doc)?;
            for index in 0..state.history.past_len() {
                budget.include(&state.history.state(index)?)?;
            }
        }
        Some(budget.bytes())
    };
    // Redo's opaque payloads and private history containers cannot be borrowed.
    // Preserve the prior estimate while measuring more of current/undo retention;
    // neither value is an allocator measurement or a complete memory ceiling.
    legacy.max(measured().unwrap_or_else(|| limit.saturating_add(1)))
}
impl PhotoCache {
    pub(super) fn color_settings(&mut self,context:&std::sync::Arc<super::color_settings::Context>){for entry in self.entries.values_mut(){context.install(&mut entry.session.engine);entry.session.color_settings=Some(context.clone());}}
    pub(super) fn get(&self, key: &str) -> Option<&PhotoSession> {
        self.entries.get(key).map(|entry| &entry.session)
    }
    pub(super) fn get_mut(&mut self, key: &str) -> Option<&mut PhotoSession> {
        self.clock = self.clock.saturating_add(1);
        let used = self.clock;
        self.entries.get_mut(key).map(|entry| {
            entry.used = used;
            &mut entry.session
        })
    }
    pub(super) fn contains_key(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }
    pub(super) fn remove(&mut self, key: &str) -> Option<PhotoSession> {
        self.entries.remove(key).map(|entry| entry.session)
    }
    pub(super) fn insert(&mut self, key: String, session: PhotoSession) {
        self.clock = self.clock.saturating_add(1);
        let bytes = estimate(&session, self.max_bytes);
        self.entries.insert(
            key.clone(),
            Entry {
                session,
                used: self.clock,
                bytes,
            },
        );
        self.trim(&key);
    }
    pub(super) fn refresh(&mut self, key: &str) {
        if let Some(entry) = self.entries.get_mut(key) {
            entry.bytes = estimate(&entry.session, self.max_bytes);
        }
        self.trim(key);
    }
    fn trim(&mut self, keep: &str) {
        let mut bytes = self
            .entries
            .values()
            .fold(0usize, |total, entry| total.saturating_add(entry.bytes));
        while self.entries.len() > self.max_count
            || bytes > self.max_bytes && self.entries.len() > 1
        {
            let victim = self
                .entries
                .iter()
                .filter(|(key, _)| key.as_str() != keep)
                .min_by_key(|(_, entry)| entry.used)
                .map(|(key, _)| key.clone());
            let Some(victim) = victim else {
                break;
            };
            if let Some(entry) = self.entries.remove(&victim) {
                bytes = bytes.saturating_sub(entry.bytes);
                super::snapshots::forget(&victim);
            }
        }
    }
}

#[cfg(test)]
#[path = "xdesign_photo_cache_memory_tests.rs"]
mod memory_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::Session;
    use serde_json::json;
    fn session() -> PhotoSession {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":24,"height":24,"background":"white"}),
            )
            .unwrap();
        PhotoSession {
            engine,color_settings:None,
            version: "pinned".into(),
            original_path: None,
            writer: Default::default(),
        }
    }
    #[test]
    fn evicts_only_the_least_recent_session_and_keeps_other_versions_available() {
        let mut cache = PhotoCache {
            max_count: 2,
            ..Default::default()
        };
        cache.insert("a".into(), session());
        cache.insert("b".into(), session());
        cache.get_mut("a").unwrap();
        cache.insert("c".into(), session());
        assert!(cache.contains_key("a"));
        assert!(!cache.contains_key("b"));
        assert!(cache.contains_key("c"));
        assert_eq!(cache.get("a").unwrap().version, "pinned");
    }
    #[test]
    fn enforces_the_byte_estimate_and_keeps_an_oversized_active_document() {
        let first = session();
        let budget = estimate(&first, usize::MAX) * 2 - 1;
        let mut cache = PhotoCache {
            max_bytes: budget,
            ..Default::default()
        };
        cache.insert("a".into(), first);
        cache.insert("b".into(), session());
        assert!(!cache.contains_key("a"));
        assert!(cache.contains_key("b"));
        cache.max_bytes = 1;
        cache.insert("large".into(), session());
        assert_eq!(cache.entries.len(), 1);
        assert!(cache.contains_key("large"));
    }
    #[test]
    fn recalculates_after_an_edit_increases_history_and_pixel_cost() {
        let mut cache = PhotoCache::default();
        cache.insert("a".into(), session());
        cache.insert("b".into(), session());
        let before = cache.entries["b"].bytes;
        cache
            .get_mut("b")
            .unwrap()
            .engine
            .execute("image.imageSize", json!({"width":1024,"height":1024}))
            .unwrap();
        cache.max_bytes = before * 2;
        cache.refresh("b");
        assert!(cache.entries["b"].bytes > before);
        assert!(!cache.contains_key("a"));
    }
}
