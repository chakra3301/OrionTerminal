import React from "react";

type Props = {
  children: React.ReactNode;
  /** Human label for the surface this boundary protects (e.g. "XDesign",
   * "R.O.S.I.E"). Shown in the fallback. Omit for the root boundary. */
  label?: string;
  /** Compact inline fallback (for per-surface use) vs. the full-bleed root
   * fallback. */
  compact?: boolean;
};

type State = { error: Error | null };

/** Catches render/lifecycle errors. Used at the root (whole-app fallback)
 * AND per-surface (each app window + R.O.S.I.E) so one app crashing is
 * contained to that surface instead of white-screening the shell. The
 * fallback offers a reset that clears the error and re-renders the
 * children — useful when the crash was transient. */
export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(
      `[orion] crash${this.props.label ? ` in ${this.props.label}` : ""}`,
      error,
      info,
    );
  }

  private reset = () => this.setState({ error: null });

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const where = this.props.label ?? "Orion Terminal";
    return (
      <div className={`ot-crash${this.props.compact ? " compact" : ""}`}>
        <div className="ot-crash-inner">
          <div className="ot-crash-title">{where} hit an error.</div>
          <pre className="ot-crash-trace">{error.stack || error.message}</pre>
          <button type="button" className="ot-crash-retry" onClick={this.reset}>
            Reload {where}
          </button>
        </div>
      </div>
    );
  }
}
