import { randomUUID } from "node:crypto";
import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import type { ZodTypeAny } from "zod";

/**
 * Shared API utilities: consistent error format + zod validation pipe.
 */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: unknown;
    requestId: string;
  };
}

export function apiError(code: string, message: string, details: unknown = null): ApiErrorBody {
  return { error: { code, message, details, requestId: randomUUID() } };
}

/** Zod validation pipe for REST boundaries — never trust client input. */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(
        apiError(
          "VALIDATION_ERROR",
          "Request validation failed",
          result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        ),
      );
    }
    return result.data;
  }
}
