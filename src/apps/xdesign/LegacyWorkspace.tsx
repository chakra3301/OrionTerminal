import { useEffect } from "react";
import { Play } from "lucide-react";
import { PanelResize, PanelToggles, useEditorPanels } from "./EditorChrome";
import { XDesignToolRail } from "./ToolRail";
import { XDesignLayersPanel } from "./LayersPanel";
import { XDesignCanvas } from "./Canvas";
import { XDesignInspector } from "./Inspector";
import { XDesignClaudeRail } from "./XDesignClaudeRail";
import { XDesignAlignBar } from "./AlignBar";
import { PresentMode } from "./PresentMode";
import { HtmlArtifactPreview } from "./HtmlArtifactPreview";

export function LegacyWorkspace({ dropOver, hasFrames, present, shellEl, captureShell }: {
  dropOver: boolean; hasFrames: boolean; present: () => void;
  shellEl: HTMLDivElement | null; captureShell: (element: HTMLDivElement | null) => void;
}) {
  const panels = useEditorPanels();
  useEffect(() => { captureShell(panels.body.current); return () => captureShell(null); }, [captureShell, panels.body]);
  return <div className="xd-legacy-editor">
    <div className="xd-editor-contextbar"><div className="xd-editor-context"><strong>Design</strong><span>Infinite canvas</span></div><PanelToggles panels={panels}/></div>
    <div className="xd-shell xd-editor-body" ref={panels.body} data-overlay={panels.overlay}>
      <XDesignToolRail/>
      <aside id={panels.leftId} className="xd-editor-panel xd-editor-panel-left" aria-label="Layers and assets" hidden={!panels.left} style={{ width: panels.leftWidth }}><XDesignLayersPanel/><PanelResize side="left" panels={panels}/></aside>
      <div className={`xd-canvas-stage${dropOver ? " drop-over" : ""}`}>
        <XDesignAlignBar/><XDesignCanvas/><XDesignClaudeRail dockTarget={shellEl} launcher="hidden"/>
        {hasFrames && <button type="button" className="xd-present-launch" onClick={present} title="Present prototype" aria-label="Present prototype"><Play size={13}/></button>}
        <PresentMode/><HtmlArtifactPreview/>
      </div>
      <aside id={panels.rightId} className="xd-editor-panel xd-editor-panel-right" aria-label="Design properties" hidden={!panels.right} style={{ width: panels.rightWidth }}><XDesignInspector/><PanelResize side="right" panels={panels}/></aside>
    </div>
  </div>;
}
