// === Claude context-specific chat panel ===

function ClaudeChat({ name, sub, accent = "var(--neon-green)", systemHint, suggestions, initialMessages, onAction }) {
  const [messages, setMessages] = React.useState(initialMessages || []);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const endRef = React.useRef(null);

  React.useEffect(() => {
    if (endRef.current) endRef.current.scrollTop = endRef.current.scrollHeight;
  }, [messages, busy]);

  const send = async (text) => {
    const trimmed = (text || input).trim();
    if (!trimmed || busy) return;
    const newMsgs = [...messages, { role: "user", content: trimmed }];
    setMessages(newMsgs);
    setInput("");
    setBusy(true);
    try {
      const fullMessages = [
        ...newMsgs.map(m => ({ role: m.role, content: m.content })),
      ];
      const reply = await window.claude.complete({
        messages: fullMessages,
        system: systemHint || "You are Claude, embedded in Orion Terminal as a context-specific assistant. Reply concisely (1-3 sentences). No markdown headers.",
      });
      setMessages([...newMsgs, { role: "assistant", content: reply }]);
      onAction && onAction(reply);
    } catch (e) {
      setMessages([...newMsgs, { role: "assistant", content: "(connection blip — try again)" }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="claude-rail">
      <div className="claude-header">
        <div className="claude-orb" style={{ background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.6), transparent 50%), radial-gradient(circle at 70% 70%, ${accent}, transparent 60%), radial-gradient(circle at 30% 70%, var(--neon-cyan), transparent 60%)` }} />
        <div>
          <div className="claude-name">{name}</div>
          <div className="claude-sub">{sub}</div>
        </div>
        <div style={{ marginLeft: "auto", color: "var(--t-tertiary)" }}>
          <window.I.more size={14} />
        </div>
      </div>
      <div className="claude-messages scroll" ref={endRef}>
        {messages.length === 0 && (
          <div style={{ color: "var(--t-tertiary)", fontSize: 12, padding: "20px 4px", textAlign: "center", lineHeight: 1.6 }}>
            <window.I.sparkles size={20} stroke={accent} />
            <div style={{ marginTop: 8 }}>Ready when you are.</div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={"msg " + m.role}>{m.content}</div>
        ))}
        {busy && <div className="msg assistant thinking">thinking</div>}
      </div>
      {suggestions && suggestions.length > 0 && messages.length < 2 && (
        <div className="claude-suggest">
          {suggestions.map(s => <div key={s} className="chip" onClick={() => send(s)}>{s}</div>)}
        </div>
      )}
      <div className="claude-input">
        <textarea
          placeholder="Ask Claude…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
        />
        <button onClick={() => send()} disabled={busy || !input.trim()}>
          <window.I.send size={14} stroke="#001008" />
        </button>
      </div>
    </div>
  );
}

window.ClaudeChat = ClaudeChat;
