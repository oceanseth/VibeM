import OpenAI from "openai";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { env } from "./env.js";
import { store } from "./store.js";
import { spawnAgentContainer, killContainer } from "./docker.js";
import { effectiveOpenAIKey } from "./settings.js";

// Lazy client so a settings update is picked up immediately.
function client() {
  const key = effectiveOpenAIKey();
  if (!key) throw new Error("No OpenAI key configured. Open Settings and set one.");
  return new OpenAI({ apiKey: key });
}

// Loaded once at startup. Defines triage + strategy-drafting rules.
const GUIDANCE = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(here, "../../../GUIDANCE.md"), "utf8");
  } catch {
    return "";
  }
})();

// Tools the outside admin agent can call to manage KPIs and VMs.
// Schemas are validated with zod before dispatch.
const tools = [
  {
    name: "create_kpi",
    description: "Define a new KPI to track and optimize.",
    schema: z.object({
      name: z.string(),
      description: z.string().default(""),
      target: z.string().describe("Target value or qualitative goal"),
      unit: z.string().optional(),
    }),
    run: (a: { name: string; description?: string; target: string; unit?: string }) =>
      store.createKpi(a),
  },
  {
    name: "list_kpis",
    description: "List all defined KPIs.",
    schema: z.object({}),
    run: () => store.listKpis(),
  },
  {
    name: "spawn_vm",
    description:
      "Spawn a containerized agent VM. Always include a `strategy` (one paragraph, see GUIDANCE.md) and an `evalAfterMinutes` so the work can be evaluated after the right lag.",
    schema: z.object({
      kpiId: z.string(),
      provider: z.string().describe("e.g. tasklet, mulerun, reddit, generic"),
      mission: z.string().describe("Plain-language mission for the inside-VM agent"),
      strategy: z
        .string()
        .optional()
        .describe(
          "One-paragraph strategy: what the VM will do, what signal proves it worked, when to evaluate."
        ),
      userGuidance: z
        .string()
        .optional()
        .describe("Extra constraints from the admin (tone, brands to avoid, etc.)"),
      evalAfterMinutes: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Minutes after spawn when the VM's success should be evaluated. 0 = immediate, 240 = 4h, 1440 = 24h."
        ),
    }),
    run: async (a: {
      kpiId: string;
      provider: string;
      mission: string;
      strategy?: string;
      userGuidance?: string;
      evalAfterMinutes?: number;
    }) => {
      const vm = store.createVm({
        kpiId: a.kpiId,
        provider: a.provider,
        mission: a.mission,
        strategyMd: a.strategy,
        userGuidance: a.userGuidance,
        evalAfterMinutes: a.evalAfterMinutes,
      });
      spawnAgentContainer({
        vmId: vm.id,
        kpiId: vm.kpiId,
        provider: vm.provider,
        mission: composeMission(vm.mission, a.strategy, a.userGuidance),
        orchestratorUrl: `http://host.docker.internal:${env.PORT}`,
      }).catch((err) => {
        store.setVmStatus(vm.id, "error");
        store.appendVmEvent(vm.id, "error", { message: String(err?.message ?? err) });
      });
      return vm;
    },
  },
  {
    name: "list_vms",
    description: "List all VMs and their status.",
    schema: z.object({}),
    run: () => store.listVms(),
  },
  {
    name: "kill_vm",
    description: "Stop and remove a VM container.",
    schema: z.object({ vmId: z.string() }),
    run: async (a: { vmId: string }) => {
      const vm = store.getVm(a.vmId);
      if (!vm?.containerId) return { ok: false, reason: "no container" };
      await killContainer(vm.id, vm.containerId);
      return { ok: true };
    },
  },
  {
    name: "schedule_eval",
    description: "Schedule a recurring eval against a KPI (cron syntax).",
    schema: z.object({
      kpiId: z.string(),
      cron: z.string().describe("e.g. '*/15 * * * *'"),
      criteria: z.string().describe("Plain-language eval criteria for GPT-4o to score against"),
    }),
    run: (a: { kpiId: string; cron: string; criteria: string }) => {
      const id = store.createEval(a);
      return { evalId: id };
    },
  },
] as const;

const openaiToolDefs = tools.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: zodToJson(t.schema),
  },
}));

const SYSTEM = `You are the outside orchestrator agent for VibeM.
Your job: turn the admin's intent into KPIs, eval schedules, and inside-VM agent missions.
Each VM you spawn is a Docker container running headless Chromium + GPT-4o that drives a provider site (Tasklet, Mulerun, etc.) toward a KPI.
Be concise. When you call tools, briefly explain why.
Hard limits: at most ${env.MAX_VMS} concurrent VMs. Confirm with the admin before spawning more than 2 at once.

Follow the GUIDANCE document below — it specifies how to triage one-shot vs recurring tasks, when to ask for a frequency, how to draft a per-VM strategy, and how to choose eval-after-minutes for lagging KPIs.

----- GUIDANCE.md -----
${GUIDANCE}
----- end GUIDANCE -----`;

function composeMission(mission: string, strategy?: string, userGuidance?: string) {
  const parts = [mission.trim()];
  if (strategy?.trim()) parts.push(`\n\n## Strategy\n${strategy.trim()}`);
  if (userGuidance?.trim()) parts.push(`\n\n## Admin guidance\n${userGuidance.trim()}`);
  return parts.join("");
}

