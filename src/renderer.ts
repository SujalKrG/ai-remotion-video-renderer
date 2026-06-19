import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bundle } from "@remotion/bundler";
import {
  ensureBrowser,
  selectComposition,
  makeCancelSignal,
  renderMedia,
  renderStill,
} from "@remotion/renderer";
import { config } from "./config/index.js";
import { logger } from "./lib/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// ── Composition duration computation ──────────────────────────────────────────

const computeCompositionDuration = (
  compositionId: string,
  props: Record<string, unknown>,
  fps: number,
): number => {
  if (compositionId === "StaticSlot") {
    const duration = (props.duration_seconds as number) ?? 4;
    return Math.round(duration * fps);
  }

  if (compositionId === "MergeComposition") {
    const clips = props.clips as Array<{ durationInFrames: number }> | undefined;
    if (!Array.isArray(clips) || clips.length === 0) return 0;
    return clips.reduce((sum, c) => sum + (c.durationInFrames ?? 0), 0);
  }

  logger.warn({ compositionId }, "Unknown compositionId — using composition default duration");
  return 0;
};

// ── Browser ────────────────────────────────────────────────────────────────────

const findBrowserExecutable = (): string | null => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const candidates = [
    "/var/task/.chrome/chrome-headless-shell-linux64/chrome-headless-shell",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
};

// ── Bundle ─────────────────────────────────────────────────────────────────────

let cachedBundleLocation: string | null = null;

const getBundleLocation = async (): Promise<string> => {
  if (cachedBundleLocation && fs.existsSync(cachedBundleLocation)) {
    return cachedBundleLocation;
  }
  cachedBundleLocation = null;

  const entryPoint = path.resolve(__dirname, "../src/remotion/index.ts");

  // Compute the package src dir so the webpack JSX rule override knows what to whitelist
  const pkgEntry = require.resolve("@evatrilvideo/ai-video-package");
  const packageSrc = path.dirname(pkgEntry);

  const enableCaching = process.env.REMOTION_DISABLE_BUNDLE_CACHE !== "1";

  cachedBundleLocation = await bundle({
    entryPoint,
    rootDir: path.resolve(__dirname, ".."),
    enableCaching,
    webpackOverride: (currentConfiguration) => {
      const rules = currentConfiguration.module?.rules ?? [];

      const updatedRules = rules.map((rule: any) => {
        if (
          rule &&
          typeof rule === "object" &&
          rule.test instanceof RegExp &&
          rule.test.test("file.jsx")
        ) {
          const originalExclude = rule.exclude;
          return {
            ...rule,
            exclude: (modulePath: string) => {
              // Always process the package's src/ files through the JSX transpiler
              if (modulePath.startsWith(packageSrc + path.sep)) return false;
              if (!originalExclude) return false;
              if (originalExclude instanceof RegExp) return originalExclude.test(modulePath);
              if (Array.isArray(originalExclude)) {
                return originalExclude.some((ex) =>
                  ex instanceof RegExp ? ex.test(modulePath) : false,
                );
              }
              if (typeof originalExclude === "function") return originalExclude(modulePath);
              return false;
            },
          };
        }
        return rule;
      });

      // Allow extensionless imports inside the package (e.g. './registerFonts' instead of './registerFonts.js')
      const fullySpecifiedRule = {
        include: /node_modules\/@evatrilvideo\/ai-video-package/,
        resolve: { fullySpecified: false },
      };

      // Redirect the package's S3-fetching registerFonts to our local version that
      // serves fonts from the pre-baked public/fonts/ directory in the bundle.
      const localRegisterFonts = path.resolve(
        __dirname,
        "../src/remotion/localRegisterFonts.ts",
      );

      return {
        ...currentConfiguration,
        module: { ...currentConfiguration.module, rules: [...updatedRules, fullySpecifiedRule] },
        resolve: {
          ...currentConfiguration.resolve,
          alias: {
            ...((currentConfiguration.resolve as any)?.alias ?? {}),
            "@evatrilvideo/ai-video-package/src/fonts/registerFonts.js": localRegisterFonts,
          },
          extensionAlias: {
            ...((currentConfiguration.resolve as any)?.extensionAlias ?? {}),
            ".js": [".tsx", ".ts", ".js"],
            ".jsx": [".tsx", ".ts", ".jsx"],
          },
          // Disable exports field enforcement so Root.tsx can import package subpaths
          exportsFields: [],
        },
      };
    },
  });

  return cachedBundleLocation;
};

// ── Render ─────────────────────────────────────────────────────────────────────

