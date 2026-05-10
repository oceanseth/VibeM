import { z } from "zod";
import { getPage } from "./browser.js";
import { reportKpi } from "./report.js";

type Tool = {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  run: (args: unknown) => Promise<unknown>;
};

export const tools: Tool[] = [
  {
    name: "goto",
    description: "Navigate the browser to a URL.",
    schema: z.object({ url: z.string().url() }),
    run: async (a) => {
      const { url } = a as { url: string };
      const page = await getPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return { ok: true, title: await page.title() };
    },
  },
  {
    name: "click",
    description: "Click an element by CSS selector or visible text.",
    schema: z.object({ selector: z.string() }),
    run: async (a) => {
      const { selector } = a as { selector: string };
      const page = await getPage();
      await page.click(selector, { timeout: 10_000 });
      return { ok: true };
    },
  },
  {
    name: "type",
    description: "Type text into an input identified by selector.",
    schema: z.object({ selector: z.string(), text: z.string() }),
    run: async (a) => {
      const { selector, text } = a as { selector: string; text: string };
      const page = await getPage();
      await page.fill(selector, text, { timeout: 10_000 });
      return { ok: true };
    },
  },
  {
    name: "read",
    description:
      "Return a compressed text snapshot of the current page (visible text + interactive elements).",
    schema: z.object({}),
    run: async () => {
      const page = await getPage();
      const snapshot = await page.evaluate(() => {
        const text = (document.body?.innerText ?? "").slice(0, 8000);
        const els = Array.from(
          document.querySelectorAll("a,button,input,textarea,select,[role='button']")
        )
          .slice(0, 60)
          .map((el) => {
            const e = el as HTMLElement;
            const tag = e.tagName.toLowerCase();
            const id = e.id ? `#${e.id}` : "";
            const name = (e as HTMLInputElement).name ? `[name=${(e as HTMLInputElement).name}]` : "";
            const label = (e.innerText || (e as HTMLInputElement).placeholder || "").slice(0, 60);
            return `${tag}${id}${name} :: ${label}`;
          });
        return { url: location.href, title: document.title, text, els };
      });
      return snapshot;
    },
  },
  {
    name: "screenshot",
    description: "Take a PNG screenshot and return base64 (caller can post to orchestrator).",
    schema: z.object({}),
    run: async () => {
      const page = await getPage();
      const buf = await page.screenshot({ fullPage: false });
      return { base64: buf.toString("base64") };
    },
  },
  {
    name: "report_kpi",
    description: "Report the current KPI value back to the orchestrator dashboard.",
    schema: z.object({ value: z.union([z.string(), z.number()]) }),
    run: async (a) => {
      const { value } = a as { value: string | number };
      await reportKpi(value);
      return { ok: true };
    },
  },
  {
    name: "done",
    description: "Mark the mission complete. Stops the agent loop.",
    schema: z.object({ summary: z.string() }),
    run: async (a) => a,
  },
];

export const toolDefs = tools.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: zodToJson(t.schema),
  },
}));

function zodToJson(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = zodToJson(v);
      if (!(v instanceof z.ZodOptional)) required.push(k);
    }
    return { type: "object", properties, required, additionalProperties: false };
  }
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodUnion) return { anyOf: schema._def.options.map(zodToJson) };
  return { type: "string" };
}
