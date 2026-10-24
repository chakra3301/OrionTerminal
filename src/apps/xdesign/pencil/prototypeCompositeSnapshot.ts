import { smartTextProperties } from './prototypeSmartText';

export function checkCompositeSnapshotBudget(element: HTMLElement) {
  const nodes = [element, ...element.querySelectorAll('*')];
  if (nodes.length > 180000) throw new Error('This interrupted prototype exceeds the 180,000-element visual snapshot allowance.');
  let characters = 0;
  for (const node of nodes) { for (const attribute of [...node.attributes]) characters += attribute.value.length; for (const child of node.childNodes) if (child.nodeType === Node.TEXT_NODE) characters += child.textContent?.length ?? 0; if (characters * 2 > 128 * 1024 * 1024) throw new Error('This interrupted prototype exceeds the 128 MB visual snapshot text allowance.'); }
}
export function freezePrototypeComposite(source: HTMLElement, snapshot: HTMLElement) {
  const originals = [source, ...source.querySelectorAll<HTMLElement>('*')], copies = [snapshot, ...snapshot.querySelectorAll<HTMLElement>('*')], map = new Map(originals.map((node, index) => [node, copies[index]!]));
  const properties = ['transform', 'transform-origin', 'opacity', 'width', 'height', 'background-color', 'background-image', 'border-radius', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'box-shadow', ...smartTextProperties, 'fill', 'fill-opacity', 'stroke', 'stroke-opacity'];
  for (const [node, copy] of map) {
    const style = getComputedStyle(node);
    for (const property of properties) { const value = style.getPropertyValue(property); if (value) copy.style.setProperty(property, value); }
    if (node.scrollLeft || node.scrollTop || node.hasAttribute('data-xdesign-snapshot-scroll')) copy.setAttribute('data-xdesign-snapshot-scroll', JSON.stringify({ x: node.scrollLeft, y: node.scrollTop }));
  }
  const live = [...source.children].find(node => !node.hasAttribute('data-xdesign-snapshot')), liveOrder = live ? Number.parseInt(getComputedStyle(live).zIndex) || 1 : 1;
  for (const node of source.querySelectorAll<HTMLElement>('[data-xdesign-snapshot]')) {
    const parentSnapshot = node.parentElement?.closest('[data-xdesign-snapshot]'); if (parentSnapshot && parentSnapshot !== source) continue;
    const copy = map.get(node)!; if (getComputedStyle(node).visibility === 'hidden' || Number.parseFloat(getComputedStyle(node).opacity) === 0) { copy.remove(); continue; }
    let fragment = copy, ancestor = node.parentElement, depth = 0;
    while (ancestor && ancestor !== source) {
      if (++depth > 256) throw new Error('This interrupted prototype hierarchy exceeds 256 levels.');
      const wrapper = map.get(ancestor)!.cloneNode(false) as HTMLElement; Object.assign(wrapper.style, { backgroundColor: 'transparent', backgroundImage: 'none', borderColor: 'transparent', boxShadow: 'none', pointerEvents: 'none' }); wrapper.append(fragment); fragment = wrapper; ancestor = ancestor.parentElement;
    }
    const order = node.getAttribute('data-xdesign-frozen-composite') || ((Number.parseInt(getComputedStyle(node).zIndex) || 0) > liveOrder ? 'after' : 'before');
    fragment.setAttribute('data-xdesign-frozen-composite', order); fragment.setAttribute('data-xdesign-snapshot', ''); fragment.setAttribute('inert', ''); fragment.setAttribute('aria-hidden', 'true');
    Object.assign(fragment.style, { position: 'absolute', pointerEvents: 'none' });
    for (const child of [fragment, ...fragment.querySelectorAll<HTMLElement>('*')]) { child.removeAttribute('data-xdesign-motion'); child.removeAttribute('data-xdesign-motion-state'); }
    // Retain the outgoing visual under/over the live tree; it no longer participates in matching.
    if (order === 'after') snapshot.append(fragment); else snapshot.prepend(fragment);
  }
  checkCompositeSnapshotBudget(snapshot);
}
