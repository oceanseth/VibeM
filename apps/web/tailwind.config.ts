import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0d10",
        panel: "#13161b",
        line: "#1f242c",
        ink: "#e6e8eb",
        muted: "#8a93a0",
        accent: "#7cf6c0",
        warn: "#f6c97c",
        bad: "#f67c8a",
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
