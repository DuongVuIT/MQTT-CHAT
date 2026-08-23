import { Body, Controller, Get, Inject, NotFoundException, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { S3CompatibleStorage, buildMediaKey } from "@mqtt-chat/storage";
import { loadServerEnv } from "@mqtt-chat/config";
import { PrismaService } from "../prisma.service";
import { ZodValidationPipe, apiError } from "../common";

/**
 * Media upload flow (binary NEVER goes through MQTT):
 *   client → POST /uploads/presign → presigned PUT URL → MinIO/S3
 *   client sends MQTT message with metadata after upload completes.
 */

const presignSchema = z.object({
  conversationId: z.string().min(1),
  filename: z.string().min(1).max(255),
  contentType: z.enum([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/webm",
    "audio/webm",
    "audio/mpeg",
    "application/pdf",
  ]),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024), // 50MB cap
});

const completeSchema = z.object({
  conversationId: z.string().min(1),
  key: z.string().min(1),
});

/**
 * Media keys are produced exclusively by buildMediaKey():
 *   media/{conversationId}/{timestamp}-{safeName}
 * The strict pattern prevents the view endpoint from being abused as a
 * bucket-wide signed-URL minter.
 */
const MEDIA_KEY_PATTERN = /^media\/[A-Za-z0-9._-]+\/[0-9]+-[A-Za-z0-9._-]+$/;

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

  @Post("presign")
  async presign(@Body(new ZodValidationPipe(presignSchema)) body: unknown) {
    const data = body as z.infer<typeof presignSchema>;
    const key = buildMediaKey(data.conversationId, data.filename);
    const { uploadUrl } = await this.storage.createUploadUrl({
      key,
      contentType: data.contentType,
    });
    return { uploadUrl, key };
  }

  @Post("complete")
  async complete(@Body(new ZodValidationPipe(completeSchema)) body: unknown) {
    const data = body as z.infer<typeof completeSchema>;
    // Verify the object actually exists in storage before acknowledging.
    // (getUrl only mints a signed URL — it never checks existence, so a
    // HEAD request is required to reject keys that were never uploaded.)
    const exists = await this.storage.exists(data.key);
    if (!exists) {
      throw new NotFoundException(apiError("UPLOAD_NOT_FOUND", "Uploaded object not found"));
    }
    return { ok: true, key: data.key };
  }

  /**
   * Media view endpoint — resolves a durable storage key to a short-lived
   * presigned GET URL via HTTP 302. Clients store ONLY the storage key in
   * message metadata (never a fragile dev signed URL or host) and point
   * <img>/download src at this endpoint; the browser follows the redirect
   * to object storage. Signed URLs are minted per request, so they can
   * never be stale in history.
   */
  @Get("view")
  async view(@Query("key") key: string, @Res() res: Response): Promise<void> {
    if (!key || key.length > 512 || !MEDIA_KEY_PATTERN.test(key)) {
      throw new NotFoundException(apiError("BAD_REQUEST", "Invalid media key"));
    }
    const exists = await this.storage.exists(key);
    if (!exists) {
      throw new NotFoundException(apiError("MEDIA_NOT_FOUND", "Media object not found"));
    }
    const url = await this.storage.createDownloadUrl(key);
    res.redirect(302, url);
  }
}
