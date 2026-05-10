import type { Kpi, Vm } from "../api";

export function KpiCard({
  kpi,
  vms,
  onSpawn,
}: {
  kpi: Kpi;
  vms: Vm[];
  onSpawn: (kpi: Kpi) => void;
}) {
  const running = vms.filter((v) => v.status === "running").length;
  return (
    <div className="bg-panel border border-line rounded p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">{kpi.name}</h3>
        <span className="text-xs text-muted font-mono">
          {running} VM{running === 1 ? "" : "s"}
        </span>
      </div>
      {kpi.description && (
        <p className="text-sm text-muted line-clamp-2">{kpi.description}</p>
      )}
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-2xl text-accent">{kpi.current ?? "—"}</span>
        {kpi.unit && <span className="text-xs text-muted">{kpi.unit}</span>}
        <span className="ml-auto text-xs text-muted">target: {kpi.target}</span>
      </div>
      <button
        onClick={() => onSpawn(kpi)}
        className="self-start px-3 py-1.5 rounded border border-accent text-accent text-sm font-mono hover:bg-accent hover:text-bg transition-colors"
      >
        + spawn vm
      </button>
    </div>
  );
}
