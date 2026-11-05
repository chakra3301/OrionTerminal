import { useEffect, useMemo, useRef, useState } from "react";
import { History } from "lucide-react";
import { useContextMenu } from "@/components/ContextMenu";
import { PastChats, chatFromRow } from "@/apps/orion/PastChats";
import { listChatsForProject } from "@/lib/db";
import { relativeTime } from "@/lib/time";
import { SkillTurnPicker } from "@/features/intake/SkillTurnPicker";
import { EMPTY_SKILL_CHOICE, type SkillTurnChoice } from "@/features/intake/skillActivation";
import {
  ClaudeChat,
  type ClaudeChatMessage,
} from "@/components/ClaudeChat";
import { useChatStore, type ChatMessage } from "@/store/chatStore";
import { useProjectStore } from "@/store/projectStore";
import { useModelPrefs } from "@/store/modelPrefsStore";
import { dispatchAgentTurn, dispatchCancel, forgetDispatch, toRuntimeHistory } from "@/features/agents/dispatchSend";
import { log } from "@/lib/log";
import { useAppConfig, resolveConfig, appFirstTurnPreamble, appAllowedTools } from "@/store/appConfigStore";
import {
  searchContextSuggestions,
  resolveContextChips,
  buildContextBlock,
  autoCodebaseContext,
  toPill,
  type ContextChip,
  type ResolvedContext,
} from "@/features/context/contextProviders";

