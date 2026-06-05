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

# Remotion downloads Chrome to node_modules/.remotion/chrome-for-testing/linux64/chrome-linux64/
# Copy it out to /var/task/.chrome/ so the runtime stage can import it independently.
# The runtime stage symlinks node_modules/.remotion → /tmp, which would otherwise lose Chrome.
RUN node dist/download-chrome.js && \
    mkdir -p /var/task/.chrome && \
    cp -r /var/task/node_modules/.remotion/chrome-for-testing/linux64/chrome-linux64 /var/task/.chrome/ && \
    chmod +x /var/task/.chrome/chrome-linux64/chrome

# ──────────────────────────────────────────────────────────────────────────────
# Stage 4: Production Runtime
# ──────────────────────────────────────────────────────────────────────────────
FROM fonts AS runtime

WORKDIR /var/task

COPY package*.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit --no-fund

COPY --from=builder /var/task/dist ./dist
COPY src/ ./src/

# Chrome — full directory with all support files (icudtl.dat etc.)
COPY --from=builder /var/task/.chrome ./.chrome

RUN test -x /var/task/.chrome/chrome-linux64/chrome || \
    (echo "ERROR: Chrome binary missing" && exit 1)

# Pre-chmod Remotion compositor — /var/task is read-only at Lambda runtime
RUN find /var/task/node_modules/@remotion -name "remotion" -type f -exec chmod +x {} \;

ENV PUPPETEER_EXECUTABLE_PATH=/var/task/.chrome/chrome-linux64/chrome

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
