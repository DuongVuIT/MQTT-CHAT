import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Object storage abstraction.
 * Development: MinIOStorage (S3-compatible).
 * Production: swap in any S3-compatible adapter (AWS S3, Cloudflare R2) —
 * the interface stays identical so business logic never changes.
 */

export interface UploadUrlParams {
  key: string;
  contentType: string;
  /** Presigned URL validity in seconds. */
  expiresIn?: number;
}

export interface ObjectStorage {
  /** Create a presigned PUT URL — binary goes client → storage directly, never via MQTT. */
  createUploadUrl(params: UploadUrlParams): Promise<{ uploadUrl: string; key: string }>;
  /** Create a presigned GET (download) URL. */
  createDownloadUrl(key: string, expiresIn?: number): Promise<string>;
  upload(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  getUrl(key: string): Promise<string>;
  /** Check whether an object actually exists in storage (HEAD request). */
  exists(key: string): Promise<boolean>;
}

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  /** Force path-style URLs (required for MinIO). */
  forcePathStyle?: boolean;
}

/** S3-compatible storage implementation (works with MinIO, AWS S3, Cloudflare R2). */
export class S3CompatibleStorage implements ObjectStorage {
  private readonly s3: S3Client;

  constructor(
    private readonly config: S3StorageConfig,
    private readonly defaultExpiresIn = 900,
  ) {
    this.s3 = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    });
  }

  async createUploadUrl(params: UploadUrlParams): Promise<{ uploadUrl: string; key: string }> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: params.key,
      ContentType: params.contentType,
    });
    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: params.expiresIn ?? this.defaultExpiresIn,
    });
    return { uploadUrl, key: params.key };
  }

  async createDownloadUrl(key: string, expiresIn?: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.config.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: expiresIn ?? this.defaultExpiresIn });
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async getUrl(key: string): Promise<string> {
    return this.createDownloadUrl(key);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "NotFound" || name === "NoSuchKey") return false;
      // 404 from some S3-compatible implementations surfaces as a generic error.
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return false;
      throw error;
    }
  }
}

/** Build a deterministic object key for a conversation upload. */
export function buildMediaKey(conversationId: string, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `media/${conversationId}/${Date.now()}-${safeName}`;
}
