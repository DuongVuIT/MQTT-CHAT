import pino, { type Logger as PinoLogger, type LoggerOptions } from "pino";

/**
 * Structured logger with correlation context support:
 * requestId, eventId, messageId, conversationId, userId, botId, ruleId.
 */

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface LogContext {
  requestId?: string;
  eventId?: string;
  messageId?: string;
  conversationId?: string;
  userId?: string;
  botId?: string;
  ruleId?: string;
  [key: string]: unknown;
}

export interface Logger {
  fatal(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  debug(msg: string, ctx?: LogContext): void;
  trace(msg: string, ctx?: LogContext): void;
  child(ctx: LogContext): Logger;
}

function toPinoOptions(level: LogLevel, service: string): LoggerOptions {
  const isDev = process.env.NODE_ENV !== "production";
  return {
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname" },
          },
        }
      : {}),
  };
}

class PinoLoggerAdapter implements Logger {
  constructor(private readonly inner: PinoLogger) {}

  fatal(msg: string, ctx?: LogContext): void {
    this.inner.fatal(ctx ?? {}, msg);
  }
  error(msg: string, ctx?: LogContext): void {
    this.inner.error(ctx ?? {}, msg);
  }
  warn(msg: string, ctx?: LogContext): void {
    this.inner.warn(ctx ?? {}, msg);
  }
  info(msg: string, ctx?: LogContext): void {
    this.inner.info(ctx ?? {}, msg);
  }
  debug(msg: string, ctx?: LogContext): void {
    this.inner.debug(ctx ?? {}, msg);
  }
  trace(msg: string, ctx?: LogContext): void {
    this.inner.trace(ctx ?? {}, msg);
  }
  child(ctx: LogContext): Logger {
    return new PinoLoggerAdapter(this.inner.child(ctx));
  }
}

/** Create a structured logger for a service (e.g. "api", "chat-worker"). */
export function createLogger(service: string, level: LogLevel = "info"): Logger {
  return new PinoLoggerAdapter(pino(toPinoOptions(level, service)));
}

/** No-op logger for tests. */
export function createNullLogger(): Logger {
  const noop = (): void => undefined;
  const nullLogger: Logger = {
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    child: () => nullLogger,
  };
  return nullLogger;
}
