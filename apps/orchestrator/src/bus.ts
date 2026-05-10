import { EventEmitter } from "node:events";

// Internal event bus the orchestrator uses to fan out updates
// to the SSE stream and any in-process listeners (cron, agent, etc.).
export type BusEvent =
  | { type: "kpi.create" | "kpi.update"; data: { kpiId: string } }
  | { type: "vm.create" | "vm.update" | "vm.kill"; data: { vmId: string } }
  | { type: "vm.event"; data: { vmId: string; eventType: string; payload: unknown } }
  | { type: "chat.turn"; data: { turnId: string } }
  | { type: "eval.run"; data: { evalId: string; result: string } };

class Bus extends EventEmitter {
  publish(e: BusEvent) {
    this.emit("event", e);
  }
}

export const bus = new Bus();
bus.setMaxListeners(0);
