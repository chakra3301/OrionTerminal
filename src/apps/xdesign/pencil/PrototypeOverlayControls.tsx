import type { SceneNode } from '@open-pencil/scene-graph';
import { usePencilWorkspace } from './runtime';
import { colorHex, hexColor } from './AppearancePanel';
import { defaultOverlay, OVERLAY_POSITIONS, readPrototypeOverlay, setPrototypeOverlay } from './prototypeOverlay';
import type { DesignOverlay } from './reactExportRuntime';

export function PrototypeOverlayControls({ node }: { node: SceneNode }) {
  const editor = usePencilWorkspace(state => state.editor)!;
  const { settings, issue } = readPrototypeOverlay(node);
  const save = (next: DesignOverlay) => { try { setPrototypeOverlay(editor, node, next); } catch (error) { usePencilWorkspace.setState({ error: String(error) }); } };
  return <details className="xd-pencil-property-card"><summary>When opened as an overlay</summary>
    {issue ? <><p role="status">{issue}</p><button onClick={() => save(defaultOverlay())}>Reset overlay settings</button></> : <>
      <label>Position<select aria-label="Overlay position" value={settings.position} onChange={event => save({ ...settings, position: event.target.value as DesignOverlay['position'] })}>{OVERLAY_POSITIONS.map(position => <option key={position} value={position}>{position === 'manual' ? 'Relative to trigger' : position.replaceAll('-', ' ')}</option>)}</select></label>
      <label>Background<select aria-label="Overlay background" value={settings.background ? 'color' : 'none'} onChange={event => save({ ...settings, background: event.target.value === 'color' ? { r: 0, g: 0, b: 0, a: 0.25 } : undefined })}><option value="none">None</option><option value="color">Color</option></select></label>
      {settings.background && <><label>Color<input aria-label="Overlay background color" type="color" key={colorHex(settings.background)} defaultValue={colorHex(settings.background)} onBlur={event => save({ ...settings, background: hexColor(event.target.value, settings.background!.a) })} /></label>
        <label>Opacity (%)<input aria-label="Overlay background opacity" type="number" min={0} max={100} key={settings.background.a} defaultValue={settings.background.a * 100} onBlur={event => save({ ...settings, background: { ...settings.background!, a: event.target.valueAsNumber / 100 } })} /></label></>}
      <label><input aria-label="Close overlay on outside click" type="checkbox" checked={settings.closeOutside} onChange={event => save({ ...settings, closeOutside: event.target.checked })} />Close on outside click</label>
      {settings.position === 'manual' && <p>Set the offset on the interaction that opens or swaps this overlay.</p>}
    </>}
  </details>;
}
