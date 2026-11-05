import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import { DEFAULT_NOTCH, type Metric, type NotchPreferences } from "./notchPreferences";

export function NotchSettings({ value, onChange, available }: { value: NotchPreferences; onChange: (patch: Partial<NotchPreferences>) => void; available: { id: Metric; title: string }[] }) {
  const names = Object.fromEntries(available.map(c => [c.id, c.id === "cpu" ? "CPU" : c.id === "memory" ? "Memory" : c.title]));
  const selected = value.metrics.filter(id => available.some(c => c.id === id));
  const order = [...selected, ...available.map(c => c.id).filter(id => !selected.includes(id))];
  const move = (index: number, direction: number) => {
    const metrics = [...value.metrics];
    const a = metrics.indexOf(selected[index]!); const b = metrics.indexOf(selected[index + direction]!);
    if (a < 0 || b < 0) return;
    [metrics[a], metrics[b]] = [metrics[b]!, metrics[a]!]; onChange({ metrics });
  };
  return <div className="ot-notch-settings">
    <div className="ot-notch-settings-row"><span>Screen edge</span><div className="ot-notch-segment" role="group" aria-label="Screen edge">
      {(["left", "right"] as const).map(edge => <button key={edge} type="button" aria-pressed={value.edge === edge} onClick={() => onChange({ edge })}>{edge}</button>)}
    </div></div>
    <label className="ot-notch-settings-row"><span>Behavior</span><select aria-label="Notch behavior" value={value.mode} onChange={e => onChange({ mode: e.target.value as NotchPreferences["mode"] })}><option value="hover">Open on hover</option><option value="always">Always show</option></select></label>
    <label className="ot-notch-slider"><span>Size <output>{Math.round(value.scale * 100)}%</output></span><input aria-label="Notch size" type="range" min="0.8" max="1.3" step="0.05" value={value.scale} onChange={e => onChange({ scale: Number(e.target.value) })} /></label>
    <label className="ot-notch-slider"><span>Position <output>{Math.round(value.position * 100)}%</output></span><input aria-label="Notch position" type="range" min="0" max="1" step="0.01" value={value.position} onChange={e => onChange({ position: Number(e.target.value) })} /></label>
    <label className="ot-notch-settings-row"><span>Surface</span><select aria-label="Notch surface" value={value.surface} onChange={e => onChange({ surface: e.target.value as NotchPreferences["surface"] })}><option value="solid">Solid black</option><option value="glass">Dark glass</option></select></label>
    <label className="ot-notch-settings-row"><span>Ring colors</span><select aria-label="Ring colors" value={value.color} onChange={e => onChange({ color: e.target.value as NotchPreferences["color"] })}><option value="usage">Usage thresholds</option><option value="app">App accents</option><option value="mono">Monochrome</option></select></label>
    <label className="ot-notch-check"><span>Show labels under readings</span><input type="checkbox" checked={value.labels} onChange={e => onChange({ labels: e.target.checked })} /></label>
    <label className="ot-notch-check"><span>Animate notch</span><input type="checkbox" checked={value.animate} onChange={e => onChange({ animate: e.target.checked })} /></label>
    <label className="ot-notch-slider"><span>Close delay <output>{value.closeDelay} ms</output></span><input aria-label="Close delay" type="range" min="200" max="1200" step="50" value={value.closeDelay} onChange={e => onChange({ closeDelay: Number(e.target.value) })} /></label>
    <h3>Visible indicators</h3>
    {order.map(metric => {
      const index = selected.indexOf(metric);
      return <div key={metric} className="ot-notch-indicator-option">
        <label><input type="checkbox" checked={index !== -1} disabled={index !== -1 && selected.length === 1} onChange={e => onChange({ metrics: e.target.checked ? [...value.metrics, metric] : value.metrics.filter(m => m !== metric) })} />{names[metric]}</label>
        {index !== -1 && <div>
          <button type="button" aria-label={`Move ${names[metric]} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></button>
          <button type="button" aria-label={`Move ${names[metric]} down`} disabled={index === selected.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></button>
        </div>}
      </div>;
    })}
    <button type="button" className="ot-notch-reset-settings" onClick={() => onChange({ ...DEFAULT_NOTCH, metrics: available.map(c => c.id) })}><RotateCcw size={12} />Restore defaults</button>
  </div>;
}
