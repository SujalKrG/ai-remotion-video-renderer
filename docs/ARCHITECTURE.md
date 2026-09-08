# Architecture

## What this service is

An AWS Lambda **container image** function. It has no HTTP server and no queue consumer of its own — it is invoked directly via the AWS SDK `InvokeCommand` by the `invitationpanel` backend's BullMQ workers, blocks for the duration of the render, and returns the finished S3 URLs in the Lambda response payload.

## Invocation flow

```
invitationpanel (BullMQ worker)
        │  aws-sdk InvokeCommand({ FunctionName: "ai-video-renderer", Payload: <event> })
        ▼
src/lambda.ts  handler(event, context)
        │  fs.mkdirSync tmp/cache dirs (cold-start safety)
        │  deriveRenderTimeout(context) — see "Timeout model" below
        │  branch on event.render_type
        │
        ├── "static_slot" ──────────────────────────────────────────────┐
        │     StaticSlotRequestSchema.safeParse(event)                  │
        │     on failure → return { success:false, error, ... }         │
        │     on success →                                              │
        │       renderVideo({ composition: "StaticSlot", props })       │
        │       renderThumbnail({ compositionId: "StaticSlot" })        │
        │       uploadToS3(video) + uploadThumbnailToS3(thumb)          │
        │       buildVideoUrl / buildThumbnailUrl                       │
        │       deliverCallbackSafely(...)  — fire-and-forget           │
        │       return { success:true, clip_url, thumbnail_url, ... }   │
        │     finally → safeUnlink(video), safeUnlink(thumb)            │
        │                                                                │
        └── "final_merge" ───────────────────────────────────────────────
              FinalMergeRequestSchema.safeParse(event)
              on success →
                sort timeline by slot_no, convert seconds → frames
                renderVideo({ composition: "MergeComposition", props })
                renderThumbnail({ compositionId: "MergeComposition" })
                upload + build URLs
                deliverCallbackSafely(...)
                return { success:true, final_video_url, thumbnail_url, ... }
              finally → cleanup temp files
```

Any `render_type` other than `static_slot`/`final_merge` falls through to an "Unknown render_type" error response — this is a `RenderError`-shaped failure, not a thrown exception, so the Lambda invocation itself always succeeds from AWS's perspective; success/failure is communicated in the payload.

## Rendering pipeline (`src/renderer.ts`)

1. **`getBundleLocation()`** — webpack-bundles `src/remotion/index.ts` via `@remotion/bundler`. The bundle is cached in a module-level variable (`cachedBundleLocation`) so warm Lambda invocations skip re-bundling.
2. **Webpack override** — two problems solved here:
   - Webpack excludes `node_modules` from its JSX/TS loader by default. Since `@evatrilvideo/ai-video-package`'s components live in `node_modules` but are authored as JSX/TSX, the override rewrites the loader's `exclude` function to whitelist the package's `src/` directory specifically.
   - The package's `registerFonts.js` fetches fonts from S3 at render time. A webpack `resolve.alias` redirects that import to this repo's `src/remotion/localRegisterFonts.ts`, which instead loads fonts already baked into the bundle's `public/fonts/` at Docker build time (see `download-fonts.ts`).
3. **`ensureBrowser()`** — verifies/downloads the headless Chrome binary. In the container image this is a no-op because Chrome is pre-baked (see `docs/DEPLOYMENT.md`); `findBrowserExecutable()` checks `PUPPETEER_EXECUTABLE_PATH` first, then falls back through a list of common binary paths.
4. **`selectComposition()`** — resolves the named composition (`StaticSlot` or `MergeComposition`) against the bundle, passing `inputProps` so any dynamic duration logic in the composition itself is honored.
5. **`computeCompositionDuration()`** — recomputes the *actual* frame count server-side rather than trusting the composition's default:
   - `StaticSlot`: `duration_seconds * fps`
   - `MergeComposition`: sums clip durations, subtracting the crossfade overlap between each consecutive pair — this must mirror `MergeComposition.tsx`'s own overlap math exactly, or the render will end in trailing blank frames or cut off before the visual crossfade completes.
6. **`renderMedia()`** — the actual Remotion render. Runs under a hard timeout (see below), `crf`/`concurrency`/`frameTimeout` from config, and `chromiumOptions: { disableWebSecurity: true }` (needed because `OffthreadVideo` clips are fetched from cross-origin S3 URLs).
7. **`renderThumbnail()`** — a separate `renderStill()` call at `config.thumbnail.frameIndex` (default frame 0), same bundle/composition, output as JPEG.

## Timeout & cancellation model

Two independent timeout mechanisms:

