use super::super::{color_views, PhotoViewPreview};
use photocraft_engine::{
    channel_cmds::ChannelView,
    doc::{Document, LayerId},
    DocState,
};
use serde_json::Value;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex, Weak},
    time::{Duration, Instant},
};

use super::super::memory;

pub(super) fn has_linked_target(state: &DocState, params: &Value) -> bool {
    use photocraft_engine::doc::{LayerContent, SmartSource};
    let layer = params["layer"]
        .as_u64()
        .map(LayerId)
        .or(state.active_layer)
        .and_then(|id| state.doc.layer(id));
    // Linked source bytes may change without a document revision.
    layer.is_some_and(|layer|matches!(&layer.content,LayerContent::Smart(smart) if matches!(smart.source,SmartSource::Linked{..})))
}

pub(super) struct Request<'a> {
    pub owner: &'a str,
    pub version: &'a str,
    pub cache: &'a Mutex<Cache>,
    pub control: Option<&'a super::super::preview_requests::Token>,
}

pub(super) struct Key {
    owner: String,
    version: String,
    source: Weak<Document>,
    revision: u64,
    active: Option<LayerId>,
    selected: Vec<LayerId>,
    channels: ChannelView,
    color: String,
    command: String,
    params: Value,
}

impl Key {
    pub(super) fn new(
        owner: &str,
        version: &str,
        state: &DocState,
        color: &color_views::Snapshot,
        command: &str,
        params: &Value,
    ) -> Result<Self, String> {
        Ok(Self {
            owner: owner.into(),
            version: version.into(),
            source: Arc::downgrade(&state.doc),
            revision: state.revision,
            active: state.active_layer,
            selected: state.selected_layers.clone(),
            channels: state.channel_view.clone(),
            color: color.preview_cache_key()?,
            command: command.into(),
            params: params.clone(),
        })
    }

    fn matches(&self, other: &Self) -> bool {
        self.source
            .upgrade()
            .zip(other.source.upgrade())
            .is_some_and(|(a, b)| Arc::ptr_eq(&a, &b))
            && self.owner == other.owner
            && self.version == other.version
            && self.revision == other.revision
            && self.active == other.active
            && self.selected == other.selected
            && self.channels == other.channels
            && self.color == other.color
            && self.command == other.command
            && self.params == other.params
    }

    fn bytes(&self) -> usize {
        4096usize
            .saturating_add(self.owner.capacity())
            .saturating_add(self.version.capacity())
            .saturating_add(self.command.capacity())
            .saturating_add(self.color.capacity())
            .saturating_add(
                self.selected
                    .capacity()
                    .saturating_mul(std::mem::size_of::<LayerId>()),
            )
            .saturating_add(self.params.to_string().len().saturating_mul(16))
            .saturating_add(
                serde_json::to_string(&self.channels)
                    .map_or(usize::MAX, |value| value.len().saturating_mul(16)),
            )
    }
}

pub(super) struct Completed {
    pub doc: Arc<Document>,
    pub channels: ChannelView,
    pub preview: PhotoViewPreview,
}

impl Completed {
    fn bytes(&self, limit: usize) -> Option<usize> {
        let overhead = 16usize * 1024
            + self.preview.png.capacity()
            + serde_json::to_string(&self.channels)
                .ok()?
                .len()
                .saturating_mul(16)
            + self
                .preview
                .result
                .as_ref()
                .map_or(0, |value| value.to_string().len().saturating_mul(16));
        let doc = memory::retained_document_bytes(&self.doc, limit.checked_sub(overhead)?)?;
        doc.checked_add(overhead).filter(|bytes| *bytes <= limit)
    }
}

struct Entry {
    key: Key,
    value: Arc<Completed>,
    bytes: usize,
    used: Instant,
}

pub(super) struct Cache {
    entries: VecDeque<Entry>,
    retired: Vec<(Weak<Completed>, usize)>,
    max_bytes: usize,
    max_count: usize,
    ttl: Duration,
    #[cfg(test)]
    pub hits: usize,
    #[cfg(test)]
    pub misses: usize,
    #[cfg(test)]
    pub executions: usize,
    #[cfg(test)]
    pub base_encodes: usize,
}

