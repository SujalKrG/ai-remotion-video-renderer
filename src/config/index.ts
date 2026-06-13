function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function parseIntEnv(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid integer, got: "${value}"`);
  }
  return parsed;
}

export const config = {
  chrome: {
    dir: process.env.CHROME_DIR || "/var/task/.chrome",
    downloadTimeout: parseIntEnv("CHROME_DOWNLOAD_TIMEOUT", 120_000),
    mode: "headless-shell" as const,
  },

  render: {
    hardTimeout: parseIntEnv("RENDER_TIMEOUT", 600_000),
    crf: parseIntEnv("VIDEO_CRF", 23),
    concurrency: parseIntEnv("RENDER_CONCURRENCY", 1),
    frameTimeout: parseIntEnv("FRAME_TIMEOUT", 120_000),
    defaultComposition: process.env.DEFAULT_COMPOSITION || "Video",
  },

  s3: {
    bucket: process.env.AWS_BUCKET || process.env.S3_BUCKET || "",
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1",
    signedUrlExpiry: parseIntEnv("S3_SIGNED_URL_EXPIRY", 86_400),
  },

  paths: {
    tmp: "/tmp",
    remotionCache: "/tmp/.remotion",
    cache: "/tmp/.cache",
    s3Prefixes: {
      renders: "renders",
      thumbnails: "thumbnails",
    } as const,
  },

  auth: {
    serviceToken: process.env.AI_VIDEO_SERVICE_TOKEN || "",
  },

  callback: {
    maxRetries: parseIntEnv("CALLBACK_MAX_RETRIES", 3),
    timeoutMs: parseIntEnv("CALLBACK_TIMEOUT_MS", 10000),
    retryBaseDelayMs: parseIntEnv("CALLBACK_RETRY_BASE_DELAY_MS", 1000),
  },

  thumbnail: {
    enabled: process.env.THUMBNAIL_ENABLED !== "0",
    frameIndex: parseIntEnv("THUMBNAIL_FRAME_INDEX", 0),
  },
} as const;
