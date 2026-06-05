# AI Remotion Video Renderer

AWS Lambda container that renders wedding invitation videos with [Remotion](https://www.remotion.dev/) and uploads the result to S3. Invoked synchronously by the `invitationpanel` backend — no HTTP server, no polling, no callbacks.

## How it works

```
invitationpanel (BullMQ worker)
  → Lambda InvokeCommand → handler.ts
  → renderVideo() — webpack bundle → Chrome → Remotion renderMedia
  → upload to S3
  → return { clip_url | final_video_url, thumbnail_url }
```

Two render types are supported:

- **static_slot** — renders a single invitation frame component into an MP4 clip
- **final_merge** — stitches all clips + AI videos + background music into the final video

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 / TypeScript (ESM) |
| Rendering | Remotion 4.x |
| Video package | `@evatrilvideo/ai-video-package` |
| Infrastructure | AWS Lambda (container image) |
| Storage | AWS S3 |
| Logging | Pino |

## Project structure

```
src/
├── lambda.ts                  # Lambda entry point — validation, cleanup
├── renderer.ts                # Remotion bundle, ensureBrowser, renderMedia
├── compositions/
│   └── StaticSlot.tsx         # Renders a single frame from frameRegistry
├── config/index.ts            # All env vars — single source of truth
├── errors/RenderError.ts      # ValidationError, RenderTimeoutError, S3UploadError
├── lib/logger.ts              # Pino structured logger
├── utils/
│   ├── s3Storage.ts           # S3 upload + URL builder
│   └── thumbnailStorage.ts    # JPEG thumbnail upload + URL builder
└── download-chrome.ts         # Bakes Chrome into the Docker image at build time
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `AWS_REGION` | `ap-south-1` | AWS region |
| `S3_BUCKET` | — | S3 bucket for rendered output |
| `RENDER_TIMEOUT` | `600000` | Render hard timeout in ms (10 min) |
| `LOG_LEVEL` | `info` | Pino log level |

## Deployment

Push to `main` → GitHub Actions builds the Docker image → pushes to ECR → updates the Lambda function.

Required GitHub secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ACCOUNT_ID`

Lambda function name: `ai-video-renderer`  
ECR repository: `ai_video_renderer`  
Region: `ap-south-1`

## Local commands

```bash
npm run build            # Compile TypeScript to dist/
npm run type-check       # Type-check without emitting
npm run download-chrome  # Download Chrome (run after build)
npm test                 # Run tests
```
