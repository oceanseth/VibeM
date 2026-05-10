import OpenAI from "openai";
import { tools, toolDefs } from "./tools.js";
import { closeBrowser } from "./browser.js";
import { report } from "./report.js";

const KPI_ID = process.env.KPI_ID!;
const PROVIDER = process.env.PROVIDER ?? "generic";
const MISSION = process.env.MISSION ?? "Optimize the assigned KPI.";
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 80);
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 200_000);

const SYSTEM = `You are a VibeM inside-VM agent. You drive a headless browser to optimize a KPI by interacting with the provider "${PROVIDER}".
KPI id: ${KPI_ID}
Mission: ${MISSION}

Workflow:
1. goto the provider site
2. read the page
3. click/type to navigate and submit work
4. report_kpi with current numbers when known
5. call "done" when the mission is complete or no further progress is possible

Be efficient. Prefer "read" over "screenshot" — text snapshots are cheaper.`;

async function main() {
  await report("start", { provider: PROVIDER, mission: MISSION });
  const openai = new OpenAI();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: "Begin." },
  ];

  let totalTokens = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: toolDefs,
      tool_choice: "auto",
    });
    const used = resp.usage?.total_tokens ?? 0;
    totalTokens += used;
    await report("step", { step, tokens: used }, used);

    if (totalTokens > MAX_TOKENS) {
      await report("budget_exceeded", { totalTokens });
      break;
    }

    const msg = resp.choices[0].message;

    if (!msg.tool_calls?.length) {
      await report("assistant", { content: msg.content });
      break;
    }

    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: msg.tool_calls,
    });

    let calledDone = false;
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

      // Strip image bytes from the messages context (token-heavy); keep a marker.
      const forModel =
        tc.function.name === "screenshot" && (result as { base64?: string })?.base64
          ? { ok: true, note: "screenshot taken (binary stripped from context)" }
          : result;

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(forModel).slice(0, 6000),
      });

      if (tc.function.name === "done") calledDone = true;
    }

    if (calledDone) break;
  }

  await report("end", { totalTokens });
  await closeBrowser();
  process.exit(0);
}

function summarize(v: unknown): unknown {
  const s = JSON.stringify(v ?? null);
  return s.length > 400 ? s.slice(0, 400) + "…" : v;
}

main().catch(async (err) => {
  await report("error", { message: String((err as Error)?.message ?? err) });
  await closeBrowser();
  process.exit(1);
});
