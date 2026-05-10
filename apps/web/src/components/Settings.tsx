import { useEffect, useState } from "react";
import { api, type SettingsState } from "../api";

type Key = keyof SettingsState;

const FIELDS: Array<{
  key: Key;
  label: string;
  help: React.ReactNode;
  placeholder: string;
}> = [
  {
    key: "openai_api_key",
    label: "OpenAI API key",
    placeholder: "sk-…",
    help: (
      <>
        Used by the outside agent and every inside-VM agent. Falls back to{" "}
        <code className="font-mono">.env</code> if unset here. Get one at{" "}
        <a
          href="https://platform.openai.com/api-keys"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline"
        >
          platform.openai.com/api-keys
        </a>
        .
      </>
    ),
  },
  {
    key: "mulerun_session",
    label: "Mulerun session",
    placeholder: "session cookie value, or paste a JSON array of cookies",
    help: (
      <ol className="list-decimal pl-5 space-y-0.5">
        <li>Log into Mulerun in a regular browser tab.</li>
        <li>
          Open DevTools → <em>Application</em> → <em>Cookies</em> →{" "}
          <code className="font-mono">https://app.mulerun.com</code>.
        </li>
        <li>
          Copy the value of the session cookie (typically{" "}
          <code className="font-mono">session</code>,{" "}
          <code className="font-mono">sb-access-token</code>, or whatever auth cookie
          you see). Paste it below.
        </li>
        <li>
          Power user: paste a JSON array of full cookie objects (Playwright shape) for
          multi-cookie auth.
        </li>
      </ol>
    ),
  },
  {
    key: "tasklet_session",
    label: "Tasklet session",
    placeholder: "session cookie value, or paste a JSON array of cookies",
    help: (
      <ol className="list-decimal pl-5 space-y-0.5">
        <li>Log into Tasklet in a browser tab.</li>
        <li>
          DevTools → <em>Application</em> → <em>Cookies</em> →{" "}
          <code className="font-mono">https://app.tasklet.ai</code>.
        </li>
        <li>Copy the session cookie value and paste below.</li>
        <li>JSON array of cookies also accepted.</li>
      </ol>
    ),
  },
];

export function Settings() {
  const [state, setState] = useState<SettingsState | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<Key, string>>>({});
  const [showHelp, setShowHelp] = useState<Partial<Record<Key, boolean>>>({});
  const [saving, setSaving] = useState<Partial<Record<Key, boolean>>>({});
  const [reveal, setReveal] = useState<Partial<Record<Key, boolean>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then(setState).catch((e) => setError((e as Error).message));
  }, []);

  async function save(k: Key) {
    const v = drafts[k];
    if (v === undefined) return;
    setSaving((s) => ({ ...s, [k]: true }));
    setError(null);
    try {
      const next = await api.putSettings({ [k]: v });
      setState(next);
      setDrafts((d) => ({ ...d, [k]: undefined }));
      setReveal((r) => ({ ...r, [k]: false }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving((s) => ({ ...s, [k]: false }));
    }
  }

  async function clear(k: Key) {
    setSaving((s) => ({ ...s, [k]: true }));
    try {
      const next = await api.putSettings({ [k]: null });
      setState(next);
      setDrafts((d) => ({ ...d, [k]: undefined }));
    } finally {
      setSaving((s) => ({ ...s, [k]: false }));
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-sm text-muted">
        Settings are stored in <code className="font-mono">data/vibem.sqlite</code> and
        injected into each new VM as env vars. Existing VMs are not retroactively updated
        — kill and respawn to pick up changes. Plaintext storage; localhost-only.
      </div>
      {error && <div className="text-sm text-bad font-mono">{error}</div>}

      {FIELDS.map((f) => {
        const cur = state?.[f.key];
        const draftVal = drafts[f.key];
        const revealed = !!reveal[f.key];
        return (
          <div key={f.key} className="bg-panel border border-line rounded p-4 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-medium">{f.label}</h3>
              <span className="text-xs text-muted font-mono">
                {cur?.set ? `current: ${cur.preview}` : "not set"}
              </span>
            </div>

            <div className="flex gap-2">
              <input
                type={revealed ? "text" : "password"}
                placeholder={f.placeholder}
                value={draftVal ?? ""}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [f.key]: e.target.value }))
                }
                className="input flex-1"
              />
              <button
                onClick={() => setReveal((r) => ({ ...r, [f.key]: !revealed }))}
                className="px-2 py-1.5 text-xs font-mono text-muted border border-line rounded hover:text-ink"
              >
                {revealed ? "hide" : "show"}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => save(f.key)}
                disabled={saving[f.key] || !draftVal}
                className="px-3 py-1.5 rounded bg-accent text-bg font-mono text-sm disabled:opacity-50"
              >
                {saving[f.key] ? "saving…" : "save"}
              </button>
              {cur?.set && (
                <button
                  onClick={() => clear(f.key)}
                  disabled={saving[f.key]}
                  className="px-3 py-1.5 text-sm font-mono text-bad hover:underline"
                >
                  clear
                </button>
              )}
              <button
                onClick={() =>
                  setShowHelp((h) => ({ ...h, [f.key]: !h[f.key] }))
                }
                className="ml-auto text-xs text-muted hover:text-ink font-mono"
              >
                {showHelp[f.key] ? "hide help" : "how to get this"}
              </button>
            </div>

            {showHelp[f.key] && (
              <div className="text-xs text-muted bg-bg border border-line rounded p-3 leading-relaxed">
                {f.help}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