export const renderVideo = async ({
  payload,
  outputLocation,
  logLevel = "warn" as const,
  timeoutMs,
}: {
  payload: { props: Record<string, unknown>; composition?: string };
  outputLocation: string;
  logLevel?: "info" | "warn" | "error" | "verbose";
  timeoutMs?: number;
}) => {
  const compositionId = payload.composition ?? config.render.defaultComposition;
  const inputProps = payload.props;

  const bundleLocation = await getBundleLocation();
  fs.mkdirSync(path.dirname(outputLocation), { recursive: true });

  const chromeMode = config.chrome.mode;
  const browserExecutable = findBrowserExecutable();

  await ensureBrowser({
    logLevel,
    browserExecutable,
    chromeMode,
    browserLocation: config.chrome.dir,
    timeoutInMilliseconds: config.chrome.downloadTimeout,
    onBrowserDownload: ({ chromeMode: mode }: { chromeMode: string }) => {
      logger.info({ mode }, "Chromium download starting");
      return {
        version: null,
        onProgress: (p: { percent: number }) => {
          logger.info({ percent: Math.round(p.percent * 100) }, "Chromium download progress");
        },
      };
    },
  } as any);

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: compositionId,
    inputProps,
    logLevel,
    browserExecutable,
    chromeMode,
  });

  const totalFrames = computeCompositionDuration(compositionId, inputProps, composition.fps);
  logger.info({ composition: compositionId, totalFrames }, "Preparing render");

  const { cancelSignal, cancel } = makeCancelSignal();
  const hardTimeoutMs = timeoutMs ?? config.render.hardTimeout;
  const hardTimeout = setTimeout(() => {
    logger.warn({ hardTimeoutMs }, "Hard timeout reached — cancelling render");
    cancel();
  }, hardTimeoutMs);

  let lastMilestone = -1;

  try {
    await renderMedia({
      serveUrl: bundleLocation,
      composition: {
        ...composition,
        durationInFrames: totalFrames > 0 ? totalFrames : composition.durationInFrames,
      },
      codec: "h264",
      outputLocation,
      inputProps,
      logLevel,
      concurrency: config.render.concurrency,
      crf: config.render.crf,
      timeoutInMilliseconds: config.render.frameTimeout,
      chromiumOptions: {
        headless: true,
        enableMultiProcessOnLinux: false,
        disableWebSecurity: true,
      },
      onProgress: ({ progress }: { progress: number }) => {
        const pct = Math.round(progress * 100);
        const milestone = Math.floor(pct / 25) * 25;
        if (milestone % 25 === 0 && milestone !== lastMilestone) {
          lastMilestone = milestone;
          logger.info({ progress: milestone + "%" }, "Render progress");
        }
      },
      cancelSignal,
      browserExecutable,
      chromeMode,
    });
  } finally {
    clearTimeout(hardTimeout);
  }

  return outputLocation;
};

// ── Thumbnail (still frame) ────────────────────────────────────────────────────

export const renderThumbnail = async ({
  compositionId,
  inputProps,
  outputLocation,
  logLevel = "warn" as const,
}: {
  compositionId: string;
  inputProps: Record<string, unknown>;
  outputLocation: string;
  logLevel?: "info" | "warn" | "error" | "verbose";
}): Promise<string> => {
  const bundleLocation = await getBundleLocation();
  const chromeMode = config.chrome.mode;
  const browserExecutable = findBrowserExecutable();

  await ensureBrowser({
    logLevel,
    browserExecutable,
    chromeMode,
    browserLocation: config.chrome.dir,
    timeoutInMilliseconds: config.chrome.downloadTimeout,
    onBrowserDownload: ({ chromeMode: mode }: { chromeMode: string }) => {
      logger.info({ mode }, "Chromium download starting");
      return {
        version: null,
        onProgress: (p: { percent: number }) => {
          logger.info({ percent: Math.round(p.percent * 100) }, "Chromium download progress");
        },
      };
    },
  } as any);

  fs.mkdirSync(path.dirname(outputLocation), { recursive: true });

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: compositionId,
    inputProps,
    logLevel,
    browserExecutable,
    chromeMode,
  });

  await renderStill({
    composition,
    serveUrl: bundleLocation,
    output: outputLocation,
    frame: config.thumbnail.frameIndex,
    imageFormat: "jpeg",
    inputProps,
    logLevel,
    browserExecutable,
    chromiumOptions: {
      headless: true,
      enableMultiProcessOnLinux: false,
      disableWebSecurity: true,
    },
  } as any);

  return outputLocation;
};
