import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * Load the nearest `.env` file (walking up from cwd) into process.env.
 * Existing environment variables always win — never override the shell.
 */
function loadNearestDotEnv(): void {
  if (process.env.MQTT_CHAT_ENV_LOADED === "1") return;
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const content = readFileSync(resolve(dir, ".env"), "utf8");
      const lines = content.split(String.fromCharCode(10));
      for (const rawLine of lines) {
        const line = rawLine.trim();
        const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (!match) continue;
        const key = match[1] ?? "";
        const raw = match[2] ?? "";
        let value = raw.trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
      }
      break;
    } catch {
      dir = resolve(dir, "..");
    }
  }
  process.env.MQTT_CHAT_ENV_LOADED = "1";
}
loadNearestDotEnv();

/**
 * Environment configuration validated at startup.
 * Applications must never read process.env directly — they load config here.
 */

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().url().or(z.string().startsWith("postgresql://")),
  REDIS_URL: z.string().min(1),

  MQTT_URL: z.string().min(1),
  MQTT_WS_URL: z.string().optional(),

  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),

  API_URL: z.string().min(1).default("http://localhost:3001"),
});

const webEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().min(1).default("http://localhost:3001"),
  NEXT_PUBLIC_MQTT_WS_URL: z.string().min(1).default("ws://localhost:8083/mqtt"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;

export class ConfigValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    const detail = issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("; ");
    super(`Invalid environment configuration: ${detail}`);
    this.name = "ConfigValidationError";
  }
}

function formatIssues(error: z.ZodError): never {
  throw new ConfigValidationError(error.issues);
}

/** Validate and return server-side environment (API, workers). */
export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) formatIssues(result.error);
  return result.data;
}

/** Validate and return browser-exposed environment (web/admin). */
export function loadWebEnv(source: Record<string, string | undefined>): WebEnv {
  const result = webEnvSchema.safeParse(source);
  if (!result.success) formatIssues(result.error);
  return result.data;
}
