const KEY = "orion-site-motion";
const mq = matchMedia("(prefers-reduced-motion: reduce)");
const listeners = new Set();

export const motion = {
  get reduced() {
    return mq.matches || document.documentElement.dataset.motion === "reduced";
  },
  get userReduced() {
    return document.documentElement.dataset.motion === "reduced";
  },
  setUserReduced(on) {
    if (on) document.documentElement.dataset.motion = "reduced";
    else delete document.documentElement.dataset.motion;
    try {
      if (on) localStorage.setItem(KEY, "reduced");
      else localStorage.removeItem(KEY);
    } catch (_) {}
    emit();
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

function emit() {
  for (const fn of listeners) fn(motion.reduced);
}
mq.addEventListener("change", emit);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolves only while the element is on screen and the tab is visible, so scripted demos never run unseen. */
export function whenVisible(el) {
  const state = { visible: false, waiters: [] };
  const flush = () => {
    if (state.visible && !document.hidden) {
      state.waiters.splice(0).forEach((r) => r());
    }
  };
  new IntersectionObserver((entries) => {
    state.visible = entries[0].isIntersecting;
    flush();
  }, { threshold: 0.15 }).observe(el);
  document.addEventListener("visibilitychange", flush);
  return () => new Promise((resolve) => {
    state.waiters.push(resolve);
    flush();
  });
}
