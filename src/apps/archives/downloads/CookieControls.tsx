import { useId } from "react";
import { ChevronRight } from "lucide-react";
import type { DownloadCookieChoice } from "./downloadTypes";

const BROWSERS = [["chrome","Chrome"],["chromium","Chromium"],["brave","Brave"],["edge","Microsoft Edge"],["firefox","Firefox"],["opera","Opera"],["vivaldi","Vivaldi"],["safari","Safari"]] as const;
export function CookieControls({ value, disabled, onChange, inspection = false }: { value: DownloadCookieChoice | null; disabled: boolean; onChange: (choice: DownloadCookieChoice | null) => void; inspection?: boolean }) {
  const id=useId();
  return <details className={`dl-advanced dl-cookies${inspection ? " dl-inspection-cookies" : ""}`}>
    <summary><ChevronRight size={12} aria-hidden />Browser cookies{value ? ` · ${BROWSERS.find(([key])=>key===value.browser)?.[1]}` : " · none"}</summary>
    <label htmlFor={`${id}-browser`}>Use for this {inspection ? "inspection" : "download"}</label>
    <select id={`${id}-browser`} value={value?.browser ?? ""} disabled={disabled} onChange={(e)=>onChange(e.target.value ? {browser:e.target.value as DownloadCookieChoice["browser"],profile:null} : null)}>
      <option value="">None · no browser access</option>{BROWSERS.map(([key,label])=><option key={key} value={key}>{label}</option>)}
    </select>
    {value && value.browser !== "opera" && (value.browser === "safari" ? <><label htmlFor={`${id}-profile`}>Cookie store</label><select id={`${id}-profile`} disabled={disabled} value={value.profile ?? "system"} onChange={(e)=>onChange({...value,profile:e.target.value})}><option value="system">Safari system store</option><option value="container">Safari container store</option></select></> : <><label htmlFor={`${id}-profile`}>Profile folder name</label><input id={`${id}-profile`} disabled={disabled} maxLength={64} value={value.profile ?? ""} placeholder={value.browser === "firefox" ? "Blank = most recently modified cookie database" : "Default (or Profile 1, Profile 2…)"} onChange={(e)=>onChange({...value,profile:e.target.value || null})} autoComplete="off" spellCheck={false} /></>)}
    <p>Optional. Changing this control does not read cookies. When you press {inspection ? "Inspect link" : "Download"}, a native dialog asks permission for this source and operation only. Downloads and retries require a fresh approval; inspection approval is not reused.</p>
    {value && <p>yt-dlp can read cookies for other sites in the chosen profile and may create a private temporary database copy. Orion cleans it after exit or on idle restart; diagnostics are redacted. No credentials or browser defaults are saved or sent to AI.</p>}
  </details>;
}
