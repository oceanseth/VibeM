import { useEffect, useRef, useState } from "react";
import { api, subscribeStream, type Kpi, type Vm, type VmEvent } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";

const statusColor: Record<Vm["status"], string> = {
  spawning: "text-warn",
  running: "text-accent",
  paused: "text-muted",
  done: "text-muted",
  error: "text-bad",
};

const LIVE_STATES = new Set<Vm["status"]>(["spawning", "running"]);
const RESUMABLE = new Set<Vm["status"]>(["paused", "done", "error"]);

type Props = {
  vm: Vm;
  kpi?: Kpi;
  onPause: () => void;
  onResume: () => void;
  onKill: () => void;
};

export function VmCard({ vm, kpi, onPause, onResume, onKill }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const [events, setEvents] = useState<VmEvent[]>([]);
  const isLive = LIVE_STATES.has(vm.status);

  // When details expand: fetch the recent event log and subscribe to live updates.
  useEffect(() => {
    if (!open) return;
    let stop = false;
    api.listVmEvents(vm.id, 200).then((e) => {
      if (!stop) setEvents(e);
    });
    const unsub = subscribeStream((e) => {
      if (e.type !== "vm.event") return;
      const d = e.data as { vmId: string };
      if (d.vmId !== vm.id) return;
      // Re-fetch on any new event for this VM. Cheap; events are bounded to 200.
      api.listVmEvents(vm.id, 200).then((rows) => {
        if (!stop) setEvents(rows);
      });
    });
    return () => {
      stop = true;
      unsub();
    };
  }, [open, vm.id]);

  // Tick once a second only while the VM is alive; static when stopped.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isLive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isLive]);

  const startMs = new Date(vm.startedAt).getTime();
  const endMs = isLive
    ? now
    : vm.lastEventAt
      ? new Date(vm.lastEventAt).getTime()
      : startMs;
  const runtime = fmtHms(Math.max(0, Math.floor((endMs - startMs) / 1000)));

  return (
    <div className="bg-panel border border-line rounded p-3 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className={"font-mono " + statusColor[vm.status]}>● {vm.status}</span>
        <span className="font-mono text-muted truncate">{vm.id.slice(0, 8)}</span>
        {kpi ? (
          <span
            className="px-1.5 py-0.5 rounded bg-accent/10 border border-accent/30 text-accent text-[10px] font-mono truncate"
            title={`KPI: ${kpi.name}`}
          >
            {kpi.name}
          </span>
        ) : (
          <span
            className="px-1.5 py-0.5 rounded bg-bad/10 border border-bad/30 text-bad text-[10px] font-mono"
            title={`KPI deleted: ${vm.kpiId}`}
          >
            kpi gone
          </span>
        )}
        <span className="ml-auto text-xs text-muted shrink-0">{vm.provider}</span>
      </div>
      <div className="mt-1 line-clamp-2 text-muted">{vm.mission}</div>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted font-mono">
        <span title={vm.startedAt}>started {fmtStart(vm.startedAt)}</span>
        <span className={isLive ? "text-accent" : ""}>runtime {runtime}</span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-xs text-muted font-mono">
        <span>{vm.steps} steps</span>
        <span>{vm.tokensUsed.toLocaleString()} tok</span>
        {vm.evaluateAt && (
          <span title={vm.evaluateAt}>
            eval {vm.evaluatedAt ? "✓" : "in"} {fmtEvalDelta(vm.evaluateAt, !!vm.evaluatedAt)}
          </span>
        )}
        {(vm.strategyMd || vm.evalResult) && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-accent hover:underline"
          >
            {open ? "hide" : "details"}
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {isLive && (
            <button onClick={onPause} className="text-warn hover:underline">
              pause
            </button>
          )}
          {RESUMABLE.has(vm.status) && (
            <button onClick={onResume} className="text-accent hover:underline">
              {vm.status === "paused" ? "resume" : "restart"}
            </button>
          )}
          <button
            onClick={() => setConfirmKill(true)}
            className="text-bad hover:underline"
          >
            kill
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-2 border-t border-line pt-2">
          {vm.strategyMd && (
            <Section label="Strategy">
              <pre className="whitespace-pre-wrap text-xs text-ink/90">{vm.strategyMd}</pre>
            </Section>
          )}
          {vm.userGuidance && (
            <Section label="Admin guidance">
              <pre className="whitespace-pre-wrap text-xs text-muted">{vm.userGuidance}</pre>
            </Section>
          )}
          {vm.evalResult && (
            <Section label={`Eval (${vm.evaluatedAt})`}>
              <pre className="whitespace-pre-wrap text-xs text-warn">{vm.evalResult}</pre>
            </Section>
          )}
          <Section label={`Inner agent log (${events.length})`}>
            <EventFeed events={events} />
          </Section>
        </div>
      )}

      {confirmKill && (
        <ConfirmDialog
          title="Kill this VM?"
          danger
          confirmLabel="kill permanently"
          body={
            <div className="space-y-2">
              <p>
                This stops the container and <strong>deletes the VM record</strong> and
                its event history. The KPI itself is unaffected.
              </p>
              <p className="font-mono text-xs">
                {vm.id} · {vm.provider}
              </p>
            </div>
          }
          onCancel={() => setConfirmKill(false)}
          onConfirm={() => {
            setConfirmKill(false);
            onKill();
          }}
        />
      )}
    </div>
  );
}