- **Per-invocation hard timeout** (`deriveRenderTimeout` in `lambda.ts`): computed from the Lambda context's `getRemainingTimeInMillis()` minus a 30-second buffer for S3 upload + callback + cleanup, floored at 30s, capped by `RENDER_TIMEOUT` if no context is available (e.g. local/test runs). This is passed into `renderVideo({ timeoutMs })`.
- **Cancel signal** (`renderer.ts`): `makeCancelSignal()` from `@remotion/renderer` wires a `setTimeout` that calls `cancel()` on the render if `hardTimeoutMs` elapses, which Remotion turns into a clean abort rather than letting the Lambda hard-kill mid-write.
- **Per-frame timeout** (`FRAME_TIMEOUT` / `config.render.frameTimeout`): passed as `renderMedia`'s own `timeoutInMilliseconds`, guarding against a single stuck frame rather than the whole render.

## Callback delivery (`src/callbacks/callbackDelivery.ts`)

If the request includes `output.callback_url`, `deliverRenderCallback()` POSTs a `RenderCallbackPayload` (same shape as the Lambda's own return value, plus `correlation_id`/`idempotency_key`/`metadata`) to that URL after the render completes *or* fails. It is:

- **Optional** — omitted entirely if no `callback_url` is present.
- **Best-effort from the handler's perspective** — `deliverCallbackSafely()` in `lambda.ts` swallows any error from delivery and only logs it; callback failure never changes the Lambda's own response or throws.
- **Retried internally** — up to `CALLBACK_MAX_RETRIES` attempts with exponential backoff (`CALLBACK_RETRY_BASE_DELAY_MS * 2^(attempt-1)`), but only for retryable failures: no response (network error), `408`, `429`, or `5xx`. A `4xx` other than 408/429 fails immediately without retrying.
- **Authenticated** — if `AI_VIDEO_SERVICE_TOKEN` is set, sent as `Authorization: Bearer <token>`; `correlation_id` (if present) is also sent as an `X-Correlation-Id` header.

This is a genuinely separate channel from the Lambda's synchronous return value — both fire on the same render outcome, but a caller only using `InvokeCommand` and ignoring `output.callback_url` sees no difference in behavior.

## S3 layer (`src/utils/s3Storage.ts`, `src/utils/thumbnailStorage.ts`)

- S3 client is lazily constructed (only when first needed) with a keep-alive HTTPS agent and 3 built-in SDK retry attempts.
- `uploadToS3`/`uploadThumbnailToS3` wrap the actual `PutObjectCommand` in an **additional** application-level retry (`retryWithBackoff`, up to 3 attempts, exponential backoff + jitter, capped at 10s) for a specific allowlist of transient error codes (`ECONNRESET`, `ETIMEDOUT`, `ServiceUnavailable`, `SlowDown`, `TooManyRequests`, etc.). Non-retryable errors (e.g. permissions) fail immediately.
- `thumbnailStorage.ts` **duplicates** this retry helper rather than importing it from `s3Storage.ts` — the comment in the source notes this is deliberate, to avoid a circular import between the two modules.
- URL building (`buildVideoUrl`/`buildThumbnailUrl`) defaults to a **presigned URL** (`S3_SIGNED_URL_EXPIRY` seconds, default 7 days — see `docs/CONFIGURATION.md` for why this was bumped from 24h). Set `S3_URL_STRATEGY=public` to instead return a direct `https://bucket.s3.region.amazonaws.com/...` URL (requires a public bucket/object ACL).

## Compositions

- **`StaticSlot.tsx`** — looks up `component_name` in a registry built from `@evatrilvideo/ai-video-package`'s `frameRegistry` (`buildComponentRegistry`, keyed by the component's `displayName` or `name`). If the component isn't found, renders a black frame with the `purpose`/`component_name` as placeholder text instead of failing the whole render — this is deliberate graceful degradation, not a bug. Blocks first paint on `registerFonts()` via Remotion's `delayRender`/`continueRender`.
- **`MergeComposition.tsx`** — places each clip in a `<Sequence>`, computing a negative-overlap `from` offset per clip so each one crossfades into the previous rather than hard-cutting (capped at the shorter of the two adjacent clips' durations, so a very short clip can't produce a negative timeline). Background music gets independent fade-in/fade-out envelopes and an optional trim window (`start_seconds`/`end_seconds`).

## Known asymmetries worth knowing about

- `renderer.ts`'s `computeCompositionDuration` duplicates `MergeComposition.tsx`'s crossfade-overlap math rather than importing it — the two must be kept in sync manually if the overlap formula ever changes.
- `s3Storage.ts` and `thumbnailStorage.ts` duplicate the retry/backoff helper rather than sharing it (see above) — same caveat if retry behavior changes.