impl Default for Cache {
    fn default() -> Self {
        Self {
            entries: VecDeque::new(),
            retired: Vec::new(),
            max_bytes: 128 * 1024 * 1024,
            max_count: 4,
            ttl: Duration::from_secs(60),
            #[cfg(test)]
            hits: 0,
            #[cfg(test)]
            misses: 0,
            #[cfg(test)]
            executions: 0,
            #[cfg(test)]
            base_encodes: 0,
        }
    }
}

impl Cache {
    fn retire(&mut self, entry: Entry) {
        if Arc::strong_count(&entry.value) > 1 {
            self.retired
                .push((Arc::downgrade(&entry.value), entry.bytes));
        }
    }

    fn prune(&mut self, now: Instant) {
        self.retired.retain(|(value, _)| value.strong_count() > 0);
        let mut index = 0;
        while index < self.entries.len() {
            let entry = &self.entries[index];
            if entry.key.source.strong_count() == 0
                || now.saturating_duration_since(entry.used) >= self.ttl
            {
                let entry = self.entries.remove(index).unwrap();
                self.retire(entry);
            } else {
                index += 1;
            }
        }
    }

    fn bytes(&self) -> usize {
        self.entries
            .iter()
            .map(|entry| entry.bytes)
            .chain(self.retired.iter().map(|(_, bytes)| *bytes))
            .fold(0usize, usize::saturating_add)
    }

    pub(super) fn get(&mut self, key: &Key, now: Instant) -> Option<Arc<Completed>> {
        self.prune(now);
        let index = self.entries.iter().position(|entry| entry.key.matches(key));
        let Some(index) = index else {
            #[cfg(test)]
            {
                self.misses += 1;
            }
            return None;
        };
        let mut entry = self.entries.remove(index).unwrap();
        entry.used = now;
        let value = entry.value.clone();
        self.entries.push_back(entry);
        #[cfg(test)]
        {
            self.hits += 1;
        }
        Some(value)
    }

