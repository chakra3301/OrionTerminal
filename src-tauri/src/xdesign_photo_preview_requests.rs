use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

const MAX_ACTIVE: usize = 2;
const MAX_TOMBSTONES: usize = 64;
const TOMBSTONE_TTL: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub(super) struct Token(Arc<Control>);

struct Control {
    canceled: AtomicBool,
    publication: Mutex<()>,
}

impl Token {
    pub(super) fn canceled(&self) -> bool {
        self.0.canceled.load(Ordering::Acquire)
    }

    pub(super) fn check(&self) -> Result<(), String> {
        if self.canceled() {
            Err("Image preview canceled".into())
        } else {
            Ok(())
        }
    }

    fn cancel(&self) -> Result<(), String> {
        let _publication = self.0.publication.lock()
            .map_err(|_| "Image preview publication needs to be restarted")?;
        self.0.canceled.store(true, Ordering::Release);
        Ok(())
    }

    pub(super) fn publish<T>(&self, operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let _publication = self.0.publication.lock()
            .map_err(|_| "Image preview publication needs to be restarted")?;
        self.check()?;
        operation()
    }
}

#[derive(Clone, Hash, PartialEq, Eq)]
struct RequestKey {
    owner: String,
    id: String,
}

struct Active {
    token: Token,
}

struct Tombstone {
    key: RequestKey,
    expires: Instant,
}

#[derive(Default)]
struct Registry {
    active: HashMap<RequestKey, Active>,
    tombstones: Vec<Tombstone>,
}

impl Registry {
    fn prune(&mut self, now: Instant) {
        self.tombstones.retain(|tombstone| tombstone.expires > now);
    }

    fn acquire(
        &mut self,
        owner: &str,
        request_id: Option<&str>,
        now: Instant,
    ) -> Result<LeaseEntry, String> {
        self.prune(now);
        if self.active.len() >= MAX_ACTIVE {
            return Err("Wait for the current image preview to finish".into());
        }
        let id = match request_id {
            Some(id) => {
                validate_ulid(id)?;
                id.to_owned()
            }
            None => ulid::Ulid::new().to_string(),
        };
        let key = RequestKey {
            owner: owner.to_owned(),
            id,
        };
        if self.active.keys().any(|active| active.id == key.id) {
            return Err("Image preview request is already active".into());
        }
        let pre_canceled = if let Some(index) = self.tombstones.iter().position(|t| t.key == key) {
            self.tombstones.remove(index);
            true
        } else {
            false
        };
        let token = Token(Arc::new(Control {
            canceled: AtomicBool::new(pre_canceled),
            publication: Mutex::new(()),
        }));
        self.active.insert(
            key.clone(),
            Active {
                token: token.clone(),
            },
        );
        Ok(LeaseEntry { key, token })
    }

    fn cancel(&mut self, owner: &str, request_id: &str, now: Instant) -> Result<(), String> {
        validate_ulid(request_id)?;
        self.prune(now);
        let key = RequestKey {
            owner: owner.to_owned(),
            id: request_id.to_owned(),
        };
        if let Some(active) = self.active.get(&key) {
            return active.token.cancel();
        }
        if self.active.keys().any(|active| active.id == key.id) {
            return Ok(());
        }
        if self.tombstones.iter().any(|t| t.key == key) {
            return Ok(());
        }
        if self.tombstones.len() >= MAX_TOMBSTONES {
            return Err("Too many pending image preview cancellations".into());
        }
        self.tombstones.push(Tombstone {
            key,
            expires: now + TOMBSTONE_TTL,
        });
        Ok(())
    }

    fn release(&mut self, key: &RequestKey, token: &Token) {
        if self
            .active
            .get(key)
            .is_some_and(|active| Arc::ptr_eq(&active.token.0, &token.0))
        {
            self.active.remove(key);
        }
    }
}

fn validate_ulid(value: &str) -> Result<(), String> {
    let parsed = ulid::Ulid::from_string(value)
        .map_err(|_| "Invalid image preview request ID".to_owned())?;
    if parsed.to_string() != value {
        return Err("Invalid image preview request ID".into());
    }
    Ok(())
}

struct LeaseEntry {
    key: RequestKey,
    token: Token,
}

pub(super) struct Lease {
    registry: Arc<Mutex<Registry>>,
    entry: Option<LeaseEntry>,
}

impl Lease {
    pub(super) fn token(&self) -> &Token {
        &self.entry.as_ref().expect("live preview lease").token
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        if let Some(entry) = self.entry.take() {
            if let Ok(mut registry) = self.registry.lock() {
                registry.release(&entry.key, &entry.token);
            }
        }
    }
}

fn global() -> Arc<Mutex<Registry>> {
    static REGISTRY: OnceLock<Arc<Mutex<Registry>>> = OnceLock::new();
    REGISTRY
        .get_or_init(|| Arc::new(Mutex::new(Registry::default())))
        .clone()
}

