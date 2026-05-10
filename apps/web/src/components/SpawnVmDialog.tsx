import { useEffect, useState } from "react";
import { api, type Kpi } from "../api";

type Props = {
  kpi: Kpi;
  onClose: () => void;
};

export function SpawnVmDialog({ kpi, onClose }: Props) {
  const [draftLoading, setDraftLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState("");
  const [mission, setMission] = useState("");
  const [strategy, setStrategy] = useState("");
  const [evalAfter, setEvalAfter] = useState(0);
  const [guidance, setGuidance] = useState("");
  const [spawning, setSpawning] = useState(false);

  // Auto-draft on open. The agent reads GUIDANCE.md to set sensible eval timing.
  useEffect(() => {
    void redraft(undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function redraft(extraGuidance: string | undefined) {
    setDraftLoading(true);
    setError(null);
    try {
      const d = await api.draftStrategy(kpi.id, {
        userGuidance: extraGuidance,
        provider: provider || undefined,
      });
      setProvider(d.provider);
      setMission(d.mission);
      setStrategy(d.strategy);
      setEvalAfter(d.evalAfterMinutes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDraftLoading(false);
    }
  }

  async function spawn() {
    setSpawning(true);
    setError(null);
    try {
      await api.spawnWithStrategy({
        kpiId: kpi.id,
        provider,
        mission,
        strategy,
        userGuidance: guidance || undefined,
        evalAfterMinutes: evalAfter,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSpawning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-panel border border-line rounded w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="border-b border-line px-4 py-3 flex items-center gap-2">
          <h3 className="font-medium">Spawn VM for "{kpi.name}"</h3>
          <button
            onClick={onClose}
            className="ml-auto text-muted hover:text-ink text-sm font-mono"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {draftLoading && (
            <div className="text-sm text-muted font-mono">drafting strategy with GPT-4o…</div>
          )}
          {error && <div className="text-sm text-bad font-mono">{error}</div>}

          <Field label="Your guidance (optional)">
            <textarea
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              rows={3}
              placeholder="Tone, brands to avoid, target audience, etc."
              className="textarea"
            />
            <button
              onClick={() => redraft(guidance)}
              disabled={draftLoading}
              className="mt-1 text-xs text-accent font-mono hover:underline disabled:opacity-50"
            >
              ↻ re-draft with this guidance
            </button>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider">
              <input
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Eval after (minutes)">
              <input
                type="number"
                min={0}
                value={evalAfter}
                onChange={(e) => setEvalAfter(Number(e.target.value))}
                className="input"
              />
              <div className="text-xs text-muted mt-0.5">
                {evalAfter === 0
                  ? "evaluate immediately"
                  : `evaluate ${prettyMinutes(evalAfter)} after spawn`}
              </div>
            </Field>
          </div>

          <Field label="Mission (passed to inside-VM agent)">
            <textarea
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              rows={3}
              className="textarea"
            />
          </Field>

          <Field label="Strategy (per-VM doc; stored & used by eval)">
            <textarea
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              rows={8}
              className="textarea"
            />
          </Field>
        </div>

        <div className="border-t border-line px-4 py-3 flex items-center gap-2">
          <span className="text-xs text-muted font-mono">
            target: {kpi.target}
            {kpi.unit ? ` ${kpi.unit}` : ""}
          </span>
          <button
            onClick={onClose}
            className="ml-auto px-3 py-1.5 rounded text-sm font-mono text-muted hover:text-ink"
          >
            cancel
          </button>
          <button
            onClick={spawn}
            disabled={spawning || draftLoading || !provider || !mission || !strategy}
            className="px-4 py-1.5 rounded bg-accent text-bg font-mono text-sm disabled:opacity-50"
          >
            {spawning ? "spawning…" : "spawn vm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs uppercase tracking-wider text-muted mb-1">{label}</div>
      {children}
    </label>
  );
}

function prettyMinutes(m: number) {
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${(m / 60).toFixed(m % 60 ? 1 : 0)}h`;
  return `${(m / 1440).toFixed(m % 1440 ? 1 : 0)}d`;
}
