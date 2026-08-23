import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Express } from "express";
import { z } from "zod";
import { S3CompatibleStorage, buildMediaKey } from "@mqtt-chat/storage";
import { loadServerEnv } from "@mqtt-chat/config";
import { PrismaService } from "../prisma.service";
import { ZodValidationPipe, apiError } from "../common";

/**
 * Media upload flow (binary NEVER goes through MQTT):
 *   client → POST /api/uploads (multipart, SAME ORIGIN via the gateway)
 *          → API streams the bytes into object storage server-side
 *          → client sends an MQTT message carrying metadata.storageKey.
 *
 * The browser never sees a presigned URL or object-storage host — that
 * presigned-PUT flow leaked the internal MinIO origin into browser code.
 */

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB cap

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "audio/webm",
  "audio/mpeg",
  "application/pdf",
] as const;

const uploadSchema = z.object({
  conversationId: z.string().min(1),
});

@Controller("uploads")
export class UploadsController {
  private readonly storage: S3CompatibleStorage;

  // Explicit token: tsx/esbuild does not emit design:paramtypes metadata.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    const env = loadServerEnv();
    this.storage = new S3CompatibleStorage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      forcePathStyle: true,
    });
  }

  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async upload(
    @Body(new ZodValidationPipe(uploadSchema)) body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ key: string; filename: string; mimeType: string; size: number }> {
    const data = body as z.infer<typeof uploadSchema>;
    if (!file) {
      throw new BadRequestException(apiError("BAD_REQUEST", "Missing file field"));
    }
    const mimeType = file.mimetype || "application/octet-stream";
    if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(mimeType)) {
      throw new BadRequestException(
        apiError("UNSUPPORTED_MEDIA_TYPE", `Unsupported type ${mimeType}`),
      );
    }
    if (!file.size || file.size <= 0) {
      throw new BadRequestException(apiError("BAD_REQUEST", "Empty upload"));
    }

    // The conversation must exist — uploads are conversation-scoped keys and
    // we refuse orphan objects for conversations that were never created.
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: data.conversationId },
      select: { id: true },
    });
    if (!conversation) {
      throw new BadRequestException(apiError("CONVERSATION_NOT_FOUND", "Unknown conversation"));
    }

    const key = buildMediaKey(data.conversationId, file.originalname || "upload");
    await this.storage.upload(key, file.buffer, mimeType);
    return {
      key,
      filename: file.originalname ?? "upload",
      mimeType,
      size: file.size,
    };
  }
}
