import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { AppConfigService } from '../config/app-config.service';

/**
 * Thin wrapper around the S3 API. Backed by MinIO in dev/prod, but the same
 * code works against real AWS S3 by changing S3_ENDPOINT / credentials and
 * S3_FORCE_PATH_STYLE=false.
 *
 * The bucket is created on demand (lazy + cached) so the backend boots even if
 * MinIO comes up a little later than the app.
 */
@Injectable()
export class S3StorageService implements OnModuleInit {
  private readonly log = new Logger(S3StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private bucketReady = false;

  constructor(private readonly cfg: AppConfigService) {
    this.bucket = cfg.s3Bucket;
    this.client = new S3Client({
      endpoint: cfg.s3Endpoint,
      region: cfg.s3Region,
      forcePathStyle: cfg.s3ForcePathStyle,
      credentials: {
        accessKeyId: cfg.s3AccessKey,
        secretAccessKey: cfg.s3SecretKey,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    // Best-effort at boot; never block app start if MinIO is slow to come up.
    try {
      await this.ensureBucket();
    } catch (e) {
      this.log.warn(
        `Bucket "${this.bucket}" not ready at boot; will retry on first upload. ${
          (e as Error).message
        }`,
      );
    }
  }

  /** Idempotently ensure the bucket exists. Cached after first success. */
  async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.log.log(`Created bucket "${this.bucket}"`);
    }
    this.bucketReady = true;
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getObjectStream(key: string): Promise<Readable> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    // In the Node.js runtime the SDK returns a Readable stream.
    return out.Body as Readable;
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
