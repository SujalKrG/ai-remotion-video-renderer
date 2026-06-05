# Remotion Render Service

> 🎬 **Production-Grade Video Rendering on AWS Lambda**  
> Multi-stage Docker builds • Comprehensive font caching • 70% faster rebuilds • 47% faster cold starts

Deterministic rendering execution service for the distributed AI video architecture.

This service is a **stateless rendering engine** — it receives render jobs from the Node backend conductor, executes them through Remotion (Lambda or local), uploads outputs to S3, and delivers results via callback.

## ⚡ Quick Links

- **[Quick Start Guide](./QUICK_START.md)** - Get running in 5 minutes
- **[Build & Deploy Guide](./BUILD_DEPLOY_GUIDE.md)** - Complete deployment instructions
- **[Docker Optimization Guide](./DOCKER_OPTIMIZATION.md)** - Technical deep dive
- **[Phase 1 Summary](./PHASE1_SUMMARY.md)** - Recent improvements

## 🚀 Recent Improvements (Phase 1)

✅ **Multi-stage Docker builds** - 4-stage pipeline with optimal caching  
✅ **Font pre-caching** - 47% faster cold starts (8s vs 15s)  
✅ **Chrome pre-download** - Eliminates 30-60s download time  
✅ **70% faster rebuilds** - Intelligent layer caching (2-3 min vs 8-10 min)  
✅ **25-30% smaller images** - Production deps only (600-700MB)  
✅ **Comprehensive tooling** - Build scripts, local testing, docker-compose

---

## Architecture Position

```
Node Backend (Conductor)
    │
    ├── POST /render/static  ──►  Remotion Render Service  ──►  S3
    ├── POST /render/merge   ──►  Remotion Render Service  ──►  S3
    │                                      │
    └──────────── callback ◄───────────────┘
```

This service owns:
- Deterministic rendering
- Static slot rendering
- Final timeline merge
- Transitions, subtitles, audio layering
- Thumbnails
- AWS Lambda deployment
- S3 output storage

This service does **NOT** own: orders, payments, AI generation, uploads, auth, orchestration.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ / TypeScript |
| Rendering | Remotion 4.x |
| Lambda | @remotion/lambda |
| Storage | AWS S3 |
| Validation | Zod |
| Logging | Pino |
| HTTP | Express |
| Callbacks | Axios |

---

## Project Structure

```
src/
├── config/          # Environment configuration
├── contracts/       # Zod schemas — payload contracts
├── compositions/    # Remotion React compositions
│   ├── StaticInvitationSlot.tsx
│   ├── CinematicTitle.tsx
│   └── TimelineMergeComposition.tsx
├── remotion/        # Remotion root + composition registry
│   ├── Root.tsx
│   └── index.ts
├── lambda/          # Lambda + local render executors
│   ├── lambdaRenderer.ts
│   └── localRenderer.ts
├── services/        # Render orchestration services
│   ├── staticRenderService.ts
│   └── mergeRenderService.ts
├── routes/          # Express route handlers
│   ├── health.route.ts
│   ├── staticRender.route.ts
│   ├── mergeRender.route.ts
│   └── callbackReplay.route.ts
├── callbacks/       # Callback delivery with retry
│   └── callbackDelivery.ts
├── storage/         # S3 upload helpers
│   ├── s3Client.ts
│   └── s3Uploader.ts
├── transitions/     # Transition registry
│   └── transitionRegistry.ts
├── audio/           # Audio layer utilities
│   └── audioLayer.ts
├── subtitles/       # Subtitle validation + SRT parser
│   └── subtitleRenderer.ts
├── logging/         # Pino logger factory
│   └── logger.ts
├── utils/           # Shared utilities
│   ├── renderUtils.ts
│   └── thumbnailUtils.ts
├── tests/           # Unit tests
└── server.ts        # Express server entry point

scripts/
└── deployLambda.ts  # AWS Lambda deployment script
```

---

## API Endpoints

### `GET /health`

Returns service health status.

```json
{
  "status": "ok",
  "service": "remotion-render-service",
  "environment": "production",
  "render_mode": "lambda"
}
```

---

### `POST /render/static`

