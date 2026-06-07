// Minimal, dependency-free markdown → HTML for rendering an agent's filed
// report. Input is escaped before any tag is emitted, so the result is safe to
// drop into dangerouslySetInnerHTML even though agent output is model-authored.
export function mdToHtml(src: string): string {
  const esc = (s: string) =>
    (s || "").replace(
      /[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c,
    );
  let h = esc(src);
  h = h.replace(
    /```([\s\S]*?)```/g,
    (_m, c: string) => "<pre>" + c.replace(/^\n/, "") + "</pre>",
  );
  h = h
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>");
  h = h.replace(/^> (.*)$/gm, "<blockquote>$1</blockquote>");
  h = h
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>");
  h = h.replace(
    /(?:^- .*(?:\n|$))+/gm,
    (m) =>
      "<ul>" +
      m
        .trim()
        .split("\n")
        .map((l) => "<li>" + l.replace(/^- /, "") + "</li>")
        .join("") +
      "</ul>",
  );
  h = h
    .split(/\n{2,}/)
    .map((b) =>
      /^<(h\d|ul|pre|blockquote)/.test(b.trim())
        ? b
        : "<p>" + b.replace(/\n/g, "<br>") + "</p>",
    )
    .join("");
  return h;
}
