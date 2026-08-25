import type { Config } from "tailwindcss";

/** Semantic aliases shared by the Web UI and packages/ui components. */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "var(--app)",
        surface: "var(--surface)",
        raised: "var(--raised)",
        high: "var(--high)",
        line: {
          DEFAULT: "var(--line)",
          strong: "var(--line-strong)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          2: "var(--ink-2)",
          3: "var(--ink-3)",
        },
        brand: {
          DEFAULT: "var(--brand)",
          strong: "var(--brand-strong)",
          soft: "var(--brand-soft)",
        },
        "on-brand": "var(--on-brand)",
        accent: {
          DEFAULT: "var(--accent)",
          soft: "var(--accent-soft)",
        },
        ok: {
          DEFAULT: "var(--ok)",
          soft: "var(--ok-soft)",
        },
        warn: "var(--warn)",
        danger: {
          DEFAULT: "var(--danger)",
          strong: "var(--danger-strong)",
          soft: "var(--danger-soft)",
        },
        presence: "var(--presence)",
        scrim: "var(--scrim)",
      },
      transitionDuration: {
        fast: "var(--motion-fast)",
        normal: "var(--motion-normal)",
        slow: "var(--motion-slow)",
      },
      boxShadow: {
        panel: "0 18px 55px rgba(1, 7, 18, 0.18)",
        floating: "0 20px 60px rgba(1, 7, 18, 0.32)",
      },
      zIndex: {
        banner: "60",
      },
    },
  },
  plugins: [],
};

export default config;
