export type Kpi = {
  id: string;
  name: string;
  description: string;
  target: string;
  current?: number | string | null;
  unit?: string;
  createdAt: string;
};

export type Vm = {
  id: string;
  kpiId: string;
  provider: string;
  mission: string;
  status: "spawning" | "running" | "paused" | "done" | "error";
  containerId?: string;
  startedAt: string;
  lastEventAt?: string;
  tokensUsed: number;
  steps: number;
  strategyMd?: string;
  userGuidance?: string;
  evalAfterMinutes?: number;
  evaluateAt?: string;
  evaluatedAt?: string;
  evalResult?: string;
};

export type DraftStrategy = {
  provider: string;
  mission: string;
  strategy: string;
  evalAfterMinutes: number;
};

export type Eval = {
  id: string;
  kpiId: string;
  cron: string;
  criteria: string;
  lastRunAt?: string;
  lastResult?: string;
};

export type SettingsState = Record<
  "openai_api_key" | "mulerun_session" | "tasklet_session",
  { set: boolean; preview: string }
>;

export type ChatTurn = {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: { name: string; args: unknown; result?: unknown }[];
  ts: string;
};

const base = ""; // proxied to orchestrator in dev; same-origin in prod

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  listKpis: () => j<Kpi[]>("/api/kpis"),
  createKpi: (k: Omit<Kpi, "id" | "createdAt">) =>
    j<Kpi>("/api/kpis", { method: "POST", body: JSON.stringify(k) }),
  listVms: () => j<Vm[]>("/api/vms"),
  killVm: (id: string) => j<{ ok: true }>(`/api/vms/${id}`, { method: "DELETE" }),
  draftStrategy: (kpiId: string, body: { userGuidance?: string; provider?: string }) =>
    j<DraftStrategy>(`/api/kpis/${kpiId}/draft-strategy`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  getSettings: () => j<SettingsState>("/api/settings"),
  putSettings: (body: Partial<Record<keyof SettingsState, string | null>>) =>
    j<SettingsState>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  spawnWithStrategy: (body: {
    kpiId: string;
    provider: string;
    mission: string;
    strategy: string;
    userGuidance?: string;
    evalAfterMinutes: number;
  }) => j<Vm>("/api/vms/spawn-with-strategy", { method: "POST", body: JSON.stringify(body) }),
  sendChat: (message: string) =>
    j<{ id: string }>("/api/chat", { method: "POST", body: JSON.stringify({ message }) }),
  listChat: () => j<ChatTurn[]>("/api/chat"),
};

export function subscribeStream(onEvent: (e: { type: string; data: unknown }) => void) {
  const es = new EventSource(`${base}/stream`);
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data));
    } catch {
      /* ignore */
    }
  };
  return () => es.close();
}
