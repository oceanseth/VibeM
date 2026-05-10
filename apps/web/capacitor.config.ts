import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.vibem.app",
  appName: "VibeM",
  webDir: "dist",
  server: {
    // For dev: point at the orchestrator host. Set ORCHESTRATOR_URL when wrapping.
    // url: "http://192.168.1.10:8787",
    cleartext: true,
  },
};

export default config;
