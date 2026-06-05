import axios, { AxiosError } from "axios";
import { config } from "../config/index.js";
import { logger } from "../lib/logger.js";

export type RenderCallbackPayload = {
  correlation_id?: string;
  idempotency_key?: string;
  order_uuid: string;
  render_type: "static_slot" | "final_merge";
  status: "completed" | "failed";
  clip_url?: string;
  final_video_url?: string;
  thumbnail_url?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableCallbackError = (error: unknown): boolean => {
  const axiosError = error as AxiosError | undefined;
  const status = axiosError?.response?.status;

  if (!status) return true;
  return status === 408 || status === 429 || status >= 500;
};

export async function deliverRenderCallback(
  callbackUrl: string | undefined,
  payload: RenderCallbackPayload,
): Promise<void> {
  if (!callbackUrl) return;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.auth.serviceToken) {
    headers.Authorization = `Bearer ${config.auth.serviceToken}`;
  }

  if (payload.correlation_id) {
    headers["X-Correlation-Id"] = payload.correlation_id;
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= config.callback.maxRetries; attempt++) {
    try {
      await axios.post(callbackUrl, payload, {
        timeout: config.callback.timeoutMs,
        headers,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      logger.info(
        { callbackUrl, attempt, render_type: payload.render_type, order_uuid: payload.order_uuid },
        "Callback delivered",
      );
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);

      if (attempt >= config.callback.maxRetries || !isRetryableCallbackError(error)) {
        logger.error(
          { callbackUrl, attempt, error: message, render_type: payload.render_type, order_uuid: payload.order_uuid },
          "Callback delivery failed",
        );
        throw error;
      }

      const delayMs = config.callback.retryBaseDelayMs * Math.pow(2, attempt - 1);
      logger.warn(
        { callbackUrl, attempt, delayMs, error: message, render_type: payload.render_type, order_uuid: payload.order_uuid },
        "Callback delivery retrying",
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}
