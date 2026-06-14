import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useToasts, unreadCount } from "@/store/toastStore";

/** Compact relative age for the notification list. */
function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Menubar notification center — a bell with an unread badge and a dropdown
 * panel over the toastStore history ring (every app's toasts land here). */
export function NotificationCenter() {
  const history = useToasts((s) => s.history);
  const lastReadAt = useToasts((s) => s.lastReadAt);
  const markAllRead = useToasts((s) => s.markAllRead);
  const clearHistory = useToasts((s) => s.clearHistory);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const unread = unreadCount(history, lastReadAt);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    markAllRead();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      clearInterval(tick);
    };
  }, [open, markAllRead]);

  return (
    <div className="ot-notif" ref={ref}>
      <button
        type="button"
        className={`ot-notif-bell${unread > 0 ? " has-unread" : ""}`}
        title={unread > 0 ? `${unread} new notification${unread > 1 ? "s" : ""}` : "Notifications"}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={13} />
        {unread > 0 && (
          <span className="ot-notif-badge">{unread > 9 ? "9+" : unread}</span>
        )}
      </button>
      {open && (
        <div className="ot-notif-panel" role="dialog" aria-label="Notifications">
          <div className="ot-notif-head">
            <span>Notifications</span>
            {history.length > 0 && (
              <button
                type="button"
                className="ot-notif-clear"
                onClick={() => clearHistory()}
              >
                Clear all
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <div className="ot-notif-empty">You&rsquo;re all caught up.</div>
          ) : (
            <div className="ot-notif-list scroll">
              {history.map((t) => (
                <div key={t.id} className={`ot-notif-item ${t.kind}`}>
                  <span className="ot-notif-dot" />
                  <div className="ot-notif-main">
                    <div className="ot-notif-title">{t.title}</div>
                    {t.body && <div className="ot-notif-body">{t.body}</div>}
                  </div>
                  <span className="ot-notif-time">{ago(now - t.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
