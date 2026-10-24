/* Event-driven depth and observer-managed ambient motion. No continuous JS loop. */
(() => {
  const root = document.documentElement;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const motionToggle = document.querySelector('.motion-toggle');
  let userReduced = false;
  try { userReduced = localStorage.getItem('orion-reduce-motion') === 'true'; } catch {}
  const hero = document.querySelector('.hero');
  const heroWorld = document.querySelector('.hero-world');
  const previews = [...document.querySelectorAll('.app-visual')];
  const ambient = [heroWorld, document.querySelector('.flow-scenes'), document.querySelector('.closing-art')].filter(Boolean);
  let observer;
  let frame = 0;
  let pointerX = 0;
  let pointerY = 0;
  let enabled = false;

  function renderDepth() {
    frame = 0;
    if (!enabled || document.hidden || !heroWorld.classList.contains('is-in-view')) return;
    const bounds = hero.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, -bounds.top / bounds.height));
    // Round to device pixels so the artwork does not linger between pixel boundaries.
    const pixel = value => Math.round(value * devicePixelRatio) / devicePixelRatio;
    heroWorld.style.setProperty('--hero-x', `${pixel(pointerX * 5)}px`);
    heroWorld.style.setProperty('--hero-y', `${pixel(progress * 9 + pointerY * 3)}px`);
  }
  function requestDepth() {
    if (!enabled || document.hidden || !heroWorld.classList.contains('is-in-view') || frame) return;
    frame = requestAnimationFrame(renderDepth);
  }
  function pointerDepth(event) {
    if (!finePointer.matches || !enabled) return;
    const bounds = hero.getBoundingClientRect();
    pointerX = Math.min(1, Math.max(-1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
    pointerY = Math.min(1, Math.max(-1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
    requestDepth();
  }
  function resetPointer() { pointerX = 0; pointerY = 0; requestDepth(); }
  function syncVisibility() {
    root.dataset.motionPaused = String(document.hidden);
    if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0; }
    if (!document.hidden) requestDepth();
  }
  function showPreview(preview) {
    preview.classList.remove('reveal-pending');
    preview.classList.add('is-revealed');
  }
  function disable() {
    enabled = false;
    observer?.disconnect();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    root.classList.remove('motion-enabled');
    previews.forEach(preview => { preview.classList.remove('reveal-pending', 'is-revealed'); });
    ambient.forEach(element => element.classList.remove('is-in-view'));
    heroWorld.style.removeProperty('--hero-x');
    heroWorld.style.removeProperty('--hero-y');
    window.removeEventListener('scroll', requestDepth);
    window.removeEventListener('resize', requestDepth);
    hero.removeEventListener('pointermove', pointerDepth);
    hero.removeEventListener('pointerleave', resetPointer);
  }
  function enable() {
    if (enabled || preference.matches || userReduced) return;
    enabled = true;
    pointerX = pointerY = 0;
    root.classList.add('motion-enabled');
    syncVisibility();
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.target.classList.contains('app-visual')) {
            if (entry.isIntersecting) { showPreview(entry.target); observer.unobserve(entry.target); }
          } else {
            entry.target.classList.toggle('is-in-view', entry.isIntersecting);
            if (entry.target === heroWorld && entry.isIntersecting) requestDepth();
          }
        }
      }, { threshold: 0.08 });
      previews.forEach((preview, index) => {
        preview.style.setProperty('--reveal-delay', `${index * 100}ms`);
        const bounds = preview.getBoundingClientRect();
        // Initial viewport content remains fully visible; only unseen previews are armed.
        if (bounds.top >= innerHeight) preview.classList.add('reveal-pending');
        else if (bounds.bottom > 0) showPreview(preview);
        observer.observe(preview);
      });
      ambient.forEach(element => observer.observe(element));
    } else {
      previews.forEach(showPreview);
      ambient.forEach(element => element.classList.add('is-in-view'));
    }
    window.addEventListener('scroll', requestDepth, { passive: true });
    window.addEventListener('resize', requestDepth, { passive: true });
    hero.addEventListener('pointermove', pointerDepth, { passive: true });
    hero.addEventListener('pointerleave', resetPointer);
  }
  // Focusing an as-yet unseen preview must always reveal it immediately.
  previews.forEach(preview => preview.addEventListener('focus', () => showPreview(preview)));
  document.addEventListener('visibilitychange', syncVisibility);
  function syncPreference() {
    const reduced = preference.matches || userReduced;
    root.dataset.reducedMotion = String(reduced);
    motionToggle.setAttribute('aria-pressed', String(reduced));
    motionToggle.textContent = preference.matches ? 'Reduced motion · system' : userReduced ? 'Motion off' : 'Reduce motion';
    motionToggle.disabled = preference.matches;
    reduced ? disable() : enable();
  }
  motionToggle.addEventListener('click', () => {
    userReduced = !userReduced;
    try { localStorage.setItem('orion-reduce-motion', String(userReduced)); } catch {}
    syncPreference();
  });
  preference.addEventListener('change', syncPreference);
  syncPreference();
})();
