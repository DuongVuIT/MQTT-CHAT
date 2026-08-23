import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { z } from "zod";
import { safeParseRuleDefinition } from "@mqtt-chat/bot-rules";
import { toPrismaJson } from "@mqtt-chat/database";
import { PrismaService } from "../prisma.service";
import { ZodValidationPipe, apiError } from "../common";

/**
 * Bot configuration endpoints: bots CRUD, rules CRUD (validated against the
 * bot-rules schema — arbitrary JSON is never trusted), logs.
 */

const createBotSchema = z.object({
  name: z.string().min(1).max(100),
  enabled: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
});

const updateBotSchema = z.object({
  enabled: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
});

const createRuleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  trigger: z.unknown(),
  conditions: z.array(z.unknown()).optional(),
  actions: z.array(z.unknown()).optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
  enabled: z.boolean().optional(),
});

const updateRuleSchema = createRuleSchema.partial();

@Controller("bots")
export class BotsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async listBots() {
    const bots = await this.prisma.bot.findMany({
      include: { rules: { select: { id: true, name: true, enabled: true, priority: true } } },
    });
    return { bots };
  }

  @Get(":id")
  async getBot(@Param("id") id: string) {
    const bot = await this.prisma.bot.findUnique({ where: { id }, include: { rules: true } });
    if (!bot) throw new NotFoundException(apiError("BOT_NOT_FOUND", "Bot not found"));
    return { bot };
  }

  @Post()
  async createBot(@Body(new ZodValidationPipe(createBotSchema)) body: unknown) {
    const data = body as z.infer<typeof createBotSchema>;
    const bot = await this.prisma.bot.create({
      data: { name: data.name, ...(data.enabled !== undefined ? { enabled: data.enabled } : {}) },
    });
    return { bot };
  }

  @Patch(":id")
  async updateBot(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateBotSchema)) body: unknown,
  ) {
    const data = body as z.infer<typeof updateBotSchema>;
    const bot = await this.prisma.bot.update({
      where: { id },
      data: {
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.settings ? { settings: toPrismaJson(data.settings) } : {}),
      },
    });
    return { bot };
  }

  // ---------- Rules ----------

  @Get(":id/rules")
  async listRules(@Param("id") id: string) {
    const rules = await this.prisma.botRule.findMany({
      where: { botId: id },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    return { rules };
  }

  @Post(":id/rules")
  async createRule(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createRuleSchema)) body: unknown,
  ) {
    const data = body as z.infer<typeof createRuleSchema>;

    // Validate trigger/conditions/actions against the rule schema.
    const validation = safeParseRuleDefinition({
      trigger: data.trigger,
      conditions: data.conditions ?? [],
      actions: data.actions ?? [],
    });
    if (!validation.success) {
      throw new NotFoundException(apiError("RULE_VALIDATION_ERROR", validation.error));
    }

    const rule = await this.prisma.botRule.create({
      data: {
        botId: id,
        name: data.name,
        description: data.description ?? "",
        trigger: toPrismaJson(validation.data.trigger),
        conditions: toPrismaJson(validation.data.conditions),
        actions: toPrismaJson(validation.data.actions),
        priority: data.priority ?? 100,
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      },
    });
    return { rule };
  }

  @Patch(":id/rules/:ruleId")
  async updateRule(
    @Param("id") id: string,
    @Param("ruleId") ruleId: string,
    @Body(new ZodValidationPipe(updateRuleSchema)) body: unknown,
  ) {
    const data = body as z.infer<typeof updateRuleSchema>;

    let validated: ReturnType<typeof safeParseRuleDefinition> | null = null;
    if (data.trigger || data.conditions || data.actions) {
      const existing = await this.prisma.botRule.findUnique({ where: { id: ruleId } });
      if (!existing || existing.botId !== id) {
        throw new NotFoundException(apiError("RULE_NOT_FOUND", "Rule not found"));
      }
      validated = safeParseRuleDefinition({
        trigger: data.trigger ?? existing.trigger,
        conditions: data.conditions ?? existing.conditions,
        actions: data.actions ?? existing.actions,
      });
      if (!validated.success) {
        throw new NotFoundException(apiError("RULE_VALIDATION_ERROR", validated.error));
      }
    }

    const rule = await this.prisma.botRule.update({
      where: { id: ruleId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(validated?.success
          ? {
              trigger: toPrismaJson(validated.data.trigger),
              conditions: toPrismaJson(validated.data.conditions),
              actions: toPrismaJson(validated.data.actions),
            }
          : {}),
      },
    });
    return { rule };
  }

  @Delete(":id/rules/:ruleId")
  async deleteRule(@Param("id") id: string, @Param("ruleId") ruleId: string) {
    await this.prisma.botRule.deleteMany({ where: { id: ruleId, botId: id } });
    return { deleted: true };
  }

  // ---------- Logs ----------

  @Get(":id/logs")
  async getLogs(@Param("id") id: string) {
    const [events, commands, executions] = await Promise.all([
      this.prisma.botEventLog.findMany({
        where: { botId: id },
        orderBy: { processedAt: "desc" },
        take: 50,
      }),
      this.prisma.botCommandLog.findMany({
        where: { botId: id },
        orderBy: { executedAt: "desc" },
        take: 50,
      }),
      this.prisma.botExecutionLog.findMany({
        where: { botId: id },
        orderBy: { executedAt: "desc" },
        take: 50,
      }),
    ]);
    return { events, commands, executions };
  }
}
