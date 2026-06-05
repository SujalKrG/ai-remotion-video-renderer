import { ensureBrowser } from "@remotion/renderer";
import { config } from "./config/index.js";
import { logger } from "./lib/logger.js";

const chromeDir = config.chrome.dir;

logger.info({ chromeDir }, "Starting Chrome download");

await ensureBrowser({
  logLevel: "verbose",
  chromeMode: config.chrome.mode,
  browserLocation: chromeDir,
  onBrowserDownload: () => {
    logger.info("Downloading Chrome");
    return {
      version: null,
      onProgress: (p: { percent: number; downloadedBytes: number; totalSizeInBytes: number }) => {
        logger.info(
          { progress: Math.round(p.percent * 100) + "%" },
          "Chrome download progress",
        );
      },
    };
  },
} as any);

logger.info("Chrome download complete");
