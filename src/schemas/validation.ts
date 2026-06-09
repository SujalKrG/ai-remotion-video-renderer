import { z } from "zod";

// ── Video Frame Schema ─────────────────────────────────────────────────────────

export const VideoFrameSchema = z.object({
  id: z.number(),
  component_name: z.string().min(1, "component_name cannot be empty"),
  config: z.record(z.unknown()).optional().default({}),
  variables: z.record(z.unknown()).optional().default({}),
});

// ── Slot Schema ────────────────────────────────────────────────────────────────

export const SlotSchema = z.object({
  slot_no: z.number().int().positive("slot_no must be a positive integer"),
  purpose: z.string().optional(),
  duration_seconds: z.number().positive().optional().default(4),
  video_frame: VideoFrameSchema,
});

// ── Timeline Item Schema ───────────────────────────────────────────────────────

export const TimelineItemSchema = z.object({
  slot_no: z.number().int().positive(),
  slot_type: z.string(),
  clip_url: z.string().url("clip_url must be a valid URL"),
  duration_seconds: z.number().positive().optional(),
});

// ── Music Schema ───────────────────────────────────────────────────────────────

export const MusicSchema = z.object({
  music_library_id: z.number().nullable().optional(),
  source: z.enum(["music_library", "custom_upload"]).optional(),
  url: z.string().url("music URL must be valid"),
  duration_seconds: z.number().positive().optional(),
  start_seconds: z.number().min(0).optional(),
  end_seconds: z.number().positive().nullable().optional(),
  volume: z.number().min(0).max(1).optional(),
  fade_in_seconds: z.number().min(0).optional(),
  fade_out_seconds: z.number().min(0).optional(),
  loop: z.boolean().optional(),
}).superRefine((music, ctx) => {
  if (
    music.end_seconds != null &&
    music.end_seconds <= (music.start_seconds ?? 0)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["end_seconds"],
      message: "end_seconds must be greater than start_seconds",
    });
  }
});

// ── Render Plan Schema ─────────────────────────────────────────────────────────

export const RenderPlanSchema = z.object({
  version: z.number().int().positive(),
  order_uuid: z.string().optional(),
  resolution: z.string().optional(),
  fps: z.number().int().positive().default(30),
  music: MusicSchema.optional(),
  timeline: z.array(TimelineItemSchema).min(1, "timeline must have at least one item"),
  transitions: z.record(z.unknown()).optional(),
  subtitles: z.record(z.unknown()).optional(),
  thumbnail: z.object({
    strategy: z.string().optional(),
  }).optional(),
});

// ── Static Slot Request Schema ────────────────────────────────────────────────

export const StaticSlotRequestSchema = z.object({
  correlation_id: z.string().optional(),
  idempotency_key: z.string().optional(),
  render_type: z.literal("static_slot"),
  order_uuid: z.string().min(1, "order_uuid is required"),
  slot: SlotSchema,
  inputs: z.record(z.unknown()).optional(),
  output: z.object({
    callback_url: z.string().url().optional(),
  }).optional(),
});

// ── Final Merge Request Schema ────────────────────────────────────────────────

export const FinalMergeRequestSchema = z.object({
  correlation_id: z.string().optional(),
  idempotency_key: z.string().optional(),
  render_type: z.literal("final_merge"),
  order_uuid: z.string().min(1, "order_uuid is required"),
  render_plan: RenderPlanSchema,
  output: z.object({
    callback_url: z.string().url().optional(),
  }).optional(),
});

// ── Union Schema ───────────────────────────────────────────────────────────────

export const LambdaEventSchema = z.union([
  StaticSlotRequestSchema,
  FinalMergeRequestSchema,
]);

// ── Type Exports ───────────────────────────────────────────────────────────────

export type StaticSlotRequest = z.infer<typeof StaticSlotRequestSchema>;
export type FinalMergeRequest = z.infer<typeof FinalMergeRequestSchema>;
export type LambdaEvent = z.infer<typeof LambdaEventSchema>;