pub(super) fn acquire(owner: &str, request_id: Option<&str>) -> Result<Lease, String> {
    let registry = global();
    let entry = registry
        .lock()
        .map_err(|_| "Image preview registry needs to be restarted")?
        .acquire(owner, request_id, Instant::now())?;
    Ok(Lease {
        registry,
        entry: Some(entry),
    })
}

pub(super) fn cancel(owner: &str, request_id: &str) -> Result<(), String> {
    global()
        .lock()
        .map_err(|_| "Image preview registry needs to be restarted")?
        .cancel(owner, request_id, Instant::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id() -> String {
        ulid::Ulid::new().to_string()
    }

    #[test]
    fn canceled_requests_cannot_publish_completed_results() {
        let mut registry = Registry::default();
        let request = id();
        let entry = registry.acquire("owner", Some(&request), Instant::now()).unwrap();
        registry.cancel("owner", &request, Instant::now()).unwrap();
        let mut published = false;
        let result = entry.token.publish(|| {
            published = true;
            Ok(())
        });
        assert_eq!(result.unwrap_err(), "Image preview canceled");
        assert!(!published);
    }

    #[test]
    fn publication_and_cancellation_have_a_single_completion_order() {
        let mut registry = Registry::default();
        let entry = registry.acquire("owner", None, Instant::now()).unwrap();
        let token = entry.token.clone();
        let order = Arc::new(Mutex::new(Vec::new()));
        let thread_order = order.clone();
        let (attempted_tx, attempted_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let mut canceler = None;
        entry.token.publish(|| {
            order.lock().unwrap().push("publish-start");
            canceler = Some(std::thread::spawn(move || {
                attempted_tx.send(()).unwrap();
                token.cancel().unwrap();
                thread_order.lock().unwrap().push("cancel-complete");
                done_tx.send(()).unwrap();
            }));
            attempted_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            assert!(matches!(done_rx.try_recv(), Err(std::sync::mpsc::TryRecvError::Empty)));
            order.lock().unwrap().push("publish-complete");
            Ok(())
        }).unwrap();
        canceler.unwrap().join().unwrap();
        assert_eq!(*order.lock().unwrap(), ["publish-start", "publish-complete", "cancel-complete"]);
        assert!(entry.token.canceled());
    }

    #[test]
    fn active_limit_and_duplicate_ids_are_bounded() {
        let now = Instant::now();
        let mut registry = Registry::default();
        let first = id();
        let second = id();
        let _a = registry.acquire("owner", Some(&first), now).unwrap();
        assert!(registry.acquire("other", Some(&first), now).is_err());
        let _b = registry.acquire("owner", Some(&second), now).unwrap();
        assert!(registry.acquire("owner", None, now).is_err());
    }

    #[test]
    fn cancellation_is_owner_scoped_and_prestart_is_consumed() {
        let now = Instant::now();
        let mut registry = Registry::default();
        let request = id();
        registry.cancel("other", &request, now).unwrap();
        let lease = registry.acquire("owner", Some(&request), now).unwrap();
        assert!(!lease.token.canceled());
        registry.release(&lease.key, &lease.token);
        registry.cancel("owner", &request, now).unwrap();
        let lease = registry.acquire("owner", Some(&request), now).unwrap();
        assert!(lease.token.canceled());
    }

    #[test]
    fn prestart_cancellations_expire_and_capacity_refuses_overflow() {
        let now = Instant::now();
        let mut registry = Registry::default();
        for _ in 0..MAX_TOMBSTONES {
            registry.cancel("owner", &id(), now).unwrap();
        }
        assert!(registry.cancel("owner", &id(), now).is_err());
        registry.prune(now + TOMBSTONE_TTL);
        registry
            .cancel("owner", &id(), now + TOMBSTONE_TTL)
            .unwrap();
        assert_eq!(registry.tombstones.len(), 1);
    }

    #[test]
    fn lease_drop_releases_exact_entry_after_error_or_cancellation() {
        let now = Instant::now();
        let request = id();
        let registry = Arc::new(Mutex::new(Registry::default()));
        let entry = registry
            .lock()
            .unwrap()
            .acquire("owner", Some(&request), now)
            .unwrap();
        let token = entry.token.clone();
        registry
            .lock()
            .unwrap()
            .cancel("owner", &request, now)
            .unwrap();
        assert!(token.canceled());
        registry
            .lock()
            .unwrap()
            .release(&entry.key, &Token(Arc::new(Control {
                canceled: AtomicBool::new(false),
                publication: Mutex::new(()),
            })));
        assert_eq!(registry.lock().unwrap().active.len(), 1);
        let lease = Lease {
            registry: registry.clone(),
            entry: Some(entry),
        };
        drop(lease);
        assert!(registry.lock().unwrap().active.is_empty());
    }

    #[test]
    fn invalid_and_noncanonical_ids_are_rejected() {
        let mut registry = Registry::default();
        assert!(registry
            .acquire("owner", Some("bad"), Instant::now())
            .is_err());
        assert!(registry.cancel("owner", "bad", Instant::now()).is_err());
    }
}