Accepts a static slot render job. Returns `202 Accepted` immediately. Result delivered via callback.

**Request:**
```json
{
  "correlation_id": "uuid",
  "idempotency_key": "uuid",
  "callback_url": "https://node-backend/callback",
  "slot_no": 2,
  "composition_name": "StaticInvitationSlot",
  "duration_seconds": 5,
  "fps": 30,
  "resolution": { "width": 1080, "height": 1920 },
  "props": {
    "title": "Wedding Invitation",
    "subtitle": "Save the Date",
    "names": ["Alex", "Jordan"],
    "background_image_url": "https://cdn.example.com/bg.jpg"
  }
}
```

**Response (202):**
```json
{
  "render_id": "uuid",
  "correlation_id": "uuid",
  "idempotency_key": "uuid",
  "status": "accepted",
  "message": "Static render job accepted. Result will be delivered via callback."
}
```

---

### `POST /render/merge`

Accepts a final timeline merge render job. Returns `202 Accepted` immediately.

**Request:**
```json
{
  "correlation_id": "uuid",
  "idempotency_key": "uuid",
  "callback_url": "https://node-backend/callback",
  "fps": 30,
  "resolution": { "width": 1080, "height": 1920 },
  "music_url": "https://cdn.example.com/music.mp3",
  "timeline": [
    { "slot_no": 1, "type": "static", "clip_url": "https://s3.example.com/clip1.mp4" },
    { "slot_no": 2, "type": "ai", "clip_url": "https://s3.example.com/clip2.mp4" }
  ],
  "transition_config": { "type": "fade", "duration_frames": 15 }
}
```

---

### `POST /callbacks/replay`

Re-delivers a callback payload. Used for recovery scenarios.

---

## Callback Payload

Delivered to `callback_url` on completion or failure:

```json
{
  "correlation_id": "uuid",
  "idempotency_key": "uuid",
  "render_id": "uuid",
  "render_type": "merge",
  "status": "completed",
  "output_url": "https://s3.amazonaws.com/renders/uuid/output.mp4",
  "thumbnail_url": "https://s3.amazonaws.com/thumbnails/uuid/thumbnail.jpg",
  "metadata": {
    "duration_seconds": 30,
    "fps": 30,
    "width": 1080,
    "height": 1920,
    "render_duration_ms": 45000
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

## Supported Compositions

| ID | Description |
|---|---|
| `StaticInvitationSlot` | Wedding/event invitation with animated text and background |
| `CinematicTitle` | Cinematic title card with letterbox and spring animations |
| `TimelineMergeComposition` | Final timeline merge with transitions, subtitles, and music |

---

## Supported Transitions

`fade` · `dissolve` · `slide_left` · `slide_right` · `slide_up` · `slide_down` · `zoom_in` · `zoom_out` · `wipe` · `none`

---

---

## 🐳 Docker & Deployment

### Quick Start

```bash
# Build production image
npm run docker:build

# Test locally
docker run -p 9000:8080 --env-file .env ai-video-renderer:latest

# Invoke test
curl -X POST "http://localhost:9000/2015-03-31/functions/function/invocations" \
  -H "Content-Type: application/json" \
  -d @test-payloads/static-slot.json
```

### Available Scripts

```bash
# Docker production
npm run docker:build              # Build optimized image
npm run docker:build:cache        # Build with BuildKit cache
npm run docker:test               # Test Lambda locally

# Docker development
npm run docker:build:dev          # Build dev image
docker-compose up dev             # Start dev environment

# Docker Compose
npm run docker:compose:up         # Start all services
npm run docker:compose:down       # Stop all services
npm run docker:compose:logs       # View logs
```

### Deployment to AWS

```bash
# 1. Build image
./scripts/build-docker.sh         # Linux/Mac
.\scripts\build-docker.ps1        # Windows

# 2. Push to ECR (automated via GitHub Actions on push to main)
git push origin main

# 3. Manual deployment
aws ecr get-login-password | docker login --username AWS --password-stdin <ECR_URI>
docker tag ai-video-renderer:latest <ECR_URI>:latest
docker push <ECR_URI>:latest
aws lambda update-function-code --function-name ai-video-renderer --image-uri <ECR_URI>:latest
```

See **[BUILD_DEPLOY_GUIDE.md](./BUILD_DEPLOY_GUIDE.md)** for complete instructions.

---

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — AWS credentials not required for local rendering
```