function EventFeed({ events }: { events: VmEvent[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  // Auto-scroll to newest unless the user has scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [events]);

  if (events.length === 0)
    return <div className="text-xs text-muted">no events yet…</div>;

  return (
    <div
      ref={scroller}
      className="max-h-72 overflow-y-auto bg-bg border border-line rounded p-2 space-y-1 text-xs font-mono"
    >
      {events.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
    </div>
  );
}

function EventRow({ event }: { event: VmEvent }) {
  const time = new Date(event.ts.replace(" ", "T") + "Z").toLocaleTimeString();
  const color = TYPE_COLOR[event.type] ?? "text-muted";
  const summary = formatEventData(event);
  return (
    <div className="flex gap-2">
      <span className="text-muted shrink-0">{time}</span>
      <span className={"shrink-0 " + color}>{event.type}</span>
      <span className="text-ink/80 break-all">{summary}</span>
    </div>
  );
}

const TYPE_COLOR: Record<string, string> = {
  start: "text-accent",
  step: "text-muted",
  tool: "text-warn",
  assistant: "text-ink",
  log: "text-muted",
  error: "text-bad",
  eval: "text-accent",
  eval_error: "text-bad",
  end: "text-muted",
  paused: "text-warn",
  resume: "text-accent",
  budget_exceeded: "text-bad",
};

function formatEventData(e: VmEvent): string {
  const d = e.data as Record<string, unknown> | null;
  if (!d) return "";
  switch (e.type) {
    case "tool": {
      const name = String(d.name ?? "");
      const args = compactJson(d.args);
      return `${name}(${args}) → ${compactJson(d.result)}`;
    }
    case "assistant":
      return String(d.content ?? "");
    case "log":
      return String(d.line ?? "");
    case "step":
      return `step ${d.step} +${d.tokens} tok (total ${d.totalTokens ?? "?"})`;
    case "error":
    case "eval_error":
      return String(d.message ?? "");
    case "eval":
      return String(d.result ?? "");
    default:
      return compactJson(d);
  }
}

function compactJson(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  try {
    const s = JSON.stringify(v);
    return s.length > 300 ? s.slice(0, 300) + "…" : s;
  } catch {
    return String(v);
  }
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-mono">{label}</div>
      {children}
    </div>
  );
}

function fmtHms(totalSec: number) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtStart(iso: string) {
  const d = new Date(iso);
  // If today, just show the time; otherwise include short date.
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const time = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  if (sameDay) return time;
  const date = d.toLocaleDateString([], { month: "numeric", day: "numeric" });
  return `${date} ${time}`;
}

function fmtEvalDelta(iso: string, evaluated: boolean) {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const deltaMin = Math.round((t - now) / 60_000);
  if (evaluated) return new Date(iso).toLocaleTimeString();
  if (deltaMin <= 0) return "due now";
  if (deltaMin < 60) return `${deltaMin}m`;
  if (deltaMin < 1440) return `${(deltaMin / 60).toFixed(1)}h`;
  return `${(deltaMin / 1440).toFixed(1)}d`;
}
