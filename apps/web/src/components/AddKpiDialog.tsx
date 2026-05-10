import { useState } from "react";
import { api } from "../api";

type Props = {
  onClose: () => void;
  onCreated: () => void;
};

export function AddKpiDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.createKpi({ name, description, target, unit: unit || undefined });
      onCreated();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const valid = name.trim() && target.trim();

  return (
    <div
      className="fixed inset-0 z-20 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-line rounded w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-4 py-3 flex items-center gap-2">
          <h3 className="font-medium">Add KPI</h3>
          <button
            onClick={onClose}
            className="ml-auto text-muted hover:text-ink text-sm font-mono"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3">
          {error && <div className="text-sm text-bad font-mono">{error}</div>}
          <Field label="Name *">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Inbound leads"
              className="input"
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What does this KPI measure and why does it matter?"
              className="textarea"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Target *">
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="e.g. 50/week"
                className="input"
              />
            </Field>
            <Field label="Unit">
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="leads, $, visits…"
                className="input"
              />
            </Field>
          </div>
        </div>

        <div className="border-t border-line px-4 py-3 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-sm font-mono text-muted hover:text-ink"
          >
            cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !valid}
            className="px-4 py-1.5 rounded bg-accent text-bg font-mono text-sm disabled:opacity-50"
          >
            {saving ? "saving…" : "create kpi"}
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
