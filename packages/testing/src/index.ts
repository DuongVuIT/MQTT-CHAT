import { createNullLogger, type Logger } from "@mqtt-chat/logger";

/**
 * Shared test utilities.
 */

export { createNullLogger };
export type { Logger };

/** Wait until a condition becomes true or timeout. Useful for async assertions. */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

/** Deferred promise helper for event-driven tests. */
export class Deferred<T> {
  readonly promise: Promise<T>;
  private resolveFn!: (value: T) => void;
  private rejectFn!: (reason?: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolveFn = resolve;
      this.rejectFn = reject;
    });
  }

  resolve(value: T): void {
    this.resolveFn(value);
  }

  reject(reason?: unknown): void {
    this.rejectFn(reason);
  }
}
