# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build            # Compile TypeScript to dist/
npm run type-check       # Type-check without emitting
npm test                 # Run Jest test suite
npm run test:watch       # Jest in watch mode
npm run download-chrome  # Download Chrome into /var/task/.chrome (run after build)
npm run download-fonts   # Pre-bake fonts into public/fonts/ (run after build)
npm run docker:build     # Build the Lambda container image locally
npm run docker:test      # Run the built image locally on port 9000 (Lambda RIE)
```

See `docs/` for full architectural documentation:

- `docs/ARCHITECTURE.md` — layers, invocation flow, bundle/webpack override, timeout model
- `docs/API.md` — request/response contracts for both render types, callback payloads
- `docs/CONFIGURATION.md` — every env var, its default, and what it controls
- `docs/DEPLOYMENT.md` — Docker multi-stage build, GitHub Actions, Lambda specifics
- `docs/TESTING.md` — test suite layout and what each file covers

## Architecture (summary)

This is an **AWS Lambda container function** that renders wedding invitation videos via Remotion and uploads the result to S3. It is invoked directly by the `invitationpanel` backend's BullMQ workers via `InvokeCommand` — no HTTP server, no polling.

```
invitationpanel (BullMQ worker)
  → aws-sdk InvokeCommand → Lambda handler (src/lambda.ts)
  → Zod-validate event (src/schemas/validation.ts)

  static_slot path:
  → renderVideo("StaticSlot") → renderThumbnail → uploadToS3 → return { clip_url, thumbnail_url }

  final_merge path:
  → renderVideo("MergeComposition") → renderThumbnail → uploadToS3 → return { final_video_url, thumbnail_url }

  Either path, after responding:
  → if `output.callback_url` was set on the request, POST the same result
    (plus retries) to that URL — see src/callbacks/callbackDelivery.ts
```

The Lambda call itself is still **synchronous** — it blocks until the video is rendered and uploaded, then returns the S3 URL directly in the InvokeCommand response. The callback is a **best-effort side notification** on top of that (e.g. for a separate webhook consumer); its failure does not affect the returned response or throw.

### Layer map

| Layer | Path | Responsibility |
|-------|------|----------------|
| Handler | `src/lambda.ts` | Lambda entry point, Zod validation, timeout derivation, temp file cleanup, callback dispatch |
| Renderer | `src/renderer.ts` | Remotion bundle (webpack override), `ensureBrowser`, `renderMedia`/`renderStill`, hard timeout |
| Validation | `src/schemas/validation.ts` | Zod schemas for both request shapes — single source of truth for the wire contract |
| Callbacks | `src/callbacks/callbackDelivery.ts` | Optional webhook POST after render completes/fails, retried with backoff |
| Storage | `src/utils/s3Storage.ts` | S3 upload + retry + presigned/public URL builder |
| Thumbnail | `src/utils/thumbnailStorage.ts` | JPEG thumbnail S3 upload (duplicates the retry helper to avoid a circular import) |
| Compositions | `src/compositions/StaticSlot.tsx`, `MergeComposition.tsx` | Remotion components — single frame vs. crossfaded clip stitching |
| Remotion entry | `src/remotion/index.ts`, `Root.tsx`, `localRegisterFonts.ts` | `registerRoot`, composition registry, pre-baked font loader |
| Config | `src/config/index.ts` | All env vars with defaults — single source of truth |
| Errors | `src/errors/RenderError.ts` | `ValidationError`, `RenderTimeoutError`, `S3UploadError`, `BrowserError` |
| Logger | `src/lib/logger.ts` | Pino structured logger |
| Chrome/Fonts | `src/download-chrome.ts`, `src/download-fonts.ts` | Build-time scripts — bake Chrome and fonts into the Docker image |

### Video package

Compositions come from `@evatrilvideo/ai-video-package` (npm). The package exports:
- `frameRegistry` — maps frame IDs to their components and durations, consumed directly by `StaticSlot.tsx`
- `remotionRoot.jsx` — the package's own entry point (not used here; this repo has its own `Root.tsx`)

The renderer bundles from this repo's own `src/remotion/index.ts` entry point, not the package's. A **webpack override** in `renderer.ts` is required to let the bundler process JSX/TS files inside the package's `src/` directory (webpack excludes `node_modules` by default), and to redirect the package's S3-fetching `registerFonts` to the local pre-baked version.

### Key patterns

- **ESM module** (`"type": "module"`), TypeScript compiled with `NodeNext` module resolution. All imports use `.js` extensions.
- **Chrome baked in at build time**: `download-chrome.ts` runs during `docker build` so cold starts don't wait on Chrome download. `ensureBrowser()` is called before every render as a no-op verification.
- **Fonts baked in at build time**: `download-fonts.ts` pre-fetches fonts into `public/fonts/`; `localRegisterFonts.ts` loads them from the bundle's static server instead of S3 at render time.
- **Hard timeout + cancel signal**: `makeCancelSignal()` from `@remotion/renderer` cancels an in-progress render if it exceeds the derived timeout (Lambda's remaining time minus 30s, capped by `RENDER_TIMEOUT`, default 10 min).
- **Bundle caching**: `cachedBundleLocation` is a module-level variable — the webpack bundle is reused across warm Lambda invocations.
- **Temp file cleanup**: `/tmp` is shared across warm invocations. The `finally` block in `lambda.ts` always deletes the rendered `.mp4`/`.jpg` to prevent `/tmp` exhaustion.
- **Structured logging**: Pino. Never use `console.log`.
- **Request validation**: All request shapes are validated with Zod (`src/schemas/validation.ts`) before any rendering starts; validation failures return a structured error response without invoking Remotion.

### Deployment

Push to `main` → GitHub Actions builds Docker image → pushes to ECR → updates Lambda. See `docs/DEPLOYMENT.md`.

Required GitHub secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ACCOUNT_ID`.

Lambda function name: `ai-video-renderer`. ECR repo: `ai_video_renderer`. Region: `ap-south-1`.
