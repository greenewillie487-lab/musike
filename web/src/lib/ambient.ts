import { useEffect, useState } from "react";

/**
 * Pulls two dominant, vivid colors out of album artwork so surfaces can glow with it —
 * the way Apple Music washes the Now Playing screen in the cover's colors. Canvas-based,
 * cached per URL, and always resolves: if the image can't be read (CORS, decode failure,
 * or a cover that's basically grayscale) the caller gets a neutral dark wash instead.
 */

export interface Ambient {
  /** Bright and saturated — the top of the wash. */
  a: string;
  /** The second hue (or a darker shade of the first) — blends the wash toward the base. */
  b: string;
}

/** A quiet slate wash for covers we can't read (or that carry no color worth echoing). */
const FALLBACK: Ambient = { a: "#41414e", b: "#202028" };

const cache = new Map<string, Ambient>();

type Rgb = [number, number, number];

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

const hslToHex = (h: number, s: number, l: number): string => {
  const hue = ((h % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

/** Coarse 16-levels-per-channel hex bucket key. */
const bucketKey = (r: number, g: number, b: number) => `${r >> 4}:${g >> 4}:${b >> 4}`;

async function extract(src: string): Promise<Ambient> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
  if (!img.naturalWidth || !img.naturalHeight) throw new Error("empty image");

  // Downsample hard — we only need the gestalt of the cover, not its pixels.
  const n = 24;
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(img, 0, 0, n, n);

  const cells = new Map<string, { r: number; g: number; b: number; w: number }>();
  const { data } = ctx.getImageData(0, 0, n, n);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 128) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const cell = cells.get(bucketKey(r, g, b)) ?? { r: 0, g: 0, b: 0, w: 0 };
    cell.r += r;
    cell.g += g;
    cell.b += b;
    cell.w++;
    cells.set(bucketKey(r, g, b), cell);
  }

  // Score each bucket by presence × vividness: big saturated midtones win, washed-out and
  // near-black/near-white pixels lose. Without this the wash ends up gray no matter the cover.
  const scored = [...cells.values()]
    .map((c) => {
      const rgb: Rgb = [c.r / c.w, c.g / c.w, c.b / c.w];
      const [h, s, l] = rgbToHsl(rgb);
      const midtone = 1 - Math.abs(l - 0.5) * 1.6; // 1 at l=0.5, 0 by l≈0.13/0.87
      return { rgb, h, s, l, score: Math.sqrt(c.w) * s * Math.max(0, midtone) };
    })
    .sort((x, y) => y.score - x.score);

  const best = scored[0];
  if (!best || best.s < 0.12 || best.score < 1.5) return FALLBACK;

  // Second color: the most present vivid bucket clearly apart in hue; else a darker shade.
  const second = scored.find((c) => c.score > 0.5 && Math.abs(c.h - best.h) > 40 && c.s >= 0.12);
  const h2 = second?.h ?? best.h;

  // Apple's wash is muted, not neon: cap saturation and keep both stops in the mid-dark range.
  return {
    a: hslToHex(best.h, Math.min(0.4, best.s * 0.7), 0.48),
    b: hslToHex(h2, Math.min(0.32, (second?.s ?? best.s) * 0.65), 0.3),
  };
}

export async function loadAmbient(src: string): Promise<Ambient> {
  const hit = cache.get(src);
  if (hit) return hit;
  const ambient = await extract(src).catch(() => FALLBACK);
  cache.set(src, ambient);
  return ambient;
}

/** Reactive ambient colors for an artwork URL; falls back immediately, upgrades when ready. */
export function useAmbient(src?: string | null): Ambient {
  const [ambient, setAmbient] = useState<Ambient>(() => (src ? (cache.get(src) ?? FALLBACK) : FALLBACK));
  useEffect(() => {
    if (!src) return;
    let alive = true;
    loadAmbient(src).then((a) => {
      if (alive) setAmbient(a);
    });
    return () => {
      alive = false;
    };
  }, [src]);
  return ambient;
}
