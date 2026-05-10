import OpenAI from "openai";
import { tools, toolDefs } from "./tools.js";
import { closeBrowser } from "./browser.js";
import { report } from "./report.js";

const KPI_ID = process.env.KPI_ID!;
const PROVIDER = process.env.PROVIDER ?? "generic";
const MISSION = process.env.MISSION ?? "Optimize the assigned KPI.";
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 2_000_000);
// How many recent messages to keep in the context window. Older messages
// are dropped (system prompt is always preserved). Keeps cost bounded over
// long-running sessions without hard-stopping the loop.
const CONTEXT_WINDOW = Number(process.env.CONTEXT_WINDOW ?? 40);
// Small delay between iterations so a runaway loop is interruptible and
// doesn't pin a CPU core.
const STEP_DELAY_MS = Number(process.env.STEP_DELAY_MS ?? 250);

const SYSTEM = `You are a VibeM inside-VM agent. You drive a headless browser to optimize a KPI by interacting with the provider "${PROVIDER}".
KPI id: ${KPI_ID}
Mission: ${MISSION}

You run continuously. There is NO "done" tool — keep working toward the KPI until the orchestrator pauses you.

Workflow:
1. goto the provider site
2. read the page (cheaper than screenshot)
3. click/type to navigate and submit work
4. report_kpi with current numbers when known
5. report_milestone whenever you complete a meaningful chunk
6. loop back: pick the next concrete action and execute it

When you finish one task, immediately pick the next one that moves the KPI. Do not wait for confirmation. Examples of "next action": find another thread to engage with, refresh a metric, try a different search query, follow up on a previous post.

Be efficient. Prefer "read" over "screenshot" — text snapshots are cheaper. Avoid repeating the same action; vary your approach if a strategy isn't working.`;

let shuttingDown = false;
process.on("SIGTERM", () => {
  shuttingDown = true;
});
process.on("SIGINT", () => {
  shuttingDown = true;
});

async function main() {
  await report("start", { provider: PROVIDER, mission: MISSION });
  const openai = new OpenAI();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: "Begin. Pick the first action." },
  ];

  let totalTokens = 0;
  let step = 0;

  while (!shuttingDown) {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: toolDefs,
      tool_choice: "auto",
    });
    const used = resp.usage?.total_tokens ?? 0;
    totalTokens += used;
    await report("step", { step, tokens: used, totalTokens }, used);

    if (totalTokens > MAX_TOKENS) {
      // Soft budget cap — exit so the dashboard shows it and the user can
      // decide whether to resume with a larger budget.
      await report("budget_exceeded", { totalTokens, max: MAX_TOKENS });
      break;
    }

    const msg = resp.choices[0].message;

    if (msg.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: msg.tool_calls,
      });

      for (const tc of msg.tool_calls) {
        const tool = tools.find((t) => t.name === tc.function.name);
        let result: unknown;
        let argsParsed: unknown;
        try {
          argsParsed = JSON.parse(tc.function.arguments || "{}");
          result = tool ? await tool.run(argsParsed) : { error: "unknown tool" };
        } catch (e) {
          result = { error: String((e as Error).message) };
        }
        await report("tool", { name: tc.function.name, args: argsParsed, result: summarize(result) });

        // Strip image bytes from the messages context (token-heavy).
        const forModel =
          tc.function.name === "screenshot" && (result as { base64?: string })?.base64
            ? { ok: true, note: "screenshot taken (binary stripped from context)" }
            : result;

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(forModel).slice(0, 6000),
        });
      }
    } else {
      // Model didn't call any tool — it probably thinks the task is done or
      // is asking for input. Nudge it back to action.
      const content = msg.content ?? "";
      await report("assistant", { content });
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content:
          "Continue working toward the KPI. What's the next concrete action you'll take? Pick one and execute it via tools — don't ask for confirmation.",
      });
    }

    // Sliding window so long-running sessions don't blow the context.
    // Keep the system message + the last CONTEXT_WINDOW turns.
    if (messages.length > CONTEXT_WINDOW + 1) {
      messages.splice(1, messages.length - 1 - CONTEXT_WINDOW);
    }

    step++;
    if (STEP_DELAY_MS > 0) await sleep(STEP_DELAY_MS);
  }

  await report("end", { totalTokens, step, reason: shuttingDown ? "sigterm" : "budget" });
  await closeBrowser();
  process.exit(0);
}

function summarize(v: unknown): unknown {
  const s = JSON.stringify(v ?? null);
  return s.length > 400 ? s.slice(0, 400) + "…" : v;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch(async (err) => {
  await report("error", { message: String((err as Error)?.message ?? err) });
  await closeBrowser();
  process.exit(1);
});
