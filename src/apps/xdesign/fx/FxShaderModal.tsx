/**
 * Custom-shader editor — Monaco (lazy, own chunk) + live GLSL validation
 * against the real wrapper + "ask Claude" generation. Opens from the
 * inspector of a Custom shader layer.
 */

import { lazy, Suspense, useState } from "react";
import { X, Check, Sparkles, LoaderCircle } from "lucide-react";
import { useFxStore } from "./fxStore";
import { validateFxShader } from "./compositor";
import { generateFxShader } from "./fxClaude";
import { toast } from "@/store/toastStore";
import { log } from "@/lib/log";

const Monaco = lazy(() => import("@monaco-editor/react"));

export function FxShaderModal({
  layerId,
  initialCode,
  onClose,
}: {
  layerId: string;
  initialCode: string;
  onClose: () => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  const validate = (src: string): boolean => {
    const err = validateFxShader(src);
    setError(err);
    setOk(!err);
    return !err;
  };

  const apply = () => {
    if (!validate(code)) return;
    useFxStore.getState().setParam(layerId, "code", code);
    onClose();
  };

  const generate = () => {
    const p = prompt.trim();
    if (!p || generating) return;
    setGenerating(true);
    setError(null);
    generateFxShader(p, code)
      .then((body) => {
        setCode(body);
        validate(body);
      })
      .catch((e) => {
        log.error("fx shader gen", e);
        toast.error("Shader generation failed", {
          body: e instanceof Error ? e.message : String(e),
        });
      })
      .finally(() => setGenerating(false));
  };

  return (
    <div className="xd-fx-modal-scrim" onClick={onClose}>
      <div className="xd-fx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="xd-fx-modal-head">
          <span>Custom shader — vec4 fxMain(vec2 uv)</span>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="xd-fx-modal-claude">
          <input
            type="text"
            className="xd-fx-text"
            placeholder="Describe an effect — e.g. “melting VHS glitch with magenta ghosting”"
            value={prompt}
            disabled={generating}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") generate();
            }}
          />
          <button
            type="button"
            className="xd-fx-modal-gen"
            disabled={generating || !prompt.trim()}
            onClick={generate}
          >
            {generating ? (
              <LoaderCircle size={13} className="xd-fx-spin" />
            ) : (
              <Sparkles size={13} />
            )}
            Generate
          </button>
        </div>
        <div className="xd-fx-modal-editor">
          <Suspense fallback={<div className="xd-fx-modal-loading">Loading editor…</div>}>
            <Monaco
              height="100%"
              language="cpp"
              theme="vs-dark"
              value={code}
              onChange={(v) => {
                setCode(v ?? "");
                setOk(false);
                setError(null);
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                wordWrap: "on",
              }}
            />
          </Suspense>
        </div>
        {error && <pre className="xd-fx-modal-err">{error}</pre>}
        {ok && !error && (
          <div className="xd-fx-modal-ok">
            <Check size={12} /> compiles clean
          </div>
        )}
        <div className="xd-fx-modal-foot">
          <button type="button" className="xd-fx-modal-btn" onClick={() => validate(code)}>
            Validate
          </button>
          <button type="button" className="xd-fx-modal-btn primary" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
