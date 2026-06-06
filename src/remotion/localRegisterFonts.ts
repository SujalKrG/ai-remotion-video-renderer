import { staticFile } from "remotion";

let registered = false;
let loadingPromise: Promise<void> | null = null;

const FONT_TIMEOUT_MS = 15000;

interface FontDef {
  family: string;
  file: string;
  weight: string;
  style?: string;
}

// Mirrors the package's registerFonts.js but loads from the pre-baked
// public/fonts/ directory (served at /public/fonts/ by Remotion's bundle server)
// instead of fetching from S3 on every render.
const fonts: FontDef[] = [
  { family: "Great Vibes",             file: "fonts/GreatVibes-Regular.ttf",                   weight: "400" },
  { family: "Dancing Script",          file: "fonts/DancingScript-VariableFont_wght.ttf",       weight: "100 700" },
  { family: "Italic Playfair Display", file: "fonts/PlayfairDisplay-Italic-VariableFont_wght.ttf", weight: "100 900", style: "italic" },
  { family: "Noto Sans Devanagari",    file: "fonts/NotoSansDevanagari-VariableFont.ttf",       weight: "100 900" },
  { family: "Noto Naskh Arabic",       file: "fonts/NotoNaskhArabic-VariableFont_wght.ttf",     weight: "100 900" },
  { family: "Noto Serif Oriya",        file: "fonts/NotoSerifOriya-VariableFont_wght.ttf",      weight: "100 900" },
  { family: "Noto Serif Kannada",      file: "fonts/NotoSerifKannada-VariableFont_wght.ttf",    weight: "100 900" },
  { family: "Noto Sans Gurmukhi",      file: "fonts/NotoSerifGurmukhi-VariableFont_wght.ttf",   weight: "100 900" },
];

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);

export const registerFonts = async (): Promise<void> => {
  if (registered) return;
  if (loadingPromise) {
    await loadingPromise;
    return;
  }

  loadingPromise = Promise.allSettled(
    fonts.map(async (font) => {
      const face = new FontFace(
        font.family,
        `url('${staticFile(font.file)}') format('truetype')`,
        {
          weight: font.weight,
          style: font.style ?? "normal",
          display: "swap",
        },
      );
      await withTimeout(face.load(), FONT_TIMEOUT_MS, font.family);
      document.fonts.add(face);
    }),
  ).then(async (results) => {
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        console.error(`Font loading failed: ${fonts[i].family}`, result.reason);
      }
    });
    await withTimeout(document.fonts.ready, 5000, "document.fonts.ready").catch(() => {});
    registered = true;
  }) as Promise<void>;

  await loadingPromise;
};
