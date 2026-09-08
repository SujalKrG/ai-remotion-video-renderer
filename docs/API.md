# API — Lambda Invocation Contract

There is no HTTP surface. The "API" is the shape of the `Payload` passed to `InvokeCommand` and the shape of the JSON the Lambda returns. Both are validated/typed with Zod in `src/schemas/validation.ts`.

## Request: `static_slot`

Renders one invitation frame component into a standalone MP4 clip.

```json
{
  "render_type": "static_slot",
  "correlation_id": "ai-video:{orderUUID}:static:{slot_no}",
  "idempotency_key": "static:{orderUUID}:{slot_no}:v1",
  "order_uuid": "abc-123",
  "slot": {
    "slot_no": 1,
    "purpose": "cinematic_intro",
    "duration_seconds": 4,
    "video_frame": {
      "id": 5,
      "component_name": "CinematicIntroFrame",
      "config": {},
      "variables": {}
    }
  },
  "inputs": {},
  "output": {
    "callback_url": "https://invitationpanel.example.com/webhooks/render"
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `render_type` | yes | must be literal `"static_slot"` |
| `order_uuid` | yes | non-empty string |
| `correlation_id`, `idempotency_key` | no | passed through unchanged to logs and the callback payload |
| `slot.slot_no` | yes | positive integer |
| `slot.purpose` | no | free text, shown as placeholder text if the component isn't found |
| `slot.duration_seconds` | no | defaults to `4` |
| `slot.video_frame.id` | yes | numeric frame id (currently unused by the renderer, but part of the contract) |
| `slot.video_frame.component_name` | yes | must match a component's `displayName`/`name` in `@evatrilvideo/ai-video-package`'s `frameRegistry` |
| `slot.video_frame.config`, `.variables` | no | spread as props onto the resolved frame component |
| `inputs` | no | reserved, currently unused |
| `output.callback_url` | no | if present and a valid URL, triggers a webhook POST after render — see `docs/ARCHITECTURE.md` |

## Request: `final_merge`

Stitches all clips (static + AI-generated) with crossfades and background music into the final video.

```json
{
  "render_type": "final_merge",
  "correlation_id": "ai-video:{orderUUID}:merge",
  "idempotency_key": "merge:{orderUUID}:v1",
  "order_uuid": "abc-123",
  "render_plan": {
    "version": 1,
    "fps": 30,
    "music": {
      "url": "https://s3.../music.mp3",
      "duration_seconds": 38,
      "start_seconds": 0,
      "end_seconds": null,
      "volume": 0.4,
      "fade_in_seconds": 1,
      "fade_out_seconds": 2,
      "loop": true
    },
    "timeline": [
      { "slot_no": 1, "slot_type": "static", "clip_url": "https://s3.../clip1.mp4", "duration_seconds": 4 },
      { "slot_no": 2, "slot_type": "ai",     "clip_url": "https://s3.../clip2.mp4", "duration_seconds": 6 }
    ]
  },
  "output": {
    "callback_url": "https://invitationpanel.example.com/webhooks/render"
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `render_plan.version` | yes | positive integer |
| `render_plan.fps` | no | defaults to `30` |
| `render_plan.timeline` | yes | at least 1 item; sorted server-side by `slot_no` before rendering |
| `render_plan.timeline[].clip_url` | yes | must be a valid URL |
| `render_plan.timeline[].duration_seconds` | no | defaults to `4` seconds' worth of frames if omitted |
| `render_plan.music` | no | omit entirely for a silent video |
| `render_plan.music.end_seconds` | no | must be `> start_seconds` if provided (Zod `superRefine` check) |
| `render_plan.music.volume` | no | `0`–`1`, defaults to `0.4` |
| `render_plan.music.fade_in_seconds`/`fade_out_seconds` | no | independent linear fade envelopes at the start/end of the *rendered video's* duration, not the music's own duration |
| `render_plan.resolution`, `.transitions`, `.subtitles`, `.thumbnail.strategy` | no | accepted by the schema but currently unused by the renderer — reserved for future use |

## Response shapes

**`static_slot` success:**
```json
{ "success": true, "render_type": "static_slot", "clip_url": "...", "thumbnail_url": "...", "order_uuid": "abc-123", "slot_no": 1 }
```

**`static_slot` failure:**
```json
{ "success": false, "render_type": "static_slot", "error": "Validation error: slot.video_frame.component_name: ...", "order_uuid": "abc-123", "slot_no": 1 }
```

**`final_merge` success:**
```json
{ "success": true, "render_type": "final_merge", "final_video_url": "...", "thumbnail_url": "...", "order_uuid": "abc-123" }
```

**`final_merge` failure:**
```json
{ "success": false, "render_type": "final_merge", "error": "...", "order_uuid": "abc-123" }
```

`clip_url`/`final_video_url`/`thumbnail_url` are presigned S3 URLs by default (valid for `S3_SIGNED_URL_EXPIRY` seconds, default 7 days), or direct public URLs if `S3_URL_STRATEGY=public`.

Validation failures (bad payload shape) are returned as a normal `success: false` response — they never throw or produce a Lambda-level error, so the caller's error handling can rely on a single response shape.

## Callback payload (`output.callback_url`)

Only sent if the request included `output.callback_url`. POSTed as `application/json`, with `Authorization: Bearer <AI_VIDEO_SERVICE_TOKEN>` (if configured) and `X-Correlation-Id` (if `correlation_id` was on the request).

```json
{
  "correlation_id": "ai-video:abc-123:static:1",
  "idempotency_key": "static:abc-123:1:v1",
  "order_uuid": "abc-123",
  "render_type": "static_slot",
  "status": "completed",
  "clip_url": "...",
  "thumbnail_url": "...",
  "metadata": {
    "slot_no": 1,
    "duration_seconds": 4,
    "render_duration_ms": 8213
  },
  "timestamp": "2026-09-07T12:00:00.000Z"
}
```

On failure, `status: "failed"` and an `error` field replace `clip_url`/`final_video_url`/`thumbnail_url`. `final_merge` callbacks use `final_video_url` instead of `clip_url`, and `metadata` contains `fps`/`clip_count` instead of `slot_no`/`duration_seconds`.

The receiving endpoint should treat `2xx` as acknowledgement; any other status (or a network failure) triggers up to `CALLBACK_MAX_RETRIES` retries with exponential backoff, then gives up silently from the Lambda's perspective (logged, not surfaced to the caller).
