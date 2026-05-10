import cron from "node-cron";
import OpenAI from "openai";
import { store } from "./store.js";
import { effectiveOpenAIKey } from "./settings.js";

function client() {
  const key = effectiveOpenAIKey();
  if (!key) throw new Error("No OpenAI key configured");
  return new OpenAI({ apiKey: key });
}
const scheduled = new Map<string, cron.ScheduledTask>();

export function startCron() {
  rescan();
  // Re-scan every minute so newly-added evals get picked up without restart.
  cron.schedule("* * * * *", rescan);
  // Per-VM deferred evals: polls every minute for VMs whose evaluate_at has passed.
  cron.schedule("* * * * *", runDueVmEvals);
}

function rescan() {
  const evals = store.listEvals();
  for (const e of evals) {
    if (scheduled.has(e.id)) continue;
    if (!cron.validate(e.cron)) continue;
    const task = cron.schedule(e.cron, () => runEval(e.id));
    scheduled.set(e.id, task);
  }
}

async function runDueVmEvals() {
  const due = store.listVmsDueForEval();
  for (const r of due) {
    try {
      const kpi = store.getKpi(r.kpi_id);
      const prompt = `Evaluate whether this VM achieved its mission.
KPI: ${kpi?.name ?? r.kpi_id} (target: ${kpi?.target ?? "?"}).
Current KPI value: ${kpi?.current ?? "unknown"}.
Mission: ${r.mission}
Strategy: ${r.strategy_md ?? "(none)"}
Admin guidance: ${r.user_guidance ?? "(none)"}
Run status: ${r.status}; steps: ${r.steps}; tokens: ${r.tokens_used}.

Respond with one line: SCORE=<0-100> followed by a one-sentence assessment of whether the strategy moved the KPI as expected.`;
      const resp = await client().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      });
      const text = resp.choices[0].message.content ?? "";
      store.setVmEvaluation(r.id, text);
      store.appendVmEvent(r.id, "eval", { result: text });
    } catch (err) {
      store.appendVmEvent(r.id, "eval_error", { message: String((err as Error).message) });
    }
  }
}

async function runEval(evalId: string) {
  const e = store.listEvals().find((x) => x.id === evalId);
  if (!e) return;
  const kpi = store.getKpi(e.kpi_id);
  if (!kpi) return;
  const recentVms = store.listVms().filter((v) => v.kpiId === e.kpi_id).slice(0, 5);

  const prompt = `Evaluate the KPI "${kpi.name}" (target: ${kpi.target}).
Current value: ${kpi.current ?? "unknown"}.
Criteria: ${e.criteria}
Recent VMs working on it:
${recentVms.map((v) => `- ${v.id} [${v.status}] ${v.steps} steps: ${v.mission}`).join("\n") || "(none)"}

Respond with one line: SCORE=<0-100> followed by a one-sentence assessment.`;

  const resp = await client().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });
  const text = resp.choices[0].message.content ?? "";
  store.recordEvalRun(evalId, text);
}
