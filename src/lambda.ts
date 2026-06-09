import fs from "fs";
import { randomUUID } from "crypto";
import { renderVideo, renderThumbnail } from "./renderer.js";
import { uploadToS3, buildVideoUrl } from "./utils/s3Storage.js";
import { uploadThumbnailToS3, buildThumbnailUrl } from "./utils/thumbnailStorage.js";
import { deliverRenderCallback, type RenderCallbackPayload } from "./callbacks/callbackDelivery.js";
import { config } from "./config/index.js";
import { logger } from "./lib/logger.js";
import {
  StaticSlotRequestSchema,
  FinalMergeRequestSchema,
  type StaticSlotRequest,
  type FinalMergeRequest,
} from "./schemas/validation.js";

// ── Request types ──────────────────────────────────────────────────────────────
// Types are now imported from validation schemas

type LambdaEvent = StaticSlotRequest | FinalMergeRequest | Record<string, unknown>;

// ── Response types ─────────────────────────────────────────────────────────────

type LambdaResponse =
  | { success: true; render_type: "static_slot"; clip_url: string; thumbnail_url: string; order_uuid: string; slot_no: number }
  | { success: false; render_type: "static_slot"; error: string; order_uuid: string; slot_no: number }
  | { success: true; render_type: "final_merge"; final_video_url: string; thumbnail_url: string; order_uuid: string }
  | { success: false; render_type: "final_merge"; error: string; order_uuid: string };

// ── Helpers ────────────────────────────────────────────────────────────────────

function safeUnlink(filePath: string | null | undefined): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    logger.warn(
      { filePath, error: err instanceof Error ? err.message : String(err) },
      "Failed to cleanup temp file",
    );
  }
}

