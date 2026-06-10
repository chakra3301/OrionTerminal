import { useMemo } from "react";
import {
  ClaudeChat,
  type ClaudeChatMessage,
} from "@/components/ClaudeChat";
import { useChatStore, type ChatMessage } from "@/store/chatStore";
import { useProjectStore } from "@/store/projectStore";
import { ipc } from "@/lib/ipc";
import { useModelPrefs } from "@/store/modelPrefsStore";
import { log } from "@/lib/log";
import { upsertChat } from "@/lib/db";
import { scheduleReindex } from "@/lib/embeddingIndexer";
import { useEffect } from "react";
import { orionClaude } from "@/apps/orion/claude";
import {
  searchContextSuggestions,
  resolveContextChips,
  buildContextBlock,
  toPill,
  type ContextChip,
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

function chatSearchableText(chat: NonNullable<ReturnType<typeof useChatStore.getState>["active"]>): string {
  const parts: string[] = [];
  for (const m of chat.messages) {
    for (const b of m.blocks) {
      if (b.type === "text" && b.text) parts.push(b.text);
    }
  }
  return parts.join("\n");
}

export function OrionClaudeRail() {
  const active = useChatStore((s) => s.active);
  const running = useChatStore((s) => s.running);
  const newChat = useChatStore((s) => s.newChat);
  const appendUserMessage = useChatStore((s) => s.appendUserMessage);
  const setRunning = useChatStore((s) => s.setRunning);
  const project = useProjectStore((s) => s.active);

  // Persist active chat on change (existing Week 1/2 behavior).
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => {
      void upsertChat({
        id: active.id,
        title: active.title,
        messages_json: JSON.stringify(active.messages),
        searchable_text: chatSearchableText(active),
        session_id: active.sessionId,
        project_id: active.projectId,
        total_cost_usd: active.totalCostUsd,
        origin: "orion",
        created_at: active.createdAt,
        updated_at: active.updatedAt,
      });
      scheduleReindex("chat", active.id, () => {
        const cur = useChatStore.getState().active;
        if (!cur || cur.id !== active.id) return null;
        return `${cur.title || "Untitled chat"}\n${chatSearchableText(cur)}`;
      });
    }, 600);
    return () => clearTimeout(id);
  }, [active]);

  const messages: ClaudeChatMessage[] = useMemo(() => {
    if (!active) return [];
    return active.messages.map((m) => ({
      id: m.id,
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: blocksToText(m) || (m.pending ? "…" : ""),
      pending: m.pending,
      pills: m.pills,
    }));
  }, [active]);

  const handleSend = async (text: string, chips?: ContextChip[]) => {
    if (!active) {
      newChat(project?.id ?? null);
    }
    const chat = useChatStore.getState().active;
    if (!chat || !project) return;

    // @-context: resolve chips to their exact content, prepend as a block,
    // and pin pill receipts on the message so what-was-sent stays visible.
    let prompt = text;
    if (chips && chips.length > 0) {
      const resolved = await resolveContextChips(chips, project.root_path);
      prompt = `${buildContextBlock(resolved)}\n\n${text}`;
      appendUserMessage(text, resolved.map(toPill));
    } else {
      appendUserMessage(text);
    }
    setRunning(true);
    try {
      await ipc.claudeSend(
        chat.id,
        prompt,
        project.root_path,
        chat.sessionId,
        null,
        useModelPrefs.getState().modelFor("orion"),
      );
    } catch (e) {
      log.error("claude_send failed", e);
      setRunning(false);
    }
  };

  const cancel = () => {
    if (!active) return;
    void ipc.claudeCancel(active.id);
  };

  const subtitle = active?.title
    ? `orix47 · ${active.title}`
    : orionClaude.subtitle;

  const disabledReason = !project
    ? "Open a project first"
    : null;

  return (
    <ClaudeChat
      appId="orion"
      name={orionClaude.name}
      subtitle={subtitle}
      accentColor={orionClaude.accentColor}
      systemPrompt={orionClaude.systemPrompt}
      openingLine={!active ? orionClaude.openingLine : undefined}
      suggestionChips={orionClaude.suggestionChips}
      placeholder={
        running ? "Claude is working… (⌘. cancel)" : "Message Claude (↵ send · ⇧↵ newline)"
      }
      disabledReason={disabledReason}
      messages={messages}
      running={running}
      cost={active?.totalCostUsd}
      onSend={handleSend}
      onCancel={cancel}
      onNewChat={() => newChat(project?.id ?? null)}
      contextSearch={(q) =>
        searchContextSuggestions(q, project?.root_path ?? null)
      }
    />
  );
}
