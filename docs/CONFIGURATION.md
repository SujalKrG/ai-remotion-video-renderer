# Configuration

All environment variables are read and defaulted in exactly one place: `src/config/index.ts`. Nothing elsewhere in the codebase should read `process.env` directly except that file (and the two build-time scripts, which run before the config module's guarantees matter). Copy `.env.example` to `.env` for local runs.

## AWS / S3

| Variable | Default | Notes |
|---|---|---|
| `AWS_REGION` | `ap-south-1` | Also accepts `AWS_DEFAULT_REGION` as a fallback |
| `AWS_BUCKET` | — | S3 bucket for renders + thumbnails. Also accepts `S3_BUCKET` as a fallback. Required at first S3 call — throws if unset |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | Standard AWS SDK credential resolution (env, IAM role, etc.) — not read directly by this codebase |
| `S3_URL_STRATEGY` | `presigned` | `presigned` (signed, works with private buckets) or `public` (direct `https://bucket.s3.region.amazonaws.com/...` — requires a public bucket/ACL) |
| `S3_SIGNED_URL_EXPIRY` | `604800` (7 days) | Seconds. AWS's max for IAM-user static credentials. Bumped from a 24h default because a `final_merge` call can reference an earlier `static_slot`'s `clip_url` as a render-plan input, and multi-day order flows need the link to still resolve when a customer views it later |

## Chrome

| Variable | Default | Notes |
|---|---|---|
| `CHROME_DIR` | `/var/task/.chrome` | Where `ensureBrowser`/`download-chrome.ts` look for the headless-shell binary |
| `CHROME_DOWNLOAD_TIMEOUT` | `120000` (2 min) | Only matters if Chrome isn't already present — in the shipped container image it always is |
| `PUPPETEER_EXECUTABLE_PATH` | *(set by Dockerfile)* | If set, `findBrowserExecutable()` uses it directly, skipping the candidate-path search |

## Render

| Variable | Default | Notes |
|---|---|---|
| `RENDER_TIMEOUT` | `600000` (10 min) | Hard ceiling for a single render. In Lambda, the *effective* timeout is `min(this, remaining Lambda time − 30s)` — see `deriveRenderTimeout` in `src/lambda.ts` |
| `RENDER_CONCURRENCY` | `1` | Chrome tabs/processes used per render. Increasing this trades memory for speed — check available Lambda memory first (Chrome is the dominant consumer) |
| `VIDEO_CRF` | `23` | H.264 constant rate factor — lower is higher quality/larger file |
| `FRAME_TIMEOUT` | `120000` (2 min) | Per-frame render timeout, independent of the overall hard timeout |
| `DEFAULT_COMPOSITION` | `Video` | Fallback composition id if a request omits `payload.composition` — in practice both call sites in `lambda.ts` always specify one explicitly (`StaticSlot`/`MergeComposition`), so this only matters for direct/manual `renderVideo()` calls |

## Callback

| Variable | Default | Notes |
|---|---|---|
| `CALLBACK_MAX_RETRIES` | `3` | Total attempts (not additional retries) before giving up |
| `CALLBACK_TIMEOUT_MS` | `10000` | Per-attempt HTTP timeout |
| `CALLBACK_RETRY_BASE_DELAY_MS` | `1000` | Exponential backoff base — delay is `base * 2^(attempt-1)` |

## Auth

| Variable | Default | Notes |
|---|---|---|
| `AI_VIDEO_SERVICE_TOKEN` | — | If set, sent as `Authorization: Bearer <token>` on outbound callback POSTs. Not used to authenticate *incoming* Lambda invocations — that's controlled by IAM on the `InvokeCommand` caller |

## Thumbnail

| Variable | Default | Notes |
|---|---|---|
| `THUMBNAIL_ENABLED` | `1` | Present in config but **not currently read** by `lambda.ts` — a thumbnail is always rendered on both paths today. Reserved for a future opt-out |
| `THUMBNAIL_FRAME_INDEX` | `0` | Which frame of the composition to capture as the still-image thumbnail |

## Logging

| Variable | Default | Notes |
|---|---|---|
| `LOG_LEVEL` | `info` | Pino level: `debug` \| `info` \| `warn` \| `error` |

## Non-configurable paths (hardcoded, not env vars)

`src/config/index.ts` also fixes `/tmp`, `/tmp/.remotion`, `/tmp/.cache` as the only writable directories — these match Lambda's read-only-filesystem constraint (see `docs/DEPLOYMENT.md`) and are not meant to be overridden.
