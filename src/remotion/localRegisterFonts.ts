import { staticFile } from "remotion";

let registered = false;
let loadingPromise: Promise<void> | null = null;

const face = (
  family: string,
  url: string,
  weight: string,
  style = "normal",
  unicodeRange?: string,
): string => {
  const lines = [
    `@font-face {`,
    `  font-family: "${family}";`,
    `  src: url('${url}') format('truetype');`,
    `  font-weight: ${weight};`,
    `  font-style: ${style};`,
    // block: invisible while loading, then shows the real font.
    // Correct for Remotion's delayRender model — no fallback swap needed.
    `  font-display: block;`,
  ];
  if (unicodeRange) lines.push(`  unicode-range: ${unicodeRange};`);
  lines.push(`}`);
  return lines.join("\n");
};

const buildCSS = (): string =>
  [
    face("Great Vibes", staticFile("fonts/GreatVibes-Regular.ttf"), "400"),
    face("Dancing Script", staticFile("fonts/DancingScript-VariableFont_wght.ttf"), "100 700"),
    face("Italic Playfair Display", staticFile("fonts/PlayfairDisplay-Italic-VariableFont_wght.ttf"), "100 900", "italic"),
    // Devanagari fallback registered under "Dancing Script" via CSS @font-face unicode-range
    // (not FontFace API — headless Chrome respects unicode-range properly only via CSS rules).
    face(
      "Dancing Script",
      staticFile("fonts/NotoSansDevanagari-VariableFont.ttf"),
      "100 900",
      "normal",
      "U+0900-097F, U+1CD0-1CFF, U+20A8, U+A8E0-A8FF",
    ),
    face("Noto Naskh Arabic", staticFile("fonts/NotoNaskhArabic-VariableFont_wght.ttf"), "100 900"),
    face("Noto Serif Oriya", staticFile("fonts/NotoSerifOriya-VariableFont_wght.ttf"), "100 900"),
    face("Noto Serif Kannada", staticFile("fonts/NotoSerifKannada-VariableFont_wght.ttf"), "100 900"),
    face("Noto Sans Gurmukhi", staticFile("fonts/NotoSerifGurmukhi-VariableFont_wght.ttf"), "100 900"),
  ].join("\n\n");

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

  loadingPromise = (async () => {
    // Inject @font-face CSS rules — unicode-range is only reliable via CSS,
    // not the FontFace constructor, in Chrome headless rendering.
    const style = document.createElement("style");
    style.textContent = buildCSS();
    document.head.appendChild(style);

    // Explicitly trigger each face. Pass a representative character so Chrome
    // resolves the correct unicode-range face (critical for the Devanagari face).
    await Promise.allSettled([
      withTimeout(document.fonts.load('400 "Great Vibes"', "A"), 10000, "Great Vibes"),
      withTimeout(document.fonts.load('600 "Dancing Script"', "A"), 10000, "Dancing Script latin"),
      // 'क' (U+0915) forces Chrome to find and download the Devanagari-range face.
      withTimeout(document.fonts.load('600 "Dancing Script"', "क"), 10000, "Dancing Script devanagari"),
      withTimeout(document.fonts.load('700 italic "Italic Playfair Display"', "A"), 10000, "Italic Playfair Display"),
      withTimeout(document.fonts.load('400 "Noto Naskh Arabic"', "ا"), 10000, "Noto Naskh Arabic"),
      withTimeout(document.fonts.load('400 "Noto Serif Oriya"', "କ"), 10000, "Noto Serif Oriya"),
      withTimeout(document.fonts.load('400 "Noto Serif Kannada"', "ಅ"), 10000, "Noto Serif Kannada"),
      withTimeout(document.fonts.load('400 "Noto Sans Gurmukhi"', "ਅ"), 10000, "Noto Sans Gurmukhi"),
    ]);

    await withTimeout(document.fonts.ready, 5000, "document.fonts.ready").catch(() => {});
    registered = true;
  })();

  await loadingPromise;
};
