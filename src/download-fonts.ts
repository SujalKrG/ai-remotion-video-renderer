import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./lib/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FONTS_DIR = path.resolve(__dirname, "../public/fonts");

const fonts: Array<{ family: string; remoteFile: string; localFile: string }> = [
  {
    family: "Great Vibes",
    remoteFile: "GreatVibes-Regular.ttf",
    localFile: "GreatVibes-Regular.ttf",
  },
  {
    family: "Dancing Script",
    remoteFile: "DancingScript-VariableFont_wght.ttf",
    localFile: "DancingScript-VariableFont_wght.ttf",
  },
  {
    family: "Italic Playfair Display",
    remoteFile: "PlayfairDisplay-Italic-VariableFont_wght.ttf",
    localFile: "PlayfairDisplay-Italic-VariableFont_wght.ttf",
  },
  {
    family: "Noto Sans Devanagari",
    // S3 filename has a URL-encoded comma; save locally with a clean name
    remoteFile: "NotoSansDevanagari-VariableFont_wdth%2Cwght.ttf",
    localFile: "NotoSansDevanagari-VariableFont.ttf",
  },
  {
    family: "Noto Naskh Arabic",
    remoteFile: "NotoNaskhArabic-VariableFont_wght.ttf",
    localFile: "NotoNaskhArabic-VariableFont_wght.ttf",
  },
  {
    family: "Noto Serif Oriya",
    remoteFile: "NotoSerifOriya-VariableFont_wght.ttf",
    localFile: "NotoSerifOriya-VariableFont_wght.ttf",
  },
  {
    family: "Noto Serif Kannada",
    remoteFile: "NotoSerifKannada-VariableFont_wght.ttf",
    localFile: "NotoSerifKannada-VariableFont_wght.ttf",
  },
  {
    family: "Noto Sans Gurmukhi",
    remoteFile: "NotoSerifGurmukhi-VariableFont_wght.ttf",
    localFile: "NotoSerifGurmukhi-VariableFont_wght.ttf",
  },
];

const BASE_URL =
  "https://evatril-images.s3.ap-south-1.amazonaws.com/video-themes/elements/Fonts";

async function downloadFont(url: string, dest: string, family: string): Promise<void> {
  if (fs.existsSync(dest)) {
    logger.info({ family }, "Font already exists, skipping");
    return;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} downloading ${family} from ${url}`);
  }
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buffer));
}

fs.mkdirSync(FONTS_DIR, { recursive: true });
logger.info({ fontsDir: FONTS_DIR }, "Downloading fonts");

for (const font of fonts) {
  const url = `${BASE_URL}/${font.remoteFile}`;
  const dest = path.join(FONTS_DIR, font.localFile);
  logger.info({ family: font.family }, "Downloading font");
  await downloadFont(url, dest, font.family);
  logger.info({ family: font.family }, "Font ready");
}

logger.info({ count: fonts.length }, "All fonts downloaded");
