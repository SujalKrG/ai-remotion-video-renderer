# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║                         MULTI-STAGE PRODUCTION BUILD                         ║
# ║                    Remotion Video Renderer - AWS Lambda                      ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: Base Dependencies Layer
# ──────────────────────────────────────────────────────────────────────────────
FROM public.ecr.aws/lambda/nodejs:20 AS base-deps

# Install system dependencies for Chromium and fonts
# Separated into logical groups for better caching and readability
RUN dnf install -y \
    # Core Chromium dependencies
    atk \
    cups-libs \
    gtk3 \
    libXcomposite \
    libXcursor \
    libXdamage \
    libXext \
    libXi \
    libXrandr \
    libXScrnSaver \
    libXtst \
    pango \
    alsa-lib \
    nss \
    libdrm \
    libgbm \
    libxkbcommon \
    # Font rendering dependencies
    freetype \
    freetype-devel \
    fontconfig \
    fontconfig-devel \
    # Required for font configuration
    fontpackages-filesystem \
    && dnf clean all \
    && rm -rf /var/cache/dnf

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: Font Caching Layer (Critical for Remotion Performance)
# ──────────────────────────────────────────────────────────────────────────────
FROM base-deps AS fonts

# Install comprehensive font sets for video rendering
# These fonts are cached in this layer and won't rebuild unless Dockerfile changes
RUN dnf install -y \
    # Base fonts (Latin, common scripts) — AL2023 compatible
    dejavu-sans-fonts \
    dejavu-serif-fonts \
    dejavu-sans-mono-fonts \
    liberation-fonts \
    # International + emoji fonts — AL2023 package names
    google-noto-sans-vf-fonts \
    google-noto-serif-vf-fonts \
    google-noto-color-emoji-fonts \
    && dnf clean all \
    && rm -rf /var/cache/dnf

# Rebuild font cache for faster font lookups during rendering
RUN fc-cache -fv

# Pre-warm fontconfig cache (speeds up first render)
RUN fc-list > /tmp/font-list.txt && \
    fc-match "sans-serif" > /tmp/font-match.txt && \
    rm -f /tmp/font-*.txt

# ──────────────────────────────────────────────────────────────────────────────
# Stage 3: Builder (TypeScript compilation + Chrome download)
# ──────────────────────────────────────────────────────────────────────────────
FROM fonts AS builder

WORKDIR /var/task

# Copy package files first (cached layer if package.json unchanged)
COPY package*.json tsconfig.json ./

# Install ALL dependencies (including devDependencies for build + chrome download)
# This layer is cached and only rebuilds when package*.json changes
RUN npm ci --prefer-offline --no-audit --no-fund

# Copy source code
COPY src/ ./src/

# TypeScript compilation with type checking
# Fail fast if there are type errors
RUN npx tsc --noEmit && npx tsc

# Download Chrome at build time so it's baked into the image
# This is a critical optimization - Chrome is ~150MB and downloading during
# Lambda cold start would add 30-60s latency
RUN node dist/download-chrome.js

# Verify Chrome was downloaded successfully
RUN test -f /var/task/.chrome/chrome-for-testing/chrome-linux/chrome || \
    (echo "ERROR: Chrome download failed" && exit 1)

# ──────────────────────────────────────────────────────────────────────────────
# Stage 4: Production Runtime
# ──────────────────────────────────────────────────────────────────────────────
FROM fonts AS runtime

WORKDIR /var/task

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies (no devDependencies)
# This significantly reduces the final image size
RUN npm ci --omit=dev --prefer-offline --no-audit --no-fund

# Copy compiled JavaScript from builder
COPY --from=builder /var/task/dist ./dist

# Remotion bundles from the source entrypoint at render time.
# Tests are excluded by .dockerignore, so this only carries runtime source.
COPY src/ ./src/

# Copy downloaded Chrome from builder (cached layer)
COPY --from=builder /var/task/.chrome ./.chrome

# Verify Chrome executable exists and is functional
RUN test -x /var/task/.chrome/chrome-for-testing/chrome-linux/chrome || \
    (echo "ERROR: Chrome binary not executable" && exit 1)

# Set Chrome executable path for Puppeteer/Remotion
ENV PUPPETEER_EXECUTABLE_PATH=/var/task/.chrome/chrome-for-testing/chrome-linux/chrome

# Lambda writable paths configuration
# Lambda only allows writes to /tmp (512MB ephemeral storage)
ENV XDG_CACHE_HOME=/tmp/.cache
ENV npm_config_cache=/tmp/.npm
ENV HOME=/tmp
ENV FONTCONFIG_PATH=/etc/fonts
ENV FONTCONFIG_FILE=/etc/fonts/fonts.conf

# Performance optimizations
ENV NODE_OPTIONS="--max-old-space-size=3008 --enable-source-maps"

# Remotion-specific optimizations
ENV REMOTION_GL="swiftshader"
ENV REMOTION_DISABLE_FAST_BUILD="false"

# Create symlinks for Remotion's internal cache directories
# These must point to /tmp since /var/task is read-only at runtime
RUN mkdir -p /tmp/.remotion /tmp/.cache && \
    mkdir -p /var/task/node_modules && \
    ln -sf /tmp/.remotion /var/task/node_modules/.remotion && \
    ln -sf /tmp/.cache /var/task/node_modules/.cache

# Lambda handler entrypoint
CMD ["dist/lambda.handler"]
