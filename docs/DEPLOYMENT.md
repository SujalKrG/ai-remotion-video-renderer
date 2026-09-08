# Deployment

## CI/CD

`.github/workflows/deploy-lambda.yml` — triggers on every push to `main`:

1. Checkout, configure AWS credentials from `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` secrets (region `ap-south-1`, hardcoded in the workflow's `env:`).
2. Log in to ECR (`ai_video_renderer` repo, account from `AWS_ACCOUNT_ID` secret via the ECR login action).
3. `docker buildx build` for `linux/amd64` specifically (Lambda's architecture — matters if building/pushing from an ARM machine, e.g. Apple Silicon, where Buildx cross-compiles), tagged both `:latest` and `:<git-sha>`. GitHub Actions cache (`type=gha`) is used for layer caching.
4. `aws lambda update-function-code` on `ai-video-renderer` with the new `:latest` image.
5. `aws lambda wait function-updated` — blocks the workflow until Lambda finishes swapping to the new image, so a following deploy (or manual invoke) can't race an in-progress update.

There is no separate staging environment or manual approval gate — every push to `main` deploys straight to the production Lambda function.

## Docker image (3 stages)

Base: `node:22-bookworm` for the build stages, `node:22-bookworm-slim` for runtime. Bookworm (glibc 2.36) is required because `@remotion/compositor-linux-x64-gnu` needs glibc ≥ 2.35 — all stages share the same Debian base specifically to avoid font-path/glibc/shared-library mismatches between stages.

### Stage 1 — `deps`
Installs **production-only** `node_modules` (`npm ci --omit=dev`). Needs a full C++ build toolchain (`g++`, `make`, `cmake`, `libcurl4-openssl-dev`) because `aws-lambda-ric` compiles a native libcurl addon during install — but that toolchain never makes it into the final image, since only `deps`' `node_modules` output is copied forward.

### Stage 2 — `builder`
Full install (incl. devDependencies), `tsc --noEmit && tsc` (type-check, then emit), then two build-time scripts:
- `node dist/download-chrome.js` — downloads chrome-headless-shell, then explicitly copies the binary out of `node_modules/.remotion` into `/var/task/.chrome`. This copy step matters: the runtime stage symlinks `node_modules/.remotion` → `/tmp` (see below), which would otherwise make the binary vanish at container start.
- `node dist/download-fonts.js` — pre-fetches all fonts into `public/fonts/`, so no render ever needs to hit S3 for a font file.

### Stage 3 — `runtime`
Slim image, no build tools. Installs only Chrome's runtime shared-library dependencies (`libnss3`, `libgbm1`, `libatk-bridge2.0-0`, etc.) plus system fallback fonts, via one grouped `apt-get install` with cache mounts. Copies in: `deps`' `node_modules`, `builder`'s compiled `dist/`, the raw `src/` (Remotion's bundler reads TypeScript source directly at render time — the source must ship alongside the compiled output, not instead of it), `builder`'s `public/` (baked fonts), and `builder`'s `.chrome/` binary.

Three build-time safety checks fail the image build immediately rather than at Lambda cold start:
- `test -x .../chrome-headless-shell` — the binary exists and is executable.
- `chmod +x` on every Remotion native binary (`remotion`, `ffmpeg`, `ffprobe`) — Lambda's `/var/task` is read-only at runtime, so permissions must be correct baked into the image.
- `ldd ... | grep "not found"` on the compositor binary — catches a glibc mismatch (the exact failure mode Bookworm was chosen to avoid) at build time instead of as a runtime crash.

### Runtime environment variables (fixed in the Dockerfile, not overridable via `.env`)

- `PUPPETEER_EXECUTABLE_PATH` — points at the baked-in Chrome binary.
- `XDG_CACHE_HOME`, `npm_config_cache`, `HOME` → all redirected to `/tmp` — Lambda's only writable path.
- `NODE_OPTIONS=--max-old-space-size=1536` — caps Node's heap at 1.5GB specifically so Chrome (which needs to decode multiple video streams simultaneously during `MergeComposition`) isn't starved of the Lambda's total memory allocation. If you raise the Lambda's memory setting, this does *not* auto-scale — revisit it manually if OOMs reappear.
- `REMOTION_GL=swiftshader` — software rendering; Lambda has no GPU.
- Symlinks `node_modules/.remotion` and `node_modules/.cache` to `/tmp/.remotion`/`/tmp/.cache` — Remotion writes to these paths at runtime, and `/var/task` is read-only.

### Entry point

`ENTRYPOINT ["/var/task/node_modules/.bin/aws-lambda-ric"]`, `CMD ["dist/lambda.handler"]` — `aws-lambda-ric` is AWS's documented Runtime Interface Client for non-AWS-base container images (needed because this uses plain `node:22-bookworm-slim`, not `public.ecr.aws/lambda/nodejs`).

## Local Docker testing

```bash
npm run docker:build   # docker build -t ai-video-renderer:latest .
npm run docker:test    # runs it locally with Lambda RIE, listening on :9000, using .env
```

Invoke with `curl` against the RIE endpoint:
```bash
curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \
  -d @test-payloads/static-slot.json
```

`test-payloads/static-slot.json` and `test-payloads/final-merge.json` hold ready-to-use sample payloads matching `docs/API.md`'s contract.
