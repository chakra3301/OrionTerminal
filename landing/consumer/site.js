const root = document.documentElement;
const downloadDialog = document.querySelector('#download-dialog');
const appDialog = document.querySelector('#app-dialog');
const menuToggle = document.querySelector('.menu-toggle');
const mobileNav = document.querySelector('#mobile-nav');
const themeToggle = document.querySelector('.theme-toggle');

const apps = {
  archives: {
    title: 'Archives 47',
    image: 'archives',
    mark: 'archives-mark',
    accent: 'var(--green)',
    description: 'A home for the things you want to remember, and the ideas you haven’t finished yet.',
    features: [
      'Write notes, keep a journal and collect inspiration.',
      'Organize your knowledge with tags, collections and linked notes.',
      'Bring in an AI collaborator when you want another perspective.',
    ],
  },
  orion: {
    title: 'Orion',
    image: 'orion',
    mark: 'editor-mark',
    accent: 'var(--cyan)',
    description: 'Turn an idea into something that works, with your files, editor and terminal together.',
    features: [
      'Work with a code editor, file tree and integrated terminal.',
      'See what you’re building in a live preview.',
      'Ask a supported AI provider for help with your code.',
    ],
  },
  xdesign: {
    title: 'XDesign',
    image: 'xdesign',
    mark: 'xdesign-mark',
    accent: 'var(--pink)',
    description: 'A visual space to try things out, shape an idea and bring a design to life.',
    features: [
      'Compose designs with a canvas, layers and vector tools.',
      'Explore layouts, brand systems and visual compositions.',
      'Collaborate with AI and export your work.',
    ],
  },
};

function setMenu(open) {
  mobileNav.hidden = !open;
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  menuToggle.querySelector('use').setAttribute('href', `assets/icons.svg#${open ? 'x' : 'menu'}`);
}

menuToggle.addEventListener('click', () => setMenu(mobileNav.hidden));
mobileNav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !mobileNav.hidden) {
    setMenu(false);
    menuToggle.focus();
  }
});
window.matchMedia('(min-width: 701px)').addEventListener('change', event => {
  if (event.matches) setMenu(false);
});

document.querySelectorAll('[data-download]').forEach(button => {
  button.addEventListener('click', () => {
    // Closing a sheet restores its original opener before the next modal takes focus.
    if (appDialog.open) appDialog.close();
    if (!mobileNav.hidden) {
      menuToggle.focus();
      setMenu(false);
    }
    if (!downloadDialog.open) downloadDialog.showModal();
  });
});

document.querySelectorAll('[data-app]').forEach(button => {
  button.addEventListener('click', () => {
    const app = apps[button.dataset.app];
    if (!app) return;
    document.querySelector('#app-dialog-title').textContent = app.title;
    document.querySelector('#app-dialog-description').textContent = app.description;
    const image = document.querySelector('#app-dialog-image');
    image.src = `assets/${app.image}-capture.webp`;
    image.alt = `${app.title} actual app capture`;
    image.width = 2048;
    image.height = app.image === 'orion' ? 914 : 1170;
    document.querySelector('#app-dialog-mark').src = `assets/${app.mark}.webp`;
    appDialog.style.setProperty('--app-accent', app.accent);
    const features = document.querySelector('#app-dialog-features');
    features.replaceChildren(...app.features.map(text => {
      const li = document.createElement('li');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      icon.classList.add('icon');
      icon.setAttribute('aria-hidden', 'true');
      use.setAttribute('href', 'assets/icons.svg#check');
      icon.append(use);
      const label = document.createElement('span');
      label.textContent = text;
      li.append(icon, label);
      return li;
    }));
    if (!appDialog.open) appDialog.showModal();
  });
});

document.querySelectorAll('dialog').forEach(dialog => {
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  // Explicit wrapping avoids a browser-chrome focus stop at the native modal boundary.
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')]
      .filter(element => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    const active = document.activeElement;
    if ((!event.shiftKey && active === last) || (event.shiftKey && active === first)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      dialog.close();
    }
  });
});

function setTheme(theme) {
  root.dataset.theme = theme;
  const dark = theme === 'dark';
  themeToggle.setAttribute('aria-label', dark ? 'Switch to day mode' : 'Switch to night mode');
  themeToggle.querySelector('span').textContent = dark ? 'Day mode' : 'Night mode';
  themeToggle.querySelector('use').setAttribute('href', `assets/icons.svg#${dark ? 'sun' : 'moon'}`);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0b1420' : '#f2f8fc';
}

// The supplied reference is a daylight art direction; night mode is an explicit choice.
try {
  if (localStorage.getItem('orion-consumer-theme') === 'dark') setTheme('dark');
} catch { /* Storage may be unavailable; the page remains fully usable. */ }
themeToggle.addEventListener('click', () => {
  const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(theme);
  try { localStorage.setItem('orion-consumer-theme', theme); } catch { /* Session-only preference. */ }
});
