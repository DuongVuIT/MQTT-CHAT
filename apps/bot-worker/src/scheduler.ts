import type { PrismaClient } from "@mqtt-chat/database";
import type { Logger } from "@mqtt-chat/logger";
import { parseRuleDefinition } from "@mqtt-chat/bot-rules";
import type { MqttBotTransport } from "./transport";

/**
 * Persistent scheduled-job runner.
 * Jobs live in PostgreSQL (BotScheduledJob) so they survive worker restarts.
 * Recurring jobs are rescheduled after each run.
 */

const POLL_INTERVAL_MS = 1_000;
const MAX_ATTEMPTS = 5;

interface JobPayload {
  ruleId?: string;
  actions?: Array<{ type: string; content?: string; emoji?: string; ms?: number }>;
  conversationId?: string;
  causationId?: string;
}

export class BotScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly db: PrismaClient,
    private readonly transport: MqttBotTransport,
    private readonly log: Logger,
  ) {}

  start(): void {
    this.scheduleNext();
    this.log.info("Bot scheduler started");
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.log.info("Bot scheduler stopped");
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.scheduleNext();
      return;
    }
    this.running = true;
    try {
      await this.processDueJobs();
    } catch (error) {
      this.log.error("Scheduler tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.running = false;
      this.scheduleNext();
    }
  }

  private async processDueJobs(): Promise<void> {
    const jobs = await this.db.$queryRaw<
      Array<{
        id: string;
        botId: string;
        payload: unknown;
        recurring: boolean;
        intervalMs: number | null;
        attempts: number;
      }>
    >`
      SELECT "id", "botId", "payload", "recurring", "intervalMs", "attempts"
      FROM "BotScheduledJob"
      WHERE "status" = 'PENDING' AND "runAt" <= NOW()
      ORDER BY "runAt" ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    `;

    for (const job of jobs) {
      await this.db.botScheduledJob.update({
        where: { id: job.id },
        data: { status: "RUNNING" },
      });

      try {
        const payload = job.payload as JobPayload;
        const actions = payload.actions ?? [];
        for (const action of actions) {
          const parsed = parseRuleDefinition({
            trigger: { event: "__scheduled__" },
            conditions: [],
            actions: [action],
          });
          const execAction = parsed.actions[0];
          if (!execAction) continue;
          // Only message-type actions are meaningful for scheduled jobs.
          if (execAction.type === "reply" || execAction.type === "send_message") {
            if (execAction.content && payload.conversationId) {
              await this.transport.sendBotCommand({
                conversationId: payload.conversationId,
                content: execAction.content,
                causationId: payload.causationId,
                ruleId: payload.ruleId,
              });
            }
          }
        }

        if (job.recurring && job.intervalMs) {
          await this.db.botScheduledJob.update({
            where: { id: job.id },
            data: { status: "PENDING", runAt: new Date(Date.now() + job.intervalMs), attempts: 0 },
          });
        } else {
          await this.db.botScheduledJob.update({
            where: { id: job.id },
            data: { status: "COMPLETED", completedAt: new Date() },
          });
        }
        this.log.info("Scheduled job executed", { jobId: job.id, botId: job.botId });
      } catch (error) {
        const attempts = job.attempts + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        await this.db.botScheduledJob
          .update({
            where: { id: job.id },
            data: {
              status: failed ? "FAILED" : "PENDING",
              runAt: failed ? undefined : new Date(Date.now() + 5_000),
              attempts,
              lastError: error instanceof Error ? error.message : String(error),
              ...(failed ? { completedAt: new Date() } : {}),
            },
          })
          .catch(() => undefined);
        this.log.error("Scheduled job failed", {
          jobId: job.id,
          attempt: attempts,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
