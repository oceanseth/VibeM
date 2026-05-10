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
import { killContainer, pauseContainer, spawnAgentContainer } from "./docker.js";

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
app.get("/api/vms/:id/events", (req, res) => {
  const limit = Math.min(500, Number(req.query.limit ?? 200));
  res.json(store.listVmEvents(req.params.id, limit));
});

// Pause: stop the container but keep the VM row so it can be resumed.
app.post("/api/vms/:id/pause", async (req, res) => {
  const vm = store.getVm(req.params.id);
  if (!vm) return res.status(404).json({ error: "not found" });
  if (vm.containerId) await pauseContainer(vm.id, vm.containerId);
  else store.setVmStatus(vm.id, "paused");
  res.json({ ok: true });
});

// Resume: spawn a fresh container with the same mission/strategy/guidance.
// The inside-VM agent's OpenAI conversation does not persist across runs, so
// the new run starts fresh but with the same context.
app.post("/api/vms/:id/resume", async (req, res) => {
  const vm = store.getVm(req.params.id);
  if (!vm) return res.status(404).json({ error: "not found" });
  if (vm.status === "running" || vm.status === "spawning")
    return res.status(409).json({ error: "already running" });
  store.setVmStatus(vm.id, "spawning");
  // Compose the same mission body the agent loop builds on initial spawn.
  const mission =
    vm.mission +
    (vm.strategyMd ? `\n\n## Strategy\n${vm.strategyMd}` : "") +
    (vm.userGuidance ? `\n\n## Admin guidance\n${vm.userGuidance}` : "");
  spawnAgentContainer({
    vmId: vm.id,
    kpiId: vm.kpiId,
    provider: vm.provider,
    mission,
    orchestratorUrl: `http://host.docker.internal:${env.PORT}`,
  }).catch((err) => {
    store.setVmStatus(vm.id, "error");
    store.appendVmEvent(vm.id, "error", { message: String(err?.message ?? err) });
  });
  store.appendVmEvent(vm.id, "resume", null);
  res.json({ ok: true });
});

// Kill: stop container AND delete the VM row + its events. Frontend confirms.
app.delete("/api/vms/:id", async (req, res) => {
  const vm = store.getVm(req.params.id);
  if (!vm) return res.status(404).json({ error: "not found" });
  if (vm.containerId) await killContainer(vm.id, vm.containerId);
  store.deleteVm(vm.id);
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