    pub(super) fn insert(&mut self, key: Key, mut value: Completed, now: Instant) {
        self.prune(now);
        if key.source.strong_count() == 0 || self.max_count == 0 {
            return;
        }
        let Some(bytes) = value
            .bytes(self.max_bytes)
            .and_then(|bytes| bytes.checked_add(key.bytes()))
            .filter(|bytes| *bytes <= self.max_bytes)
        else {
            return;
        };
        // A photo keeps only its latest completed parameters, even across versions.
        let mut index = 0;
        while index < self.entries.len() {
            if self.entries[index].key.owner == key.owner {
                let entry = self.entries.remove(index).unwrap();
                self.retire(entry);
            } else {
                index += 1;
            }
        }
        while self.entries.len() >= self.max_count
            || self.bytes().saturating_add(bytes) > self.max_bytes
        {
            let Some(entry) = self.entries.pop_front() else {
                return;
            };
            self.retire(entry);
        }
        // No-change native operations may return the source Arc itself. A distinct
        // outer document lets dead-source cleanup work without pinning that Arc.
        value.doc = Arc::new((*value.doc).clone());
        self.entries.push_back(Entry {
            key,
            value: Arc::new(value),
            bytes,
            used: now,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use photocraft_engine::Session;
    use serde_json::json;

    fn fixture() -> Session {
        let mut engine = Session::new();
        engine
            .execute(
                "file.new",
                json!({"width":16,"height":12,"background":"#4080b0"}),
            )
            .unwrap();
        engine
    }
    fn key(engine: &Session, owner: &str) -> Key {
        Key::new(
            owner,
            "version",
            engine.active().unwrap(),
            &color_views::Snapshot::capture(engine).unwrap(),
            "filter.blurGallery.fieldBlur",
            &json!({"blur":3}),
        )
        .unwrap()
    }
    fn completed(engine: &Session) -> Completed {
        let state = engine.active().unwrap();
        Completed {
            doc: state.doc.clone(),
            channels: state.channel_view.clone(),
            preview: PhotoViewPreview {
                width: 16,
                height: 12,
                png: "encoded".into(),
                result: Some(json!({"ok":true})),
            },
        }
    }
    #[test]
    fn completed_cache_enforces_lru_count_expiry_and_one_entry_per_owner() {
        let engine = fixture();
        let start = Instant::now();
        let mut cache = Cache {
            max_count: 2,
            ..Default::default()
        };
        cache.insert(key(&engine, "a"), completed(&engine), start);
        cache.insert(
            key(&engine, "b"),
            completed(&engine),
            start + Duration::from_secs(1),
        );
        drop(
            cache
                .get(&key(&engine, "a"), start + Duration::from_secs(2))
                .unwrap(),
        );
        cache.insert(
            key(&engine, "c"),
            completed(&engine),
            start + Duration::from_secs(3),
        );
        assert!(cache
            .get(&key(&engine, "b"), start + Duration::from_secs(4))
            .is_none());
        assert!(cache
            .get(&key(&engine, "a"), start + Duration::from_secs(4))
            .is_some());
        assert!(cache
            .get(&key(&engine, "c"), start + Duration::from_secs(4))
            .is_some());
        cache.insert(
            key(&engine, "a"),
            completed(&engine),
            start + Duration::from_secs(5),
        );
        assert_eq!(cache.entries.len(), 2);
        assert!(cache.retired.is_empty());
        assert!(cache
            .get(&key(&engine, "a"), start + Duration::from_secs(65))
            .is_none());
        assert!(cache.entries.is_empty());
        assert_eq!(cache.bytes(), 0);
    }
    #[test]
    fn completed_cache_refuses_oversized_entries_without_destroying_a_valid_one() {
        let engine = fixture();
        let now = Instant::now();
        let mut cache = Cache::default();
        cache.insert(key(&engine, "a"), completed(&engine), now);
        let bound = cache.bytes();
        cache.max_bytes = bound;
        let mut oversized = completed(&engine);
        oversized.preview.png = "x".repeat(bound);
        cache.insert(key(&engine, "a"), oversized, now);
        assert_eq!(cache.entries.len(), 1);
        assert_eq!(cache.bytes(), bound);
        assert!(cache.get(&key(&engine, "a"), now).is_some());
        cache.max_bytes = 1;
        cache.insert(key(&engine, "b"), completed(&engine), now);
        assert!(cache.get(&key(&engine, "b"), now).is_none());
    }
    #[test]
    fn completed_cache_counts_evicted_entries_while_a_renderer_holds_them() {
        let engine = fixture();
        let now = Instant::now();
        let mut cache = Cache::default();
        cache.insert(key(&engine, "a"), completed(&engine), now);
        cache.max_bytes = cache.bytes();
        let held = cache.get(&key(&engine, "a"), now).unwrap();
        let weak = Arc::downgrade(&held);
        cache.insert(key(&engine, "b"), completed(&engine), now);
        assert!(cache.entries.is_empty());
        assert_eq!(cache.retired.len(), 1);
        assert!(cache.bytes() <= cache.max_bytes);
        drop(held);
        assert!(weak.upgrade().is_none());
        cache.insert(key(&engine, "b"), completed(&engine), now);
        assert_eq!(cache.entries.len(), 1);
        assert!(cache.retired.is_empty());
    }
    #[test]
    fn completed_cache_does_not_pin_original_documents_or_history_even_for_no_change() {
        let engine = fixture();
        let state = engine.active().unwrap();
        let origin = Arc::downgrade(&state.doc);
        let count = Arc::strong_count(&state.doc);
        let now = Instant::now();
        let mut cache = Cache::default();
        cache.insert(key(&engine, "a"), completed(&engine), now);
        assert_eq!(Arc::strong_count(&state.doc), count);
        let filtered = Arc::downgrade(&cache.entries[0].value.doc);
        assert!(!Arc::ptr_eq(&state.doc, &cache.entries[0].value.doc));
        drop(engine);
        assert!(origin.upgrade().is_none());
        cache.prune(now);
        assert!(cache.entries.is_empty());
        assert!(filtered.upgrade().is_none());
    }
    #[test]
    fn completed_cache_checks_active_layer_even_without_a_revision_change() {
        let engine = fixture();
        let original = key(&engine, "a");
        let mut changed = engine.active().unwrap().clone();
        changed.active_layer = None;
        let alternate = Key::new(
            "a",
            "version",
            &changed,
            &color_views::Snapshot::capture(&engine).unwrap(),
            "filter.blurGallery.fieldBlur",
            &json!({"blur":3}),
        )
        .unwrap();
        assert!(!original.matches(&alternate));
    }
}
