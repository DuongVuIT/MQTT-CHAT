import { Controller, Get, NotFoundException, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { MEDIA_KEY_PATTERN, S3CompatibleStorage, type StorageObject } from "@mqtt-chat/storage";
import { loadServerEnv } from "@mqtt-chat/config";
import { apiError } from "../common";

/**
 * Public media handler — GET /api/media?key=<storage-key>
 *
 * SINGLE ORIGIN media path: clients (web, admin, mobile) resolve a durable
 * storage key to `<public-origin>/media?key=...`; the gateway routes it here
 * and this controller streams bytes server-side from object storage. No
 * object-storage host, bucket name or signed URL ever reaches client code,
 * and message metadata persists only `storageKey` (+ mime/filename/size).
 *
 * Keys are immutable (they embed an upload timestamp), so responses are
 * safely cacheable.
 */
@Controller("media")
export class MediaController {
  private readonly storage: S3CompatibleStorage;

  // Explicit token: tsx/esbuild does not emit design:paramtypes metadata.
  constructor() {
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

  @Get()
  async stream(@Query("key") key: string, @Res() res: Response): Promise<void> {
    if (!key || key.length > 512 || !MEDIA_KEY_PATTERN.test(key)) {
      throw new NotFoundException(apiError("BAD_REQUEST", "Invalid media key"));
    }
    let object: StorageObject;
    try {
      object = await this.storage.get(key);
    } catch {
      throw new NotFoundException(apiError("MEDIA_NOT_FOUND", "Media object not found"));
    }
    res.status(200);
    res.setHeader("Content-Type", object.contentType ?? "application/octet-stream");
    if (typeof object.contentLength === "number") {
      res.setHeader("Content-Length", String(object.contentLength));
    }
    if (object.eTag) {
      res.setHeader("ETag", object.eTag);
    }
    // Immutable keys → content never changes for a given key.
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    // A storage fault mid-stream must not surface as an unhandled 'error'
    // event (that would crash the whole API process), and a client abort
    // must not leave the upstream storage socket open.
    res.on("close", () => {
      object.stream.destroy();
    });
    object.stream.on("error", () => {
      // Headers are already sent — the only safe recovery is tearing down
      // the response; the client sees a truncated body instead of a crash.
      res.destroy();
    });
    object.stream.pipe(res);
  }
}
