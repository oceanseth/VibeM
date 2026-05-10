import Docker from "dockerode";
import { env } from "./env.js";
import { store } from "./store.js";
import { vmEnvForSpawn } from "./settings.js";

const docker = new Docker({ socketPath: env.DOCKER_SOCKET });

export type SpawnInput = {
  vmId: string;
  kpiId: string;
  provider: string;
  mission: string;
  orchestratorUrl: string;
};

export async function spawnAgentContainer(input: SpawnInput) {
  const running = store.listVms().filter((v) => v.status === "running" || v.status === "spawning").length;
  if (running >= env.MAX_VMS) {
    store.setVmStatus(input.vmId, "error");
    store.appendVmEvent(input.vmId, "error", { message: `MAX_VMS=${env.MAX_VMS} reached` });
    return;
  }

  // Settings DB > .env. Includes OPENAI_API_KEY plus any provider session tokens
  // (MULERUN_SESSION, TASKLET_SESSION, …) the user configured in Settings.
  const fromSettings = vmEnvForSpawn();
  if (!fromSettings.OPENAI_API_KEY) {
    store.setVmStatus(input.vmId, "error");
    store.appendVmEvent(input.vmId, "error", {
      message: "No OpenAI key — set one in the Settings tab before spawning.",
    });
    return;
  }
  const settingsEnv = Object.entries(fromSettings).map(([k, v]) => `${k}=${v}`);

  const container = await docker.createContainer({
    Image: env.AGENT_IMAGE,
    name: `vibem-${input.vmId}`,
    Env: [
      `VM_ID=${input.vmId}`,
      `KPI_ID=${input.kpiId}`,
      `PROVIDER=${input.provider}`,
      `MISSION=${input.mission}`,
      `ORCHESTRATOR_URL=${input.orchestratorUrl}`,
      `MAX_TOKENS=${env.MAX_TOKENS_PER_VM}`,
      `MAX_STEPS=${env.MAX_STEPS_PER_VM}`,
      ...settingsEnv,
    ],
    HostConfig: {
      AutoRemove: true,
      // Resource caps to keep one runaway VM from eating the host.
      Memory: 1024 * 1024 * 1024, // 1 GiB
      NanoCpus: 1_000_000_000, // 1 vCPU
      // Network: default bridge so the container can reach the open web + the orchestrator.
    },
  });

  await container.start();
  store.setVmStatus(input.vmId, "running", container.id);

  // Tail container logs into vm_events for visibility in the dashboard.
  const stream = await container.logs({ stdout: true, stderr: true, follow: true });
  stream.on("data", (chunk: Buffer) => {
    const line = chunk.toString("utf8").replace(/[\x00-\x1f]+/g, " ").trim();
    if (line) store.appendVmEvent(input.vmId, "log", { line });
  });
  stream.on("end", () => {
    const fresh = store.getVm(input.vmId);
    if (fresh && fresh.status !== "error") store.setVmStatus(input.vmId, "done");
  });
}

export async function killContainer(vmId: string, containerId: string) {
  try {
    const c = docker.getContainer(containerId);
    await c.stop({ t: 2 }).catch(() => {});
    await c.remove({ force: true }).catch(() => {});
  } finally {
    store.setVmStatus(vmId, "done");
  }
}
