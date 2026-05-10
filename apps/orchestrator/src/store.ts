import { nanoid } from "nanoid";
import { db } from "./db.js";
import { bus } from "./bus.js";

export type KpiRow = {
  id: string;
  name: string;
  description: string;
  target: string;
  unit: string | null;
  current: string | null;
  created_at: string;
};

export type VmRow = {
  id: string;
  kpi_id: string;
  provider: string;
  mission: string;
  status: "spawning" | "running" | "paused" | "done" | "error";
  container_id: string | null;
  started_at: string;
  last_event_at: string | null;
  tokens_used: number;
  steps: number;
  state_json: string | null;
  strategy_md: string | null;
  user_guidance: string | null;
  eval_after_minutes: number | null;
  evaluate_at: string | null;
  evaluated_at: string | null;
  eval_result: string | null;
};

export type EvalRow = {
  id: string;
  kpi_id: string;
  cron: string;
  criteria: string;
  last_run_at: string | null;
  last_result: string | null;
};

const toApiKpi = (r: KpiRow) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  target: r.target,
  unit: r.unit ?? undefined,
  current: r.current,
  createdAt: r.created_at,
});

const toApiVm = (r: VmRow) => ({
  id: r.id,
  kpiId: r.kpi_id,
  provider: r.provider,
  mission: r.mission,
  status: r.status,
  containerId: r.container_id ?? undefined,
  startedAt: r.started_at,
  lastEventAt: r.last_event_at ?? undefined,
  tokensUsed: r.tokens_used,
  steps: r.steps,
  strategyMd: r.strategy_md ?? undefined,
  userGuidance: r.user_guidance ?? undefined,
  evalAfterMinutes: r.eval_after_minutes ?? undefined,
  evaluateAt: r.evaluate_at ?? undefined,
  evaluatedAt: r.evaluated_at ?? undefined,
  evalResult: r.eval_result ?? undefined,
});

