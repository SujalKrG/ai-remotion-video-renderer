let registered = false;
let loadingPromise: Promise<void> | null = null;

const FONT_TIMEOUT_MS = 10000;

interface FontDef {
  family: string;
  url: string;
  weight: string;
  style?: string;
  unicodeRange?: string;
}

// All fonts are served locally from the bundle's public/fonts/ directory,
// pre-downloaded at Docker build time. No S3 round-trips during rendering.
const fonts: FontDef[] = [
  {
    family: "Great Vibes",
    url: "/fonts/GreatVibes-Regular.ttf",
    weight: "400",
  },
  {
    family: "Dancing Script",
    url: "/fonts/DancingScript-VariableFont_wght.ttf",
    weight: "100 700",
  },
  {
    family: "Italic Playfair Display",
    url: "/fonts/PlayfairDisplay-Italic-VariableFont_wght.ttf",
    weight: "100 900",
    style: "italic",
  },
  // Registers Noto Sans Devanagari under the "Dancing Script" family name for
  // the Devanagari unicode range. When a frame component sets fontFamily to
  // "Dancing Script" and the text contains Devanagari characters (U+0900–097F),
  // the browser's unicode-range matching picks this face automatically — fixing
  // the tofu blocks without modifying frame components.
  {
    family: "Dancing Script",
    url: "/fonts/NotoSansDevanagari-VariableFont.ttf",
    weight: "100 900",
    unicodeRange: "U+0900-097F, U+1CD0-1CFF, U+20A8, U+A8E0-A8FF",
  },
  {
    family: "Noto Naskh Arabic",
    url: "/fonts/NotoNaskhArabic-VariableFont_wght.ttf",
    weight: "100 900",
  },
  {
    family: "Noto Serif Oriya",
    url: "/fonts/NotoSerifOriya-VariableFont_wght.ttf",
    weight: "100 900",
  },
  {
    family: "Noto Serif Kannada",
    url: "/fonts/NotoSerifKannada-VariableFont_wght.ttf",
    weight: "100 900",
  },
  {
    family: "Noto Sans Gurmukhi",
    url: "/fonts/NotoSerifGurmukhi-VariableFont_wght.ttf",
    weight: "100 900",
  },
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
      const descriptors: FontFaceDescriptors = {
        weight: font.weight,
        style: font.style ?? "normal",
        display: "swap",
      };
      if (font.unicodeRange) descriptors.unicodeRange = font.unicodeRange;

      const face = new FontFace(
        font.family,
        `url('${font.url}') format('truetype')`,
        descriptors,
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
