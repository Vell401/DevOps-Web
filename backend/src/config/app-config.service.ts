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

  /**
   * Redis is opt-in: enabled only when REDIS_HOST is explicitly set (Compose
   * always sets it). Without it the app falls back to in-process stores, so
   * bare `npm run start:dev` and unit tests work without a Redis server.
   */
  get redisEnabled(): boolean {
    const host = this.config.get<string>('REDIS_HOST');
    return Boolean(host && host.trim());
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

  /** Queries slower than this (ms) are recorded for the admin metrics panel. */
  get slowQueryMs(): number {
    return parseInt(this.config.get<string>('SLOW_QUERY_MS', '300'), 10);
  }

  /** TTL (ms) for cached DB-derived admin metrics, so repeated dashboard polls
   *  never re-run the aggregate queries more than once per window. */
  get metricsCacheTtlMs(): number {
    return parseInt(this.config.get<string>('METRICS_CACHE_TTL_MS', '30000'), 10);
  }

  /** Path to the JSON status file written by the host backup job (restic).
   *  Read-only mounted into the backend so /admin/metrics can surface it. */
  get backupStatusFile(): string {
    return this.config.get<string>('BACKUP_STATUS_FILE', '/backup-status.json');
  }

  // --- Build provenance (shown in the admin "Build info" panel) ---
  //
  // These come from build-args baked into the image. A *defined but empty* env
  // var (e.g. a CI expression that resolved to nothing) would otherwise slip
  // past ConfigService's default, so each getter treats blanks as missing.

  get appVersion(): string {
    return (
      blankToUndefined(this.config.get<string>('APP_VERSION')) ??
      blankToUndefined(process.env.npm_package_version) ??
      'dev'
    );
  }

  get gitSha(): string {
    return blankToUndefined(this.config.get<string>('GIT_SHA')) ?? 'unknown';
  }

  get buildTime(): string {
    return blankToUndefined(this.config.get<string>('BUILD_TIME')) ?? 'unknown';
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

/** Treat `undefined`, `null` and blank/whitespace-only strings alike, so an
 *  env var that is *defined but empty* falls through to the next fallback. */
function blankToUndefined(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}
