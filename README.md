# AI Remotion Video Renderer

AWS Lambda container that renders wedding invitation videos with [Remotion](https://www.remotion.dev/) and uploads the result to S3. Invoked directly by the `invitationpanel` backend's BullMQ workers via `InvokeCommand` — no HTTP server, no polling. The call blocks until the render finishes and returns the S3 URL; an optional webhook callback can also be requested for out-of-band notification.

## How it works

```
invitationpanel (BullMQ worker)
  → Lambda InvokeCommand → lambda.ts → Zod-validate event
  → renderVideo() — webpack bundle → Chrome → Remotion renderMedia
  → renderThumbnail() → upload video + thumbnail to S3
  → return { clip_url | final_video_url, thumbnail_url }
  → (optional) POST result to output.callback_url, retried with backoff
```

Two render types are supported:

- **static_slot** — renders a single invitation frame component (from `@evatrilvideo/ai-video-package`'s `frameRegistry`) into an MP4 clip
- **final_merge** — crossfades all clips together with background music into the final video

Full documentation lives in [`docs/`](docs/):

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers, bundling, timeout/cancel model
- [`docs/API.md`](docs/API.md) — request/response contracts, callback payloads
- [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) — every environment variable
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Docker build stages, CI/CD
- [`docs/TESTING.md`](docs/TESTING.md) — test suite layout

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 / TypeScript (ESM) |
| Rendering | Remotion 4.x |
| Video package | `@evatrilvideo/ai-video-package` |
| Validation | Zod |
| Infrastructure | AWS Lambda (container image) |
| Storage | AWS S3 |
| Logging | Pino |
| Tests | Jest (ESM mode) |

## Project structure

```
src/
├── lambda.ts                      # Lambda entry point — validation, render dispatch, callback, cleanup
├── renderer.ts                    # Remotion bundle (webpack override), ensureBrowser, renderMedia/renderStill
├── schemas/validation.ts          # Zod schemas — the wire contract for both render types
├── callbacks/callbackDelivery.ts  # Optional webhook POST with retry/backoff
├── compositions/
│   ├── StaticSlot.tsx             # Renders a single frame from frameRegistry
│   └── MergeComposition.tsx       # Crossfades clips + background music
├── remotion/
│   ├── index.ts                  # registerRoot entry point
│   ├── Root.tsx                  # <Composition> registry (StaticSlot, MergeComposition)
│   └── localRegisterFonts.ts     # Loads pre-baked fonts instead of fetching from S3
├── config/index.ts                # All env vars — single source of truth
├── errors/RenderError.ts          # ValidationError, RenderTimeoutError, S3UploadError, BrowserError
├── lib/logger.ts                  # Pino structured logger
├── utils/
│   ├── s3Storage.ts               # S3 upload + retry + presigned/public URL builder
│   └── thumbnailStorage.ts        # JPEG thumbnail upload
├── download-chrome.ts             # Build-time: bakes Chrome into the Docker image
├── download-fonts.ts              # Build-time: pre-bakes fonts into public/fonts/
└── tests/                         # Jest test suite (see docs/TESTING.md)
```

## Environment variables

See [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) for the full table (S3, Chrome, render, callback, thumbnail, and auth settings). Copy `.env.example` to `.env` for local runs.

## Deployment

Push to `main` → GitHub Actions builds the Docker image → pushes to ECR → updates the Lambda function. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Required GitHub secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ACCOUNT_ID`

Lambda function name: `ai-video-renderer`
ECR repository: `ai_video_renderer`
Region: `ap-south-1`

## Local commands

```bash
npm run build            # Compile TypeScript to dist/
npm run type-check       # Type-check without emitting
npm run download-chrome  # Download Chrome (run after build)
npm run download-fonts   # Pre-bake fonts (run after build)
npm test                 # Run tests
npm run docker:build     # Build the Lambda container image locally
npm run docker:test      # Run the built image locally on port 9000
```
