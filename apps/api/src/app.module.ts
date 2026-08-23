import {
  Logger,
  Module,
  type ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import type { Response } from "express";
import { PrismaService } from "./prisma.service";
import { RedisService } from "./redis.service";
import { HealthController } from "./controllers/health.controller";
import { ChatController } from "./controllers/chat.controller";
import { UploadsController } from "./controllers/uploads.controller";
import { BotsController } from "./controllers/bots.controller";
import { AdminController } from "./controllers/admin.controller";
import { apiError } from "./common";

/** Consistent error format — never leak raw stack traces to clients. */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: unknown = exception.getResponse();
      // Normalize every HttpException into the canonical error envelope.
      // ZodValidationPipe / controllers already produce `{error:{...}}` —
      // framework-generated shapes (body-parser JSON errors, 404 routes)
      // are wrapped here so clients only ever see one error format.
      const canonical = isCanonicalErrorBody(body)
        ? body
        : apiError(
            statusToCode(status),
            exception.message,
            typeof body === "object" && body !== null ? body : null,
          );
      response.status(status).json(canonical);
      return;
    }
    // Log the underlying failure — never swallow exceptions silently.
    const logger = new Logger("GlobalExceptionFilter");
    logger.error(
      exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
    );
    response.status(500).json(apiError("INTERNAL_ERROR", "Internal server error"));
  }
}

/** Map HTTP status to a stable error code for framework-generated failures. */
function statusToCode(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMITED";
    default:
      return `HTTP_${status}`;
  }
}

/** True when the body already has the `{error:{code,...}}` canonical shape. */
function isCanonicalErrorBody(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const err = (body as Record<string, unknown>)["error"];
  return typeof err === "object" && err !== null && "code" in err;
}

@Module({
  controllers: [
    HealthController,
    ChatController,
    UploadsController,
    BotsController,
    AdminController,
  ],
  providers: [
    PrismaService,
    RedisService,
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
