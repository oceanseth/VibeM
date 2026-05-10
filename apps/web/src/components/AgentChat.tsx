import { useEffect, useRef, useState } from "react";
import { api, subscribeStream, type ChatTurn } from "../api";

export function AgentChat() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listChat().then(setTurns).catch(() => {});
    const unsub = subscribeStream((e) => {
      if (e.type === "chat.turn") {
        api.listChat().then(setTurns).catch(() => {});
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  async function send() {
    const m = draft.trim();
    if (!m) return;
    setDraft("");
    setSending(true);
    try {
      await api.sendChat(m);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto h-[calc(100vh-9rem)] flex flex-col bg-panel border border-line rounded">
      <div ref={scroller} className="flex-1 overflow-y-auto p-4 space-y-3">
        {turns.length === 0 && (
          <div className="text-muted text-sm">
            Tell the outside agent what KPIs to track and what kind of VMs to spawn. e.g.{" "}
            <em>"Create a KPI for inbound leads. Spawn 2 Tasklet VMs to scrape directories."</em>
          </div>
        )}
        {turns.map((t, i) => (
          <Turn key={i} turn={t} />
        ))}
      </div>
      <div className="border-t border-line p-2 flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter inserts a newline.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Talk to the orchestrator agent…  (Enter to send, Shift+Enter for newline)"
          rows={7}
          className="w-full resize-y bg-bg border border-line rounded px-3 py-2 text-sm font-mono outline-none focus:border-accent leading-relaxed"
        />
        <div className="flex items-center justify-between text-xs text-muted">
          <span className="font-mono">{draft.length} chars</span>
          <button
            onClick={send}
            disabled={sending || !draft.trim()}
            className="px-4 py-2 rounded bg-accent text-bg font-mono text-sm disabled:opacity-50"
          >
            send
          </button>
        </div>
      </div>
    </div>
  );
}

function Turn({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === "user";
  const isTool = turn.role === "tool";
  return (
    <div className={"flex " + (isUser ? "justify-end" : "justify-start")}>
      <div
        className={
          "max-w-[80%] rounded px-3 py-2 text-sm whitespace-pre-wrap " +
          (isUser
            ? "bg-accent/15 border border-accent/30"
            : isTool
              ? "bg-bg border border-line font-mono text-xs text-muted"
              : "bg-bg border border-line")
        }
      >
        {turn.content}
        {turn.toolCalls?.map((c, i) => (
          <div key={i} className="mt-2 text-xs font-mono text-muted">
            <span className="text-warn">→ {c.name}</span>
            <pre className="overflow-x-auto">{JSON.stringify(c.args, null, 2)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
