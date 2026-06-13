import { getActiveNoteEditor } from "@/features/notes/editorBridge";
import { useNotesStore } from "@/store/notesStore";
import { toast } from "@/store/toastStore";
import { log } from "@/lib/log";

/** Export the open note to PDF via the browser's print-to-PDF. Builds a
 * clean standalone document (title + the note's full HTML) in a hidden
 * iframe and prints it — no extra dependency, and the system "Save as PDF"
 * dialog does the rest. */
export async function exportOpenNoteToPdf(): Promise<void> {
  const active = getActiveNoteEditor();
  if (!active) {
    toast.warning("Open a note first to export it");
    return;
  }
  const note = useNotesStore.getState().notes.get(active.id);
  const title = note?.title?.trim() || "Untitled";

  let bodyHTML = "";
  try {
    bodyHTML = await active.handle.getHTML();
  } catch (e) {
    log.error("note html export failed", e);
    toast.error("Couldn't render the note for PDF");
    return;
  }

  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { margin: 22mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #16181c; line-height: 1.55; font-size: 14px; }
  h1.doc-title { font-size: 26px; font-weight: 800; margin: 0 0 18px; letter-spacing: -0.3px; }
  h1 { font-size: 21px; } h2 { font-size: 17px; } h3 { font-size: 15px; }
  pre, code { font-family: "SF Mono", ui-monospace, Menlo, monospace; }
  pre { background: #f4f5f7; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12.5px; }
  blockquote { border-left: 3px solid #c8ccd2; margin: 0; padding-left: 14px; color: #5a606a; }
  a { color: #1763d6; }
  img { max-width: 100%; }
  table { border-collapse: collapse; } td, th { border: 1px solid #d0d4da; padding: 5px 9px; }
  .bn-callout { display: flex; gap: 10px; padding: 12px 14px; border: 1px solid #c8ccd2; border-radius: 8px; background: #f7f8fa; margin: 6px 0; }
</style></head>
<body><h1 class="doc-title">${escapeHtml(title)}</h1>${bodyHTML}</body></html>`;

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => iframe.remove(), 1000);
  };
  iframe.onload = () => {
    try {
      const win = iframe.contentWindow;
      if (!win) return cleanup();
      win.focus();
      win.print();
      win.onafterprint = cleanup;
      // Safari/webview may not fire onafterprint — fall back.
      setTimeout(cleanup, 60_000);
    } catch (e) {
      log.error("print failed", e);
      toast.error("Print failed");
      cleanup();
    }
  };
  const idoc = iframe.contentDocument;
  if (!idoc) {
    iframe.remove();
    toast.error("Couldn't open the print view");
    return;
  }
  idoc.open();
  idoc.write(doc);
  idoc.close();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
