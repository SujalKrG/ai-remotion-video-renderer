# syntax=docker/dockerfile:1
# ──────────────────────────────────────────────────────────────────────────────
# AIRemotionVideoRenderer — AWS Lambda container
#
# Base: node:22-bookworm (Debian 12, glibc 2.36)
# Remotion's compositor binary (@remotion/compositor-linux-x64-gnu) requires
# GLIBC_2.35. Debian Bookworm ships 2.36, giving us correct compatibility with
# headroom. All three stages share the same OS family to eliminate cross-distro
# surprises in font paths, glibc linkage, and shared library resolution.
#
# Build stages:
#   deps    — runtime node_modules + aws-lambda-ric native compilation
#   builder — TypeScript compilation, Chrome download, font pre-baking
#   runtime — slim production image, no build tools
# ──────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=22
ARG DEBIAN_CODENAME=bookworm

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: deps
# Installs production-only node_modules. aws-lambda-ric contains a native C++
# addon (libcurl binding) that requires a full build toolchain to compile. Those
# tools are installed here and never appear in the runtime image.
# ──────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-${DEBIAN_CODENAME} AS deps

WORKDIR /var/task

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    make \
    cmake \
    libcurl4-openssl-dev

COPY package*.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: builder
# Full dependency install (including dev), TypeScript compilation, Chrome
# headless-shell download, and font pre-baking into public/fonts/.
# ──────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-${DEBIAN_CODENAME} AS builder

WORKDIR /var/task

COPY package*.json tsconfig.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

COPY src/ ./src/

RUN npx tsc --noEmit && npx tsc

# headless-shell is the correct binary for server-side rendering.
# Extract it out of node_modules/.remotion before the runtime stage symlinks
# that path to /tmp, which would otherwise lose the binary.
RUN node dist/download-chrome.js && \
    mkdir -p /var/task/.chrome && \
    cp -r /var/task/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64 \
          /var/task/.chrome/ && \
    chmod +x /var/task/.chrome/chrome-headless-shell-linux64/chrome-headless-shell

# Pre-bake all fonts into public/fonts/ so renders never fetch from S3.
RUN node dist/download-fonts.js

# ──────────────────────────────────────────────────────────────────────────────
# Stage 3: runtime
# Slim production image. No build tools. node_modules come pre-compiled from
# the deps stage. Chrome runtime libs and system fonts are installed via apt.
# ──────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-${DEBIAN_CODENAME}-slim AS runtime

WORKDIR /var/task

# Chrome headless-shell runtime dependencies + system fonts for fallback glyph
# rendering. BuildKit cache mounts keep the apt lists and downloaded packages
# out of image layers while still speeding up rebuilds locally and in CI.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    # TLS / certificate chain
    ca-certificates \
    libssl3 \
    # Audio / ALSA
    libasound2 \
    # Accessibility / ATK
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    # Cairo 2D graphics
    libcairo2 \
    # CUPS printing subsystem (Chrome dependency)
    libcups2 \
    # D-Bus IPC
    libdbus-1-3 \
    # Direct Rendering Manager
    libdrm2 \
    # GBM (GPU buffer management)
    libgbm1 \
    # GTK3
    libgtk-3-0 \
    # Netscape Portable Runtime / NSS (TLS / crypto)
    libnspr4 \
    libnss3 \
    # Pango text rendering
    libpango-1.0-0 \
    # X11 core
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    # X11 extensions
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    # Font rendering
    libfreetype6 \
    libfontconfig1 \
    # System fonts — Chrome fallback glyph rendering
    fonts-dejavu \
    fonts-liberation \
    fonts-noto-core \
    fonts-noto-color-emoji \
    && fc-cache -fv

# Pre-compiled production node_modules (aws-lambda-ric native addon included)
COPY --from=deps /var/task/node_modules ./node_modules

# Compiled JS, TS source (Remotion bundler reads it at render time), pre-baked
# fonts, and Chrome headless-shell binary
COPY --from=builder /var/task/dist ./dist
COPY src/ ./src/
COPY --from=builder /var/task/public ./public
COPY --from=builder /var/task/.chrome ./.chrome

RUN test -x /var/task/.chrome/chrome-headless-shell-linux64/chrome-headless-shell || \
    (echo "ERROR: chrome-headless-shell binary missing" && exit 1)

# /var/task is read-only at Lambda runtime — pre-chmod all Remotion binaries now
RUN find /var/task/node_modules/@remotion -type f \
    \( -name "remotion" -o -name "ffmpeg" -o -name "ffprobe" \) \
    -exec chmod +x {} \;

# Fail the build immediately if the Remotion compositor has any unresolved glibc
# symbols — catches regressions before the image ever reaches Lambda.
RUN if ldd /var/task/node_modules/@remotion/compositor-linux-x64-gnu/remotion \
       | grep -q "not found"; then \
    echo "ERROR: Remotion compositor has unresolved dynamic library dependencies:"; \
    ldd /var/task/node_modules/@remotion/compositor-linux-x64-gnu/remotion; \
    exit 1; \
    fi

ENV PUPPETEER_EXECUTABLE_PATH=/var/task/.chrome/chrome-headless-shell-linux64/chrome-headless-shell \
    XDG_CACHE_HOME=/tmp/.cache \
    npm_config_cache=/tmp/.npm \
    HOME=/tmp \
    FONTCONFIG_PATH=/etc/fonts \
    FONTCONFIG_FILE=/etc/fonts/fonts.conf \
    NODE_OPTIONS="--max-old-space-size=3008 --enable-source-maps" \
    REMOTION_GL=swiftshader \
    REMOTION_DISABLE_FAST_BUILD=false

# Remotion writes to node_modules/.remotion and .cache at runtime — redirect
# both to /tmp which is the only writable directory inside Lambda.
RUN mkdir -p /tmp/.remotion /tmp/.cache \
    && ln -sf /tmp/.remotion /var/task/node_modules/.remotion \
    && ln -sf /tmp/.cache /var/task/node_modules/.cache

# aws-lambda-ric is the AWS Lambda Runtime Interface Client for custom base
# images. It replaces the built-in bootstrap that ships with AWS's own node
# images, and is the officially documented approach for non-AWS base images.
ENTRYPOINT ["/var/task/node_modules/.bin/aws-lambda-ric"]
CMD ["dist/lambda.handler"]