function blocksToText(msg: ChatMessage): string {
  return msg.blocks
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "tool_use") {
        const inputStr =
          typeof b.input === "object" && b.input !== null
            ? Object.entries(b.input as Record<string, unknown>)
                .filter(([, v]) => typeof v === "string" || typeof v === "number")
                .slice(0, 1)
                .map(([, v]) => String(v))
                .join("")
            : "";
        return `\`${b.name}\`${inputStr ? ` · ${inputStr}` : ""}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export function OrionClaudeRail() {
  const active = useChatStore((s) => s.active);
  const running = useChatStore((s) => s.running);
  const newChat = useChatStore((s) => s.newChat);
  const appendUserMessage = useChatStore((s) => s.appendUserMessage);
  const setRunning = useChatStore((s) => s.setRunning);
  const project = useProjectStore((s) => s.active);
  const value = useModelPrefs((s) => s.modelFor("orion"));
  const [skillChoice, setSkillChoice] = useState<SkillTurnChoice>(EMPTY_SKILL_CHOICE);
  const alive = useRef(true), turnSequence = useRef(0), connectorStarted = useRef(false);
  const pendingChat = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; ++turnSequence.current;
      if (!connectorStarted.current && pendingChat.current) {
        forgetDispatch(pendingChat.current);
        if (useChatStore.getState().active?.id === pendingChat.current) useChatStore.getState().setRunning(false);
      }
    };
  }, []);

  const messages: ClaudeChatMessage[] = useMemo(() => {
    if (!active) return [];
    return active.messages.map((m) => ({
      id: m.id,
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: blocksToText(m) || (m.pending ? "…" : ""),
      pending: m.pending,
      planning: m.planning,
      pills: m.pills,
    }));
  }, [active]);

  const handleSend = async (text: string, chips?: ContextChip[]) => {
    if (!active) {
      newChat(project?.id ?? null);
    }
    const chat = useChatStore.getState().active;
    if (!chat || !project) throw new Error("Open a project before sending.");
    const selection = skillChoice, generation = ++turnSequence.current;
    connectorStarted.current = false;
    pendingChat.current = chat.id;
    setRunning(true);
    try {
      const resolved: ResolvedContext[] = [];
      if (chips && chips.length > 0) {
        resolved.push(...(await resolveContextChips(chips, project.root_path)));
      }
      // No explicit code context pinned → let the semantic index volunteer
      // up to 3 relevant chunks. Receipts (pills) keep it honest.
      const pinnedCode = chips?.some((c) => c.kind === "file" || c.kind === "folder");
      if (!pinnedCode) {
        try {
          resolved.push(
            ...(await autoCodebaseContext(text, project.id, project.root_path)),
          );
        } catch {
          /* index not ready yet — send without */
        }
      }
      const prompt = resolved.length > 0 ? `${buildContextBlock(resolved)}\n\n${text}` : text;
      if (!alive.current || generation !== turnSequence.current || !useChatStore.getState().running) throw new Error("Cancelled before connector start");
      await dispatchAgentTurn(
        {
          chatId: chat.id,
          value: useModelPrefs.getState().modelFor("orion"),
          prompt,
          history: [...toRuntimeHistory(chat.messages), { role: "user", content: text }],
          projectRoot: project.root_path,
          sessionId: chat.sessionId,
          imagePath: null,
          extra: { allowedTools: appAllowedTools("orion") },
          freshPreamble: appFirstTurnPreamble("orion"),
          skillContext: selection,
          onReady: (receipts) => {
            if (!alive.current || generation !== turnSequence.current || useChatStore.getState().active?.id !== chat.id || useProjectStore.getState().active?.id !== project.id || useProjectStore.getState().active?.root_path !== project.root_path) throw new Error("Chat or project changed before sending.");
            connectorStarted.current = true;
            appendUserMessage(text, [...resolved.map(toPill), ...receipts.map((p) => ({ ...p, kind: "skill", truncated: false }))]);
          },
        },
        {
          capturePlan: () => useChatStore.getState().sealPlanningTurn(),
          nextHistory: () =>
            toRuntimeHistory(useChatStore.getState().active?.messages ?? []),
        },
      );
      if (alive.current && generation === turnSequence.current) setSkillChoice((current) => current !== selection ? current : value.startsWith("agent:") ? { ...current, contextLimit: 0, selections: current.selections.map((s) => ({ ...s, paths: [] })) } : EMPTY_SKILL_CHOICE);
    } catch (e) {
      log.error("claude_send failed", e);
      if (alive.current && generation === turnSequence.current) {
        pendingChat.current = null;
        forgetDispatch(chat.id);
        if (useChatStore.getState().active?.id === chat.id) setRunning(false);
      }
      throw e;
    }
  };

  const cancel = () => {
    const chat = useChatStore.getState().active;
    if (!chat) return;
    ++turnSequence.current;
    if (!connectorStarted.current) { pendingChat.current = null; forgetDispatch(chat.id); setRunning(false); return; }
    void dispatchCancel(chat.id, useModelPrefs.getState().modelFor("orion")).catch((e) => log.error("Cancellation failed", e));
  };

  const orionCfg = useAppConfig((s) => s.configs.orion);
  const acfg = useMemo(() => resolveConfig("orion", orionCfg), [orionCfg]);
  const subtitle = active?.title
    ? `orix47 · ${active.title}`
    : acfg.subtitle;

  const disabledReason = !project
    ? "Open a project first"
    : null;

  const { openFromButton, menu } = useContextMenu();
  const openHistory = (el: HTMLElement) => {
    void listChatsForProject(project?.id ?? null)
      .then((rows) => {
        const now = Date.now();
        const items = rows
          .filter((r) => r.messages_json && r.messages_json !== "[]")
          .slice(0, 20)
          .map((r) => ({
            label: r.title || "Untitled chat",
            hint: relativeTime(r.updated_at, now),
            checked: r.id === active?.id,
            disabled: running,
            onClick: () => useChatStore.getState().setActive(chatFromRow(r)),
          }));
        openFromButton(el, items.length ? items : [{ label: "No past chats", disabled: true, onClick: () => {} }]);
      })
      .catch((e) => log.warn("chat history unavailable", e));
  };

  return (
    <>
    <ClaudeChat
      variant="agent"
      title={active?.messages.length ? active.title : undefined}
      headerActions={
        <button type="button" className="ot-agent-icon" title="Chat history" aria-label="Chat history" onClick={(e) => openHistory(e.currentTarget)}>
          <History size={14} />
        </button>
      }
      emptyState={<PastChats projectId={project?.id ?? null} />}
      appId="orion"
      name={acfg.name}
      subtitle={subtitle}
      accentColor={acfg.accentColor}
      systemPrompt={acfg.systemPrompt}
      openingLine={!active && acfg.openingLineEnabled ? acfg.openingLine : undefined}
      suggestionChips={acfg.chipsEnabled ? acfg.chips : []}
      placeholder={
        running ? `${acfg.name} is working… ⌘. to stop` : "Ask anything, @ for context"
      }
      disabledReason={disabledReason}
      messages={messages}
      running={running}
      cost={active?.totalCostUsd}
      onSend={handleSend}
      composerAccessory={(disabled) => <SkillTurnPicker value={value} chatKey={active?.id ?? "new"} choice={skillChoice} onChange={setSkillChoice} disabled={disabled} />}
      onCancel={cancel}
      onNewChat={() => newChat(project?.id ?? null)}
      contextSearch={(q) =>
        searchContextSuggestions(q, project?.root_path ?? null)
      }
    />
    {menu}
    </>
  );
}