async function deliverCallbackSafely(
  callbackUrl: string | undefined,
  payload: RenderCallbackPayload,
): Promise<void> {
  try {
    await deliverRenderCallback(callbackUrl, payload);
  } catch (err) {
    logger.error(
      {
        callbackUrl,
        orderUuid: payload.order_uuid,
        renderType: payload.render_type,
        error: err instanceof Error ? err.message : String(err),
      },
      "Render completed but callback delivery failed",
    );
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────

export const handler = async (event: LambdaEvent): Promise<LambdaResponse> => {
  // Ensure writable cache dirs exist on cold start
  fs.mkdirSync(config.paths.remotionCache, { recursive: true });
  fs.mkdirSync(config.paths.cache, { recursive: true });

  const renderType = (event as Record<string, unknown>).render_type as string | undefined;

  // ── static_slot ─────────────────────────────────────────────────────────────
  if (renderType === "static_slot") {
    // Validate with Zod schema
    const parseResult = StaticSlotRequestSchema.safeParse(event);
    
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      logger.error({ errors, event }, "Static slot validation failed");
      
      const orderUuid = (event as any).order_uuid ?? "";
      const slotNo = (event as any).slot?.slot_no ?? 0;
      
      return {
        success: false,
        render_type: "static_slot",
        error: `Validation error: ${errors}`,
        order_uuid: orderUuid,
        slot_no: slotNo,
      };
    }
    
    const req = parseResult.data;
    const orderUuid = req.order_uuid;
    const slotNo = req.slot.slot_no;

    const uuid = randomUUID();
    const localVideoPath = `${config.paths.tmp}/static-${orderUuid}-slot${slotNo}-${uuid}.mp4`;
    const localThumbPath = `${config.paths.tmp}/static-${orderUuid}-slot${slotNo}-${uuid}.jpg`;
    const s3VideoKey = `renders/static/${orderUuid}/slot-${slotNo}-${uuid}.mp4`;
    const s3ThumbKey = `thumbnails/static/${orderUuid}/slot-${slotNo}-${uuid}.jpg`;

    const inputProps: Record<string, unknown> = {
      component_name: req.slot.video_frame.component_name,
      config: req.slot.video_frame.config ?? {},
      variables: req.slot.video_frame.variables ?? {},
      duration_seconds: req.slot.duration_seconds ?? 4,
      purpose: req.slot.purpose ?? "",
    };

    logger.info({ orderUuid, slotNo, component_name: req.slot.video_frame.component_name }, "Starting static_slot render");
    const startTime = Date.now();

    try {
      await renderVideo({
        payload: { props: inputProps, composition: "StaticSlot" },
        outputLocation: localVideoPath,
      });

      await renderThumbnail({
        compositionId: "StaticSlot",
        inputProps,
        outputLocation: localThumbPath,
      });

      await uploadToS3(localVideoPath, s3VideoKey);
      await uploadThumbnailToS3(localThumbPath, s3ThumbKey);

      const clipUrl = await buildVideoUrl(s3VideoKey);
      const thumbnailUrl = await buildThumbnailUrl(s3ThumbKey);
      const durationMs = Date.now() - startTime;

      logger.info({ orderUuid, slotNo, durationMs }, "static_slot render completed");

      const response: LambdaResponse = { success: true, render_type: "static_slot", clip_url: clipUrl, thumbnail_url: thumbnailUrl, order_uuid: orderUuid, slot_no: slotNo };
      await deliverCallbackSafely(req.output?.callback_url, {
        correlation_id: req.correlation_id,
        idempotency_key: req.idempotency_key,
        order_uuid: orderUuid,
        render_type: "static_slot",
        status: "completed",
        clip_url: clipUrl,
        thumbnail_url: thumbnailUrl,
        metadata: {
          slot_no: slotNo,
          duration_seconds: req.slot.duration_seconds,
          render_duration_ms: durationMs,
        },
        timestamp: new Date().toISOString(),
      });

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ orderUuid, slotNo, error: message }, "static_slot render failed");
      const response: LambdaResponse = { success: false, render_type: "static_slot", error: message, order_uuid: orderUuid, slot_no: slotNo };
      await deliverCallbackSafely(req.output?.callback_url, {
        correlation_id: req.correlation_id,
        idempotency_key: req.idempotency_key,
        order_uuid: orderUuid,
        render_type: "static_slot",
        status: "failed",
        error: message,
        metadata: {
          slot_no: slotNo,
          duration_seconds: req.slot.duration_seconds,
          render_duration_ms: Date.now() - startTime,
        },
        timestamp: new Date().toISOString(),
      });
      return response;
    } finally {
      safeUnlink(localVideoPath);
      safeUnlink(localThumbPath);
    }
  }

  // ── final_merge ──────────────────────────────────────────────────────────────
  if (renderType === "final_merge") {
    // Validate with Zod schema
    const parseResult = FinalMergeRequestSchema.safeParse(event);
    
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      logger.error({ errors, event }, "Final merge validation failed");
      
      const orderUuid = (event as any).order_uuid ?? "";
      
      return {
        success: false,
        render_type: "final_merge",
        error: `Validation error: ${errors}`,
        order_uuid: orderUuid,
      };
    }
    
    const req = parseResult.data;
    const orderUuid = req.order_uuid;

    const renderPlan = req.render_plan;
    const fps = renderPlan.fps ?? 30;

    const clips = [...renderPlan.timeline]
      .sort((a, b) => a.slot_no - b.slot_no)
      .map((item) => ({
        url: item.clip_url,
        durationInFrames: Math.round((item.duration_seconds ?? 4) * fps),
      }));

    const music = renderPlan.music
      ? {
          url: renderPlan.music.url,
          durationSeconds: renderPlan.music.duration_seconds,
          startSeconds: renderPlan.music.start_seconds ?? 0,
          endSeconds: renderPlan.music.end_seconds ?? null,
          volume: renderPlan.music.volume ?? 0.4,
          fadeInSeconds: renderPlan.music.fade_in_seconds ?? 1,
          fadeOutSeconds: renderPlan.music.fade_out_seconds ?? 2,
          loop: renderPlan.music.loop ?? true,
        }
      : undefined;

    const inputProps: Record<string, unknown> = { clips, music };

    const uuid = randomUUID();
    const localVideoPath = `${config.paths.tmp}/merge-${orderUuid}-${uuid}.mp4`;
    const localThumbPath = `${config.paths.tmp}/merge-${orderUuid}-${uuid}.jpg`;
    const s3VideoKey = `renders/final/${orderUuid}/merge-${uuid}.mp4`;
    const s3ThumbKey = `thumbnails/final/${orderUuid}/merge-${uuid}.jpg`;

    logger.info({ orderUuid, clipCount: clips.length }, "Starting final_merge render");
    const startTime = Date.now();

    try {
      await renderVideo({
        payload: { props: inputProps, composition: "MergeComposition" },
        outputLocation: localVideoPath,
      });

      await renderThumbnail({
        compositionId: "MergeComposition",
        inputProps,
        outputLocation: localThumbPath,
      });

      await uploadToS3(localVideoPath, s3VideoKey);
      await uploadThumbnailToS3(localThumbPath, s3ThumbKey);

      const finalVideoUrl = await buildVideoUrl(s3VideoKey);
      const thumbnailUrl = await buildThumbnailUrl(s3ThumbKey);
      const durationMs = Date.now() - startTime;

      logger.info({ orderUuid, durationMs }, "final_merge render completed");

      const response: LambdaResponse = { success: true, render_type: "final_merge", final_video_url: finalVideoUrl, thumbnail_url: thumbnailUrl, order_uuid: orderUuid };
      await deliverCallbackSafely(req.output?.callback_url, {
        correlation_id: req.correlation_id,
        idempotency_key: req.idempotency_key,
        order_uuid: orderUuid,
        render_type: "final_merge",
        status: "completed",
        final_video_url: finalVideoUrl,
        thumbnail_url: thumbnailUrl,
        metadata: {
          fps,
          clip_count: clips.length,
          render_duration_ms: durationMs,
        },
        timestamp: new Date().toISOString(),
      });

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ orderUuid, error: message }, "final_merge render failed");
      const response: LambdaResponse = { success: false, render_type: "final_merge", error: message, order_uuid: orderUuid };
      await deliverCallbackSafely(req.output?.callback_url, {
        correlation_id: req.correlation_id,
        idempotency_key: req.idempotency_key,
        order_uuid: orderUuid,
        render_type: "final_merge",
        status: "failed",
        error: message,
        metadata: {
          fps,
          clip_count: clips.length,
          render_duration_ms: Date.now() - startTime,
        },
        timestamp: new Date().toISOString(),
      });
      return response;
    } finally {
      safeUnlink(localVideoPath);
      safeUnlink(localThumbPath);
    }
  }

  // ── Unknown render_type ──────────────────────────────────────────────────────
  logger.error({ render_type: renderType }, "Unknown render_type");
  // Return a best-effort error. We don't know the type, so we can't satisfy the union perfectly —
  // cast through unknown to satisfy TypeScript while still returning a useful payload.
  return {
    success: false,
    render_type: "final_merge",
    error: `Unknown render_type: ${renderType ?? "(missing)"}. Must be "static_slot" or "final_merge".`,
    order_uuid: String((event as Record<string, unknown>).order_uuid ?? ""),
  } as LambdaResponse;
};
