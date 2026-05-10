import { useState } from "react";
import type { Vm } from "../api";

const statusColor: Record<Vm["status"], string> = {
  spawning: "text-warn",
  running: "text-accent",
  paused: "text-muted",
  done: "text-muted",
  error: "text-bad",
};

export function VmCard({ vm, onKill }: { vm: Vm; onKill: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-panel border border-line rounded p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className={"font-mono " + statusColor[vm.status]}>● {vm.status}</span>
        <span className="font-mono text-muted truncate">{vm.id.slice(0, 8)}</span>
        <span className="ml-auto text-xs text-muted">{vm.provider}</span>
      </div>
      <div className="mt-1 line-clamp-2 text-muted">{vm.mission}</div>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted font-mono">
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
        <button
          onClick={onKill}
          className="ml-auto text-bad hover:underline"
          disabled={vm.status === "done"}
        >
          kill
        </button>
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
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-mono">{label}</div>
      {children}
    </div>
  );
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
