import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// Load root .env regardless of CWD (npm workspace runs us from apps/orchestrator).
dotenv.config({ path: join(here, "../../../.env") });
dotenv.config(); // also pick up a local .env if present

// OPENAI_API_KEY is optional here — the Settings tab can supply it at runtime.
// The settings DB value (if any) takes precedence over this fallback.
export const env = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  PORT: Number(process.env.PORT ?? 8787),
  DATA_DIR: process.env.DATA_DIR ?? "./data",
  DOCKER_SOCKET: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock",
  AGENT_IMAGE: process.env.AGENT_IMAGE ?? "vibem/agent-runtime:latest",
  MAX_VMS: Number(process.env.MAX_VMS ?? 8),
  MAX_TOKENS_PER_VM: Number(process.env.MAX_TOKENS_PER_VM ?? 200_000),
  MAX_STEPS_PER_VM: Number(process.env.MAX_STEPS_PER_VM ?? 80),
};
