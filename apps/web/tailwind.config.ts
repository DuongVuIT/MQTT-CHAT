import type { Config } from "tailwindcss";

/**
 * Semantic design tokens (phase-2 §4/§5): every color the app uses resolves
 * to a CSS variable defined in globals.css (dark default + light via
 * prefers-color-scheme). Components use these aliases — never raw slate/
 * indigo utilities — so the theme flips without touching markup and web
 * matches the mobile token values exactly.
 */
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
        ok: "var(--ok)",
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
      zIndex: {
        banner: "60",
      },
    },
  },
  plugins: [],
};

export default config;