### 3. Start the service

```bash
npm run dev
```

The service starts on `http://localhost:3100`.

In development mode (`NODE_ENV=development` or no `REMOTION_SERVE_URL`), renders execute locally using `@remotion/renderer` instead of Lambda.

### 4. Preview compositions in Remotion Studio

```bash
npm run studio
```

---

## AWS Lambda Deployment

### Prerequisites

1. AWS account with IAM permissions for Lambda, S3, CloudWatch
2. AWS credentials configured:
   ```bash
   export AWS_ACCESS_KEY_ID=...
   export AWS_SECRET_ACCESS_KEY=...
   export AWS_REGION=us-east-1
   ```

### Deploy

```bash
npm run deploy:lambda
```

This script:
1. Creates/verifies the Remotion S3 bucket
2. Deploys the Remotion Lambda function
3. Bundles and uploads all compositions to S3
4. Outputs the values to add to your `.env`

### Required IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunction",
        "lambda:InvokeFunction",
        "s3:CreateBucket",
        "s3:PutObject",
        "s3:GetObject",
        "s3:HeadObject",
        "s3:ListBucket",
        "iam:GetRole",
        "iam:PassRole",
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

### Post-deployment `.env` values

After running `npm run deploy:lambda`, add the printed values to your `.env`:

```env
REMOTION_LAMBDA_FUNCTION_NAME=remotion-render-...
REMOTION_LAMBDA_REGION=us-east-1
REMOTION_SERVE_URL=https://s3.amazonaws.com/remotionlambda-.../sites/remotion-render-service/index.html
S3_BUCKET=remotionlambda-...
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3100` | HTTP server port |
| `NODE_ENV` | No | `development` | Environment |
| `AWS_REGION` | Yes (prod) | `us-east-1` | AWS region |
| `AWS_ACCESS_KEY_ID` | Yes (prod) | — | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | Yes (prod) | — | AWS secret key |
| `S3_BUCKET` | Yes (prod) | — | S3 output bucket |
| `S3_URL_STRATEGY` | No | `public` | `public` or `presigned` |
| `REMOTION_LAMBDA_FUNCTION_NAME` | Yes (prod) | — | Lambda function name |
| `REMOTION_SERVE_URL` | Yes (prod) | — | Remotion bundle S3 URL |
| `REMOTION_LAMBDA_MEMORY_MB` | No | `2048` | Lambda memory |
| `REMOTION_LAMBDA_TIMEOUT_SECONDS` | No | `120` | Lambda timeout |
| `CALLBACK_MAX_RETRIES` | No | `3` | Callback retry attempts |
| `CALLBACK_RETRY_BASE_DELAY_MS` | No | `1000` | Retry base delay |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `LOG_FORMAT` | No | `pretty` | `pretty` or `json` |

---

## Adding New Compositions

1. Create `src/compositions/MyNewSlot.tsx` with typed props
2. Register in `src/remotion/Root.tsx`:
   ```tsx
   <Composition
     id="MyNewSlot"
     component={MyNewSlot}
     durationInFrames={150}
     fps={30}
     width={1080}
     height={1920}
     defaultProps={myNewSlotDefaultProps}
   />
   ```
3. Re-deploy: `npm run deploy:lambda`
4. Node backend can now send `composition_name: "MyNewSlot"` in render requests

---

## Observability

Every log line carries structured context:

```json
{
  "level": "info",
  "service": "remotion-render-service",
  "correlation_id": "uuid",
  "render_id": "uuid",
  "render_type": "static",
  "composition_name": "StaticInvitationSlot",
  "msg": "Static render completed",
  "totalDurationMs": 12500
}
```

---

## Running Tests

```bash
npm test
```

---

## S3 Output Structure

```
s3://{bucket}/
├── renders/{render_id}/output.mp4
├── thumbnails/{render_id}/thumbnail.jpg
└── metadata/{render_id}/metadata.json
```
