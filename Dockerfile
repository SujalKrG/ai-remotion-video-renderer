# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║                         MULTI-STAGE PRODUCTION BUILD                         ║
# ║                    Remotion Video Renderer - AWS Lambda                      ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: Base Dependencies Layer
# ──────────────────────────────────────────────────────────────────────────────
FROM public.ecr.aws/lambda/nodejs:20 AS base-deps

RUN dnf install -y \
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
    freetype \
    freetype-devel \
    fontconfig \
    fontconfig-devel \
    fontpackages-filesystem \
    && dnf clean all \
    && rm -rf /var/cache/dnf

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: Font Caching Layer
# ──────────────────────────────────────────────────────────────────────────────
FROM base-deps AS fonts

RUN dnf install -y \
    dejavu-sans-fonts \
    dejavu-serif-fonts \
    dejavu-sans-mono-fonts \
    liberation-fonts \
    google-noto-sans-vf-fonts \
    google-noto-serif-vf-fonts \
    google-noto-color-emoji-fonts \
    && dnf clean all \
    && rm -rf /var/cache/dnf

RUN fc-cache -fv

# ──────────────────────────────────────────────────────────────────────────────
# Stage 3: Builder (TypeScript compilation + Chrome download)
# ──────────────────────────────────────────────────────────────────────────────
FROM fonts AS builder

WORKDIR /var/task

COPY package*.json tsconfig.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

COPY src/ ./src/
RUN npx tsc --noEmit && npx tsc

# headless-shell is the correct binary for server-side rendering (chrome-for-testing
# removed old --headless support in newer versions).
# Copy the entire directory out of node_modules/.remotion before the runtime stage
# symlinks that path to /tmp, which would otherwise lose the binary.
RUN node dist/download-chrome.js && \
    mkdir -p /var/task/.chrome && \
    cp -r /var/task/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64 /var/task/.chrome/ && \
    chmod +x /var/task/.chrome/chrome-headless-shell-linux64/chrome-headless-shell

# Pre-download all fonts into public/fonts/ so renders never fetch from S3.
# Files land at /fonts/<name>.ttf in the Remotion bundle's static asset server.
RUN node dist/download-fonts.js

# ──────────────────────────────────────────────────────────────────────────────
# Stage 4: Production Runtime
# ──────────────────────────────────────────────────────────────────────────────
FROM fonts AS runtime

WORKDIR /var/task

COPY package*.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit --no-fund

COPY --from=builder /var/task/dist ./dist
COPY src/ ./src/

# Fonts pre-downloaded at build time — served as static assets by Remotion's bundle server
COPY --from=builder /var/task/public ./public

# Chrome — full directory with all support files (icudtl.dat etc.)
COPY --from=builder /var/task/.chrome ./.chrome

RUN test -x /var/task/.chrome/chrome-headless-shell-linux64/chrome-headless-shell || \
    (echo "ERROR: chrome-headless-shell binary missing" && exit 1)

# Pre-chmod all Remotion binaries — /var/task is read-only at Lambda runtime
RUN find /var/task/node_modules/@remotion -type f \( -name "remotion" -o -name "ffmpeg" -o -name "ffprobe" \) -exec chmod +x {} \;

# Fail the build if the musl compositor is missing — it's required on AL2023 (glibc 2.34)
# because the gnu compositor needs GLIBC_2.35 which AL2023 does not provide.
RUN test -x /var/task/node_modules/@remotion/compositor-linux-x64-musl/remotion || \
    (echo "ERROR: @remotion/compositor-linux-x64-musl binary missing or not executable" && exit 1)

ENV PUPPETEER_EXECUTABLE_PATH=/var/task/.chrome/chrome-headless-shell-linux64/chrome-headless-shell

ENV XDG_CACHE_HOME=/tmp/.cache
ENV npm_config_cache=/tmp/.npm
ENV HOME=/tmp
ENV FONTCONFIG_PATH=/etc/fonts
ENV FONTCONFIG_FILE=/etc/fonts/fonts.conf
ENV NODE_OPTIONS="--max-old-space-size=3008 --enable-source-maps"
ENV REMOTION_GL="swiftshader"
ENV REMOTION_DISABLE_FAST_BUILD="false"

# Remotion writes to node_modules/.remotion and .cache at runtime — redirect to /tmp
RUN mkdir -p /tmp/.remotion /tmp/.cache && \
    mkdir -p /var/task/node_modules && \
    ln -sf /tmp/.remotion /var/task/node_modules/.remotion && \
    ln -sf /tmp/.cache /var/task/node_modules/.cache

CMD ["dist/lambda.handler"]
