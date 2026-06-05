export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

export class ValidationError extends RenderError {
  constructor(public readonly fields: string[]) {
    super(`Missing required fields: ${fields.join(", ")}`);
    this.name = "ValidationError";
  }
}

export class RenderTimeoutError extends RenderError {
  constructor(
    public readonly timeoutMs: number,
    public readonly composition: string,
    public readonly userThemeId?: string,
  ) {
    super(`Render timeout after ${timeoutMs}ms for composition ${composition}`);
    this.name = "RenderTimeoutError";
  }
}

export class S3UploadError extends Error {
  constructor(
    public readonly s3Key: string,
    public readonly cause?: Error,
  ) {
    super(`Failed to upload to S3: ${s3Key}`);
    this.name = "S3UploadError";
  }
}

export class BrowserError extends RenderError {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "BrowserError";
  }
}
