import express from "express";
import { env } from "./env.js";
import "./db.js";
import { store } from "./store.js";
import { bus } from "./bus.js";
import { handleUserMessage, draftStrategy, spawnWithStrategy } from "./agent.js";
import {
  SETTING_KEYS,
  type SettingKey,
  listSettingsRedacted,
  setSetting,
  deleteSetting,
} from "./settings.js";
import { startCron } from "./cron.js";
import { killContainer } from "./docker.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---------- KPIs ----------
app.get("/api/kpis", (_req, res) => res.json(store.listKpis()));
app.post("/api/kpis", (req, res) => {
  const { name, description, target, unit } = req.body ?? {};
  if (!name || !target) return res.status(400).json({ error: "name and target required" });
  res.json(store.createKpi({ name, description, target, unit }));
});

// ---------- Settings ----------
app.get("/api/settings", (_req, res) => {
  res.json(listSettingsRedacted());
});
app.put("/api/settings", (req, res) => {
  const body = req.body as Record<string, string | null | undefined>;
  if (!body || typeof body !== "object")
    return res.status(400).json({ error: "body must be an object of key/value" });
  for (const [k, v] of Object.entries(body)) {
    if (!(SETTING_KEYS as readonly string[]).includes(k)) continue;
    if (v == null || v === "") deleteSetting(k as SettingKey);
    else setSetting(k as SettingKey, String(v));
  }
  res.json(listSettingsRedacted());
});

// ---------- Strategy drafting (used by KPI card "Spawn VM" dialog) ----------
app.post("/api/kpis/:id/draft-strategy", async (req, res) => {
  try {
    const { userGuidance, provider } = req.body ?? {};
    const draft = await draftStrategy({
      kpiId: req.params.id,
      userGuidance,
      provider,
    });
    res.json(draft);
  } catch (err) {
    res.status(500).json({ error: String((err as Error).message) });
  }
});

app.post("/api/vms/spawn-with-strategy", async (req, res) => {
  const { kpiId, provider, mission, strategy, userGuidance, evalAfterMinutes } = req.body ?? {};
  if (!kpiId || !provider || !mission || !strategy)
    return res.status(400).json({ error: "kpiId, provider, mission, strategy are required" });
  try {
    const vm = await spawnWithStrategy({
      kpiId,
      provider,
      mission,
      strategy,
      userGuidance,
      evalAfterMinutes: Number(evalAfterMinutes ?? 0),
    });
    res.json(vm);
  } catch (err) {
    res.status(500).json({ error: String((err as Error).message) });
  }
});

// ---------- VMs ----------
app.get("/api/vms", (_req, res) => res.json(store.listVms()));
app.delete("/api/vms/:id", async (req, res) => {
  const vm = store.getVm(req.params.id);
  if (!vm) return res.status(404).json({ error: "not found" });
  if (vm.containerId) await killContainer(vm.id, vm.containerId);
  else store.setVmStatus(vm.id, "done");
  res.json({ ok: true });
});

// ---------- Inside-VM agent reports back here ----------
app.post("/api/vms/:id/event", (req, res) => {
  const vmId = req.params.id;
  const { type, payload, tokens } = req.body ?? {};
  store.appendVmEvent(vmId, String(type ?? "log"), payload);
  if (typeof tokens === "number") store.recordVmStep(vmId, tokens);
  res.json({ ok: true });
});

app.post("/api/vms/:id/kpi-update", (req, res) => {
  const { value } = req.body ?? {};
  const vm = store.getVm(req.params.id);
  if (!vm) return res.status(404).json({ error: "no vm" });
  store.updateKpiCurrent(vm.kpiId, String(value));
  res.json({ ok: true });
});

// ---------- Chat ----------
app.get("/api/chat", (_req, res) => res.json(store.listChat()));
app.post("/api/chat", async (req, res) => {
  const { message } = req.body ?? {};
  if (!message) return res.status(400).json({ error: "message required" });
  // Run the agent loop in the background — UI gets updates via SSE.
  handleUserMessage(String(message)).catch((err) => {
    store.appendChat("assistant", `(error: ${String(err?.message ?? err)})`);
  });
  res.json({ ok: true });
});

// ---------- SSE stream ----------
app.get("/stream", (_req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  send({ type: "hello", data: { ts: Date.now() } });
  const listener = (e: unknown) => send(e);
  bus.on("event", listener);
  // Heartbeat keeps the connection alive through proxies.
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  res.on("close", () => {
    clearInterval(ping);
    bus.off("event", listener);
  });
});

app.listen(env.PORT, () => {
  console.log(`[vibem] orchestrator on :${env.PORT}`);
  startCron();
});
