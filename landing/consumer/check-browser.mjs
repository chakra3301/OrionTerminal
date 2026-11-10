// Prefix this script with: const ORION_WEBSITE_SPACE = <existing space id>;
// Ego's isolated Node runtime does not forward shell environment variables.
const assert = (await import('node:assert/strict')).default;
const spaceId = Number(typeof ORION_WEBSITE_SPACE === 'undefined' ? 0 : ORION_WEBSITE_SPACE);
assert.ok(spaceId > 0, 'Pass the existing Ego task-space id; do not create a new space.');
const task = await taskSpace(spaceId);
const page = task.page('p1');
const results = [];
const record = (name, value) => { results.push({ name, value }); console.log(name, value); };

await page.cdp('Emulation.clearDeviceMetricsOverride');
await page.cdp('Emulation.setEmulatedMedia', {features:[]});
await page.goto('http://127.0.0.1:4319/consumer/');
await page.waitForFunction(() => document.fonts.status === 'loaded');
console.log(await page.snapshot({scope:'full_page'}));

await page.click('.header-download');
assert.equal(await page.evaluate(() => document.querySelector('#download-dialog').open), true);
for (let index = 0; index < 9; index++) {
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.querySelector('#download-dialog').contains(document.activeElement)), true);
}
await page.keyboard.press('Shift+Tab');
assert.equal(await page.evaluate(() => document.querySelector('#download-dialog').contains(document.activeElement)), true);
await page.keyboard.press('Escape');
assert.equal(await page.evaluate(() => document.querySelector('#download-dialog').open), false);
assert.equal(await page.evaluate(() => document.activeElement.matches('.header-download')), true);
record('Download sheet, Tab trap, Escape and focus restoration', 'pass');

for (const [key, title] of [['archives','Archives 47'],['orion','Orion'],['xdesign','XDesign']]) {
  await page.focus(`.app-copy [data-app="${key}"]`);
  await page.waitForFunction(key => getComputedStyle(document.querySelector(`.app-copy [data-app="${key}"]`).closest('.app-row')).transform === 'none', key);
  await page.click(`.app-copy [data-app="${key}"]`);
  assert.equal(await page.evaluate(() => document.querySelector('#app-dialog-title').textContent), title);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#app-dialog-features li').length), 3);
  await page.click('#app-dialog [data-download]');
  assert.equal(await page.evaluate(() => document.querySelectorAll('dialog[open]').length), 1);
  assert.equal(await page.evaluate(() => document.querySelector('#download-dialog').open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(key => document.activeElement.matches(`.app-copy [data-app="${key}"]`), key), true);
}
record('Three app sheets, download handoffs and original focus restoration', 'pass');

await page.press('.question-list details:first-child summary', 'Enter');
assert.equal(await page.evaluate(() => document.querySelector('.question-list details').open), true);
await page.press('.question-list details:first-child summary', 'Enter');
assert.equal(await page.evaluate(() => document.querySelector('.question-list details').open), false);
record('FAQ open/close', 'pass');

await page.goto('http://127.0.0.1:4319/consumer/');
await page.waitForFunction(() => document.fonts.status === 'loaded');
const responsive = [];
for (const width of [360,390,700,900,1024,1370,1920]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {width,height:900,deviceScaleFactor:1,mobile:false});
  const metrics = await page.evaluate(() => {
    const button = document.querySelector('.hero-cta').getBoundingClientRect();
    const heading = document.querySelector('h1').getBoundingClientRect();
    const nav = document.querySelector('.header-inner').getBoundingClientRect();
    const images = [...document.images].filter(image => image.complete && !image.naturalWidth).map(image => image.getAttribute('src'));
    const buttons = [...document.querySelectorAll('.button')].filter(button => button.getClientRects().length).map(button => ({
      text:button.textContent.trim(), width:button.clientWidth,scrollWidth:button.scrollWidth,
    }));
    return {width:innerWidth,overflow:document.documentElement.scrollWidth > innerWidth,
      heroButtonFits:button.right <= innerWidth && button.bottom < innerHeight,
      headingFits:heading.right <= innerWidth,navFits:nav.right <= innerWidth,
      brokenImages:images,wrappedButtons:buttons.filter(button=>button.scrollWidth > button.width)};
  });
  assert.equal(metrics.overflow, false, `${width}: page overflow`);
  assert.equal(metrics.headingFits, true, `${width}: clipped headline`);
  assert.equal(metrics.heroButtonFits, true, `${width}: hero CTA outside initial viewport`);
  assert.equal(metrics.navFits, true, `${width}: clipped navigation`);
  assert.deepEqual(metrics.brokenImages, [], `${width}: broken images`);
  assert.deepEqual(metrics.wrappedButtons, [], `${width}: button overflow`);
  responsive.push(metrics);
}
record('Responsive widths', responsive);

await page.cdp('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
await page.goto('http://127.0.0.1:4319/consumer/');
console.log(await page.snapshot());
await page.click('.menu-toggle');
assert.equal(await page.evaluate(() => document.querySelector('.menu-toggle').getAttribute('aria-expanded')), 'true');
await page.click('#mobile-nav a[href="#apps"]');
assert.equal(await page.evaluate(() => document.querySelector('#mobile-nav').hidden), true);
await page.click('.menu-toggle');
await page.keyboard.press('Escape');
assert.equal(await page.evaluate(() => document.querySelector('#mobile-nav').hidden), true);
assert.equal(await page.evaluate(() => document.activeElement.matches('.menu-toggle')), true);
await page.click('.menu-toggle');
await page.click('#mobile-nav [data-download]');
assert.equal(await page.evaluate(() => document.querySelector('#download-dialog').open), true);
assert.equal(await page.evaluate(() => document.querySelector('#mobile-nav').hidden), true);
await page.keyboard.press('Escape');
assert.equal(await page.evaluate(() => document.activeElement.matches('.menu-toggle')), true);
record('Mobile menu, anchors, Escape and modal return focus', 'pass');

await page.press('.theme-toggle', 'Enter');
assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
await page.reload();
assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
await page.press('.theme-toggle', 'Enter');
assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
record('Night mode, reload persistence and day mode', 'pass');

await page.cdp('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.hero-copy')).animationName), 'none');
assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
await page.waitForFunction(() => !document.documentElement.classList.contains('js-motion'));
assert.equal(await page.evaluate(() => document.documentElement.classList.contains('js-motion')), false);
record('Live reduced-motion setting', 'pass');

const assets = await page.evaluate(async () => {
  const urls = new Set([...document.querySelectorAll('img,link[href]')].map(element=>element.getAttribute('src') || element.getAttribute('href')).filter(url=>url&&!url.startsWith('http')));
  urls.add('site.js');urls.add('assets/icons.svg');
  return Promise.all([...urls].map(async url=>({url,status:(await fetch(url)).status})));
});
assert.ok(assets.every(asset=>asset.status === 200));
record('Local asset HTTP checks', assets);

await page.cdp('Emulation.setEmulatedMedia', {features:[]});
await page.cdp('Emulation.clearDeviceMetricsOverride');
await page.goto('http://127.0.0.1:4319/consumer/');
console.log(JSON.stringify({status:'passed',results},null,2));
