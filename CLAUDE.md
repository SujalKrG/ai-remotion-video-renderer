# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build            # Compile TypeScript to dist/
npm run type-check       # Type-check without emitting
npm run download-chrome  # Download Chrome into /var/task/.chrome (run after build)
```

## Architecture

This is an **AWS Lambda container function** that renders wedding invitation videos via Remotion and uploads the result to S3. It is invoked directly by the `invitationpanel` backend — no HTTP server, no polling, no callbacks.

### Invocation model

```
invitationpanel (BullMQ worker)
  → aws-sdk InvokeCommand → Lambda handler (handler.ts)
  → validate event fields

  static_slot path:
  → renderVideo("StaticSlot") — bundle package → ensureBrowser → selectComposition → renderMedia
  → renderThumbnail → uploadToS3 → return { clip_url, thumbnail_url }

  final_merge path:
  → renderVideo("MergeComposition") — bundle package → ensureBrowser → selectComposition → renderMedia
  → renderThumbnail → uploadToS3 → return { final_video_url, thumbnail_url }
```

The Lambda function is **synchronous from the caller's perspective** — it blocks until the video is rendered and uploaded, then returns the S3 URL directly. No callback URL needed.

### Layer map

| Layer | Path | Responsibility |
|-------|------|----------------|
| Handler | `src/lambda.ts` | Lambda entry point, validation, error handling, temp file cleanup |
| Renderer | `src/renderer.ts` | Remotion bundle (with webpack override), `ensureBrowser`, `renderMedia`, hard timeout |
| Storage | `src/utils/s3Storage.ts` | S3 upload + public URL builder |
| Thumbnail | `src/utils/thumbnailStorage.ts` | JPEG thumbnail S3 upload + URL builder |
| StaticSlot | `src/compositions/StaticSlot.tsx` | Renders a single frame component by name from frameRegistry |
| Config | `src/config/index.ts` | All env vars with defaults — single source of truth |
| Errors | `src/errors/RenderError.ts` | `ValidationError`, `RenderTimeoutError`, `S3UploadError`, `BrowserError` |
| Logger | `src/lib/logger.ts` | Pino structured logger |
| Chrome | `src/download-chrome.ts` | Bakes Chrome into the Docker image at build time |

### Video package

Compositions come from `@evatrilvideo/ai-video-package` (npm). The package exports:
- `VideoComposition` — sequences named frames with shared `videoData` props
- `frameRegistry` — maps frame IDs to their components and durations

The renderer bundles directly from the package's `remotionRoot.jsx` entry point. A **webpack override** is required to allow the bundler to process JSX files inside the package's `src/` directory (webpack excludes `node_modules` JSX by default).

### Request shapes (from invitationpanel)

Two render types are dispatched by the Node backend's BullMQ workers.

**Static slot** — renders a single invitation frame component:
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
  "inputs": {}
}
```

**Final merge** — stitches all clips + AI videos + music into the final video:
```json
{
  "render_type": "final_merge",
  "correlation_id": "ai-video:{orderUUID}:merge",
  "idempotency_key": "merge:{orderUUID}:v1",
  "order_uuid": "abc-123",
  "render_plan": {
    "version": 1,
    "fps": 30,
    "music": { "url": "https://s3.../music.mp3", "duration_seconds": 38 },
    "timeline": [
      { "slot_no": 1, "slot_type": "static", "clip_url": "https://s3.../clip1.mp4", "duration_seconds": 4 },
      { "slot_no": 2, "slot_type": "ai",     "clip_url": "https://s3.../clip2.mp4", "duration_seconds": 6 }
    ]
  }
}
```

### Response shapes

Static slot success:
```json
{ "success": true, "render_type": "static_slot", "clip_url": "...", "thumbnail_url": "...", "order_uuid": "abc-123", "slot_no": 1 }
```

Final merge success:
```json
{ "success": true, "render_type": "final_merge", "final_video_url": "...", "thumbnail_url": "...", "order_uuid": "abc-123" }
```

### Deployment

Push to `main` → GitHub Actions builds Docker image → pushes to ECR → updates Lambda.

Required GitHub secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ACCOUNT_ID`.

Lambda function name: `ai-video-renderer`. ECR repo: `ai_video_renderer`.

### Key patterns

- **ESM module** (`"type": "module"`), TypeScript compiled with `NodeNext` module resolution. All imports use `.js` extensions.
- **Chrome baked in at build time**: `download-chrome.ts` runs during `docker build` so cold starts don't wait on Chrome download. `ensureBrowser()` is called before every render as a no-op verification.
- **Hard timeout + cancel signal**: `makeCancelSignal()` from `@remotion/renderer` cancels an in-progress render if it exceeds `RENDER_TIMEOUT` (default 10 min).
- **Bundle caching**: `cachedBundleLocation` is a module-level variable — the webpack bundle is reused across warm Lambda invocations.
- **Temp file cleanup**: `/tmp` is shared across warm invocations. The `finally` block in `lambda.ts` always deletes the rendered `.mp4` to prevent `/tmp` exhaustion.
- **Structured logging**: Pino. Never use `console.log`.
