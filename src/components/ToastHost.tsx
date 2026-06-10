import { useToasts } from "@/store/toastStore";

/** Bottom-right toast stack. Mount once in the Shell. */
export function ToastHost() {
  const visible = useToasts((s) => s.visible);
  const dismiss = useToasts((s) => s.dismiss);
  const pause = useToasts((s) => s.pause);
  const resume = useToasts((s) => s.resume);

  if (visible.length === 0) return null;

  return (
    <div className="ot-toasts" aria-label="Notifications">
      {visible.map((t) => (
        <div
          key={t.id}
          className={`ot-toast ${t.kind}`}
          role={t.kind === "error" ? "alert" : "status"}
          onMouseEnter={() => pause(t.id)}
          onMouseLeave={() => resume(t.id)}
        >
          <div className="ot-toast-main">
            <div className="ot-toast-title">{t.title}</div>
            {t.body && <div className="ot-toast-body">{t.body}</div>}
          </div>
          {t.action && (
            <button
              type="button"
              className="ot-toast-action"
              onClick={() => {
                void t.action?.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            className="ot-toast-x"
            title="Dismiss"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
