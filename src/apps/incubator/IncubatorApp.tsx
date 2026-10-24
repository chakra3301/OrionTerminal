import { BookOpen, FlaskConical, Info, PanelsTopLeft } from "lucide-react";
import { SkillIntakePanel } from "@/features/intake/SkillIntakePanel";
import { useControlPanel } from "@/store/controlPanelStore";
import "./incubator.css";

export function IncubatorApp() {
  return <main className="incubator-app">
    <header className="incubator-header">
      <div className="incubator-brand">
        <span className="incubator-mark" aria-hidden="true"><FlaskConical size={22} strokeWidth={1.5} /></span>
        <div><h1>Incubator</h1><p>A place for new skills and apps.</p></div>
      </div>
      <nav className="incubator-destinations" aria-label="Installed capability managers">
        <button type="button" onClick={() => useControlPanel.getState().show("skills")}><BookOpen size={15} aria-hidden="true" />Skill Library</button>
        <button type="button" onClick={() => useControlPanel.getState().show("plugins")}><PanelsTopLeft size={15} aria-hidden="true" />Plugin Manager</button>
      </nav>
      <details className="incubator-scope" onKeyDown={(event) => {
        if (event.key === "Escape" && event.currentTarget.open) {
          event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}>
        <summary><Info size={15} aria-hidden="true" />Import guide</summary>
        <div className="incubator-guide">
          <h2>What you can bring in</h2>
          <ul>
            <li><strong>Skills</strong><span>Bring a local folder or public GitHub repository, review preserved instructions and resources, then install in Skill Codex. Explicit Orion text chat and Agent Forge attachments grant no tools.</span></li>
            <li><strong>Prepared apps</strong><span>Review a local Orion SDK package, or prepare the pinned 2048 recipe. Apps install disabled; Plugin Manager owns enablement, updates, rollback and removal. An updated native app is required.</span></li>
            <li><strong>Repository reviews</strong><span>Inspect pinned documents without running code. AI assessment requires a separate recipient and payload review; integration plans do not execute or grant access.</span></li>
          </ul>
          <p>Arbitrary repository conversion, remote connectors and managed local engines are not supported.</p>
        </div>
      </details>
    </header>
    <SkillIntakePanel presentation="workspace" />
  </main>;
}
