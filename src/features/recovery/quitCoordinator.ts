type Dependencies = {
  risks: () => string[];
  confirm: (risks: string[]) => Promise<boolean>;
  decide: (id: string, allow: boolean) => Promise<void>;
  freeze: () => () => void;
  report: (error: unknown) => void;
};

export function createQuitCoordinator(deps: Dependencies) {
  let busy = false, disposed = false, lastId: string | null = null;
  let release: (() => void) | undefined;
  const thaw = () => { const done = release; release = undefined; done?.(); };
  return {
    async request(id: unknown): Promise<void> {
      if (disposed || busy || typeof id !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id) || id === lastId) return;
      busy = true; lastId = id;
      let handedOff = false;
      try {
        release = deps.freeze();
        await Promise.resolve();
        if (disposed) return;
        const risks = deps.risks();
        const allow = risks.length === 0 || await deps.confirm(risks);
        if (!disposed) {
          await deps.decide(id, allow);
          handedOff = allow;
        }
      } catch (error) {
        try { await deps.decide(id, false); } catch { /* Native requests also fail closed. */ }
        deps.report(error);
      } finally {
        // Approval schedules native exit; don't accept fresh keystrokes in that gap.
        if (!handedOff) thaw();
        else disposed = true;
        busy = false;
      }
    },
    dispose() { disposed = true; thaw(); },
  };
}