export const store = {
  // ---------- KPIs ----------
  listKpis() {
    return db.prepare("SELECT * FROM kpis ORDER BY created_at DESC").all().map((r) => toApiKpi(r as KpiRow));
  },
  getKpi(id: string) {
    const r = db.prepare("SELECT * FROM kpis WHERE id = ?").get(id) as KpiRow | undefined;
    return r ? toApiKpi(r) : null;
  },
  createKpi(input: { name: string; description?: string; target: string; unit?: string }) {
    const id = "kpi_" + nanoid(10);
    db.prepare(
      "INSERT INTO kpis (id, name, description, target, unit) VALUES (?, ?, ?, ?, ?)"
    ).run(id, input.name, input.description ?? "", input.target, input.unit ?? null);
    bus.publish({ type: "kpi.create", data: { kpiId: id } });
    return store.getKpi(id)!;
  },
  updateKpiCurrent(id: string, current: string) {
    db.prepare("UPDATE kpis SET current = ? WHERE id = ?").run(current, id);
    bus.publish({ type: "kpi.update", data: { kpiId: id } });
  },

  // ---------- VMs ----------
  listVms() {
    return db
      .prepare("SELECT * FROM vms ORDER BY started_at DESC")
      .all()
      .map((r) => toApiVm(r as VmRow));
  },
  getVm(id: string) {
    const r = db.prepare("SELECT * FROM vms WHERE id = ?").get(id) as VmRow | undefined;
    return r ? toApiVm(r) : null;
  },
  createVm(input: {
    kpiId: string;
    provider: string;
    mission: string;
    strategyMd?: string;
    userGuidance?: string;
    evalAfterMinutes?: number;
  }) {
    const id = "vm_" + nanoid(10);
    const evaluateAt =
      input.evalAfterMinutes && input.evalAfterMinutes > 0
        ? new Date(Date.now() + input.evalAfterMinutes * 60_000).toISOString()
        : null;
    db.prepare(
      `INSERT INTO vms
        (id, kpi_id, provider, mission, status, strategy_md, user_guidance, eval_after_minutes, evaluate_at)
       VALUES (?, ?, ?, ?, 'spawning', ?, ?, ?, ?)`
    ).run(
      id,
      input.kpiId,
      input.provider,
      input.mission,
      input.strategyMd ?? null,
      input.userGuidance ?? null,
      input.evalAfterMinutes ?? null,
      evaluateAt
    );
    bus.publish({ type: "vm.create", data: { vmId: id } });
    return store.getVm(id)!;
  },
  setVmEvaluation(id: string, result: string) {
    db.prepare(
      "UPDATE vms SET evaluated_at = datetime('now'), eval_result = ? WHERE id = ?"
    ).run(result, id);
    bus.publish({ type: "vm.update", data: { vmId: id } });
  },
  listVmsDueForEval(): VmRow[] {
    return db
      .prepare(
        `SELECT * FROM vms
         WHERE evaluate_at IS NOT NULL
           AND evaluated_at IS NULL
           AND evaluate_at <= datetime('now')`
      )
      .all() as VmRow[];
  },
  setVmStatus(id: string, status: VmRow["status"], containerId?: string | null) {
    if (containerId !== undefined) {
      db.prepare("UPDATE vms SET status = ?, container_id = ? WHERE id = ?").run(status, containerId, id);
    } else {
      db.prepare("UPDATE vms SET status = ? WHERE id = ?").run(status, id);
    }
    bus.publish({ type: "vm.update", data: { vmId: id } });
  },
  recordVmStep(id: string, addTokens: number) {
    db.prepare(
      "UPDATE vms SET steps = steps + 1, tokens_used = tokens_used + ?, last_event_at = datetime('now') WHERE id = ?"
    ).run(addTokens, id);
    bus.publish({ type: "vm.update", data: { vmId: id } });
  },
  appendVmEvent(vmId: string, type: string, payload: unknown) {
    db.prepare("INSERT INTO vm_events (vm_id, type, data_json) VALUES (?, ?, ?)").run(
      vmId,
      type,
      JSON.stringify(payload ?? null)
    );
    bus.publish({ type: "vm.event", data: { vmId, eventType: type, payload } });
  },

  // ---------- Evals ----------
  listEvals() {
    return db.prepare("SELECT * FROM evals").all() as EvalRow[];
  },
  createEval(input: { kpiId: string; cron: string; criteria: string }) {
    const id = "eval_" + nanoid(10);
    db.prepare("INSERT INTO evals (id, kpi_id, cron, criteria) VALUES (?, ?, ?, ?)").run(
      id,
      input.kpiId,
      input.cron,
      input.criteria
    );
    return id;
  },
  recordEvalRun(id: string, result: string) {
    db.prepare("UPDATE evals SET last_run_at = datetime('now'), last_result = ? WHERE id = ?").run(result, id);
    bus.publish({ type: "eval.run", data: { evalId: id, result } });
  },

  // ---------- Chat ----------
  listChat() {
    const rows = db
      .prepare("SELECT * FROM chat_turns ORDER BY ts ASC")
      .all() as { id: string; role: string; content: string; tool_calls_json: string | null; ts: string }[];
    return rows.map((r) => ({
      role: r.role as "user" | "assistant" | "tool",
      content: r.content,
      toolCalls: r.tool_calls_json ? JSON.parse(r.tool_calls_json) : undefined,
      ts: r.ts,
    }));
  },
  appendChat(role: "user" | "assistant" | "tool", content: string, toolCalls?: unknown) {
    const id = "turn_" + nanoid(10);
    db.prepare("INSERT INTO chat_turns (id, role, content, tool_calls_json) VALUES (?, ?, ?, ?)").run(
      id,
      role,
      content,
      toolCalls ? JSON.stringify(toolCalls) : null
    );
    bus.publish({ type: "chat.turn", data: { turnId: id } });
    return id;
  },
};
