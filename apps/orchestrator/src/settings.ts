import { db } from "./db.js";
import { env } from "./env.js";

// Single source of truth for runtime configuration.
// Settings DB values take precedence over .env fallbacks.

// All keys we know about. Extending: add to this list and to the UI.
export const SETTING_KEYS = [
  "openai_api_key",
  "mulerun_session",
  "tasklet_session",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

// Which keys are secret (redacted in GET responses).
export const SECRET_KEYS: ReadonlySet<SettingKey> = new Set([
  "openai_api_key",
  "mulerun_session",
  "tasklet_session",
]);

export function getSetting(key: SettingKey): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: SettingKey, value: string) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value);
}

export function deleteSetting(key: SettingKey) {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}

// What the inside-VM container should be given as env. Built fresh per spawn
// so a settings change is picked up by the next VM.
export function vmEnvForSpawn(): Record<string, string> {
  const out: Record<string, string> = {};
  const openai = getSetting("openai_api_key") || env.OPENAI_API_KEY;
  if (openai) out.OPENAI_API_KEY = openai;
  const mulerun = getSetting("mulerun_session");
  if (mulerun) out.MULERUN_SESSION = mulerun;
  const tasklet = getSetting("tasklet_session");
  if (tasklet) out.TASKLET_SESSION = tasklet;
  return out;
}

export function effectiveOpenAIKey(): string {
  return getSetting("openai_api_key") || env.OPENAI_API_KEY || "";
}

// Public-safe view of all settings (secrets redacted to last 4 chars).
export function listSettingsRedacted(): Record<SettingKey, { set: boolean; preview: string }> {
  const out = {} as Record<SettingKey, { set: boolean; preview: string }>;
  for (const k of SETTING_KEYS) {
    const v = getSetting(k);
    out[k] = {
      set: !!v,
      preview: v ? redact(v) : "",
    };
  }
  return out;
}

function redact(v: string): string {
  if (v.length <= 8) return "•".repeat(v.length);
  return v.slice(0, 4) + "…" + v.slice(-4);
}
