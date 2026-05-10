const ORCHESTRATOR = process.env.ORCHESTRATOR_URL ?? "http://host.docker.internal:8787";
const VM_ID = process.env.VM_ID!;

export async function report(type: string, payload: unknown, tokens?: number) {
  try {
    await fetch(`${ORCHESTRATOR}/api/vms/${VM_ID}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, payload, tokens }),
    });
  } catch (err) {
    console.error("[report] failed:", (err as Error).message);
  }
}

export async function reportKpi(value: string | number) {
  try {
    await fetch(`${ORCHESTRATOR}/api/vms/${VM_ID}/kpi-update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
  } catch (err) {
    console.error("[reportKpi] failed:", (err as Error).message);
  }
}