// Draft a strategy for a KPI. Used by the dashboard's "Spawn VM" dialog.
export async function draftStrategy(input: {
  kpiId: string;
  userGuidance?: string;
  provider?: string;
}): Promise<{ strategy: string; mission: string; provider: string; evalAfterMinutes: number }> {
  const kpi = store.getKpi(input.kpiId);
  if (!kpi) throw new Error("kpi not found");

  const prompt = `You are drafting a strategy for an inside-VM agent that will work on a KPI.
Follow the guidance rules (lag-aware eval timing).

KPI: ${kpi.name}
Description: ${kpi.description}
Target: ${kpi.target}
Current value: ${kpi.current ?? "unknown"}
Provider hint: ${input.provider ?? "(suggest one)"}
Admin guidance (optional): ${input.userGuidance ?? "(none)"}

Respond ONLY as JSON with this shape:
{
  "provider": string,
  "mission": string,
  "strategy": string,
  "evalAfterMinutes": number
}

The "strategy" should be 1-2 paragraphs covering: what the VM will do concretely, what signal proves it worked, and why the chosen evalAfterMinutes is right.`;

  const resp = await client().chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: GUIDANCE },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });
  const text = resp.choices[0].message.content ?? "{}";
  const parsed = JSON.parse(text) as {
    provider?: string;
    mission?: string;
    strategy?: string;
    evalAfterMinutes?: number;
  };
  return {
    provider: parsed.provider ?? input.provider ?? "generic",
    mission: parsed.mission ?? "",
    strategy: parsed.strategy ?? "",
    evalAfterMinutes: Math.max(0, Math.floor(parsed.evalAfterMinutes ?? 0)),
  };
}

// Spawn a VM with an explicit strategy bundle (called by the KPI-card dialog).
export async function spawnWithStrategy(input: {
  kpiId: string;
  provider: string;
  mission: string;
  strategy: string;
  userGuidance?: string;
  evalAfterMinutes: number;
}) {
  const vm = store.createVm({
    kpiId: input.kpiId,
    provider: input.provider,
    mission: input.mission,
    strategyMd: input.strategy,
    userGuidance: input.userGuidance,
    evalAfterMinutes: input.evalAfterMinutes,
  });
  spawnAgentContainer({
    vmId: vm.id,
    kpiId: vm.kpiId,
    provider: vm.provider,
    mission: composeMission(vm.mission, input.strategy, input.userGuidance),
    orchestratorUrl: `http://host.docker.internal:${env.PORT}`,
  }).catch((err) => {
    store.setVmStatus(vm.id, "error");
    store.appendVmEvent(vm.id, "error", { message: String(err?.message ?? err) });
  });
  return vm;
}

export async function handleUserMessage(userMessage: string) {
  store.appendChat("user", userMessage);

  const messages = buildMessages();
  let safety = 0;
  while (safety++ < 10) {
    const resp = await client().chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: openaiToolDefs,
      tool_choice: "auto",
    });
    const choice = resp.choices[0];
    const msg = choice.message;

    if (msg.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: msg.tool_calls,
      });
      store.appendChat(
        "assistant",
        msg.content ?? "",
        msg.tool_calls.map((tc) => ({
          name: tc.function.name,
          args: safeParse(tc.function.arguments),
        }))
      );

      for (const tc of msg.tool_calls) {
        const tool = tools.find((t) => t.name === tc.function.name);
        let result: unknown;
        if (!tool) {
          result = { error: `unknown tool ${tc.function.name}` };
        } else {
          try {
            const args = tool.schema.parse(safeParse(tc.function.arguments));
            result = await tool.run(args as never);
          } catch (e: unknown) {
            result = { error: String((e as Error)?.message ?? e) };
          }
        }
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
        store.appendChat("tool", `${tc.function.name} → ${truncate(JSON.stringify(result), 500)}`);
      }
      continue;
    }

    store.appendChat("assistant", msg.content ?? "");
    return;
  }
  store.appendChat("assistant", "(stopped after 10 tool-loop iterations)");
}

function buildMessages(): OpenAI.Chat.ChatCompletionMessageParam[] {
  const turns = store.listChat();
  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: SYSTEM }];
  for (const t of turns) {
    if (t.role === "tool") continue; // tool turns are stored for UI; the loop reconstructs them per call
    msgs.push({ role: t.role === "user" ? "user" : "assistant", content: t.content });
  }
  return msgs;
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// Minimal zod → JSON-Schema for tool params. Keeps things dep-light.
function zodToJson(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = zodToJson(v);
      if (!(v instanceof z.ZodOptional) && !(v instanceof z.ZodDefault)) required.push(k);
    }
    return { type: "object", properties, required, additionalProperties: false };
  }
  if (schema instanceof z.ZodString) return { type: "string", description: schema.description };
  if (schema instanceof z.ZodNumber) return { type: "number", description: schema.description };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodOptional) return zodToJson(schema._def.innerType);
  if (schema instanceof z.ZodDefault) return zodToJson(schema._def.innerType);
  return { type: "string" };
}
