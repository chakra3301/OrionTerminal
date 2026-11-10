import { CurveEditor } from "./actionControls";
import { toningCurve } from "./curveTools";
import { useHistogram, type CurvePoint } from "./toneControls";
import type { PhotoDocument } from "./types";

/** HDR Toning's Toning Curve and Histogram. The histogram is the whole image's luminosity, since HDR Toning flattens it. */
export function ToningCurve({ document, value, disabled, change }: { document?: PhotoDocument; value: unknown; disabled: boolean; change: (points: CurvePoint[]) => void }) {
  const points = toningCurve(value), bins = useHistogram(document && { document, below: false }, "luminosity")?.[0];
  const diagonal = JSON.stringify(points) === JSON.stringify(toningCurve(null));
  return <CurveEditor points={points} disabled={disabled} change={change} label="Toning Curve" bins={bins} aside={<button type="button" disabled={disabled || diagonal} onClick={() => change(toningCurve(null))}>Reset Curve</button>}/>;
}
