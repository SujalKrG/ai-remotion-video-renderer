import fs from "fs";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl as presignUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent } from "https";
import { config } from "../config/index.js";
import { S3UploadError } from "../errors/RenderError.js";
import { logger } from "../lib/logger.js";

// Lazy initialization — only create S3 client when actually used
let s3: S3Client | null = null;

function getS3Client(): S3Client {
  if (!config.s3.bucket) {
    throw new Error("Missing required environment variable: AWS_BUCKET");
  }
  
  if (!s3) {
    s3 = new S3Client({
      region: config.s3.region,
      requestHandler: new NodeHttpHandler({
        httpsAgent: new Agent({
          keepAlive: true,
          keepAliveMsecs: 1000,
          maxSockets: 50,
          maxFreeSockets: 10,
          timeout: 60_000,
        }),
      }),
      // Built-in retry with exponential backoff
      maxAttempts: 3,
    });
  }
  
  return s3;
}

// ── Retry Helper ───────────────────────────────────────────────────────────────

interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrors: string[];
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableErrors: [
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "ENETUNREACH",
    "RequestTimeout",
    "ServiceUnavailable",
    "SlowDown",
    "TooManyRequests",
    "InternalError",
  ],
};

function isRetryableError(error: any, retryableErrors: string[]): boolean {
  if (!error) return false;
  
  const errorCode = error.code || error.name || "";
  const errorMessage = error.message || "";
  
  return retryableErrors.some(
    (retryable) =>
      errorCode.includes(retryable) || errorMessage.includes(retryable)
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  context: Record<string, unknown> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt >= opts.maxAttempts) {
        logger.error(
          { ...context, attempt, error: lastError.message },
          "Retry exhausted — giving up"
        );
        throw lastError;
      }
      
      if (!isRetryableError(error, opts.retryableErrors)) {
        logger.warn(
          { ...context, error: lastError.message },
          "Non-retryable error — failing immediately"
        );
        throw lastError;
      }
      
      // Exponential backoff: delay = baseDelay * 2^(attempt-1) + jitter
      const exponentialDelay = opts.baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 500;
      const delay = Math.min(exponentialDelay + jitter, opts.maxDelayMs);
      
      logger.warn(
        { ...context, attempt, delayMs: Math.round(delay), error: lastError.message },
        "Retryable error — retrying after delay"
      );
      
      await sleep(delay);
    }
  }
  
  throw lastError;
}

export async function uploadToS3(localPath: string, s3Key: string): Promise<void> {
  let fileSizeMB = "unknown";
  
  try {
    const fileSize = fs.statSync(localPath).size;
    fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);
  } catch (error) {
    // File doesn't exist or can't be read - will fail during upload
    // This can happen in test environments
  }
  
  logger.info({ s3Key, fileSizeMB: `${fileSizeMB} MB` }, "Starting S3 upload");
  
  try {
    await retryWithBackoff(
      async () => {
        const client = getS3Client();
        const fileStream = fs.createReadStream(localPath);
        
        await client.send(new PutObjectCommand({
          Bucket: config.s3.bucket,
          Key: s3Key,
          Body: fileStream,
          ContentType: "video/mp4",
        }));
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
      },
      { s3Key, operation: "uploadToS3" }
    );
    
    logger.info({ s3Key, fileSizeMB: `${fileSizeMB} MB` }, "S3 upload completed");
  } catch (error) {
    logger.error({ s3Key, error: (error as Error).message }, "S3 upload failed after all retries");
    throw new S3UploadError(s3Key, error as Error);
  }
}

export async function getSignedUrl(
  s3Key: string,
  expiresInSeconds = config.s3.signedUrlExpiry,
): Promise<string> {
  const client = getS3Client();
  return presignUrl(
    client,
    new GetObjectCommand({ Bucket: config.s3.bucket, Key: s3Key }),
    { expiresIn: expiresInSeconds },
  );
}

export function buildPublicUrl(s3Key: string): string {
  return `https://${config.s3.bucket}.s3.${config.s3.region}.amazonaws.com/${s3Key}`;
}

// Returns a presigned URL by default (private bucket safe).
// Set S3_URL_STRATEGY=public in env to return a direct public URL instead.
export async function buildVideoUrl(s3Key: string): Promise<string> {
  if (process.env.S3_URL_STRATEGY === "public") {
    return buildPublicUrl(s3Key);
  }
  return getSignedUrl(s3Key);
}
