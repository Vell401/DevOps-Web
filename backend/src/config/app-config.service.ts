import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV', 'development');
  }

  get port(): number {
    return parseInt(this.config.get<string>('PORT', '3000'), 10);
  }

  get logLevel(): string {
    return this.config.get<string>('LOG_LEVEL', 'info');
  }

  get corsOrigins(): string[] {
    const raw = this.config.get<string>('CORS_ORIGINS', 'http://localhost:5173');
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }

  get databaseUrl(): string {
    return this.config.getOrThrow<string>('DATABASE_URL');
  }

  get redisHost(): string {
    return this.config.get<string>('REDIS_HOST', 'localhost');
  }

  get redisPort(): number {
    return parseInt(this.config.get<string>('REDIS_PORT', '6379'), 10);
  }

  get jwtAccessSecret(): string {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  get jwtRefreshSecret(): string {
    return this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  get jwtAccessTtl(): string {
    return this.config.get<string>('JWT_ACCESS_TTL', '15m');
  }

  get jwtRefreshTtl(): string {
    return this.config.get<string>('JWT_REFRESH_TTL', '7d');
  }

  get throttleTtl(): number {
    return parseInt(this.config.get<string>('THROTTLE_TTL', '60'), 10);
  }

  get throttleLimit(): number {
    return parseInt(this.config.get<string>('THROTTLE_LIMIT', '120'), 10);
  }

  // --- Object storage (S3 / MinIO) ---

  get s3Endpoint(): string {
    return this.config.get<string>('S3_ENDPOINT', 'http://minio:9000');
  }

  get s3Region(): string {
    return this.config.get<string>('S3_REGION', 'us-east-1');
  }

  get s3Bucket(): string {
    return this.config.get<string>('S3_BUCKET', 'tracker-attachments');
  }

  get s3AccessKey(): string {
    return this.config.get<string>('S3_ACCESS_KEY', 'minioadmin');
  }

  get s3SecretKey(): string {
    return this.config.get<string>('S3_SECRET_KEY', 'minioadmin');
  }

  /** MinIO and most non-AWS S3 servers require path-style addressing. */
  get s3ForcePathStyle(): boolean {
    return this.config.get<string>('S3_FORCE_PATH_STYLE', 'true') !== 'false';
  }

  /** Maximum upload size in bytes (default 25 MB). */
  get maxUploadBytes(): number {
    return parseInt(this.config.get<string>('MAX_UPLOAD_BYTES', '26214400'), 10);
  }
}
