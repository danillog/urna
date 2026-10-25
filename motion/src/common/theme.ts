import { loadFont as loadDisplay } from "@remotion/google-fonts/BarlowCondensed";
import { loadFont as loadBody } from "@remotion/google-fonts/IBMPlexSans";
import type { ColorName } from "../../../src/types";

/** The site's typefaces (index.html): Barlow Condensed for titles, IBM Plex Sans for text. */
export const DISPLAY = loadDisplay("normal", { weights: ["500", "600", "700"], subsets: ["latin", "latin-ext"] })
  .fontFamily;
export const BODY = loadBody("normal", { weights: ["400", "500", "600"], subsets: ["latin", "latin-ext"] }).fontFamily;

/** The site's dark theme (src/styles.css): videos read better on a dark ground. */
export const T = {
  bg: "#0f1113",
  surface: "#15171a",
  ink: "#f2f3f5",
  ink2: "#c1c6ce",
  muted: "#8b919b",
  rule: "#2a2e34",
  grid: "#22262b",
};

/** --c-* in the dark theme. */
export const COLOR: Record<ColorName, string> = {
  blue: "#4f86d6",
  gold: "#c98500",
  red: "#e0453f",
  teal: "#199e70",
  violet: "#9085e9",
  gray: "#8b919b",
  green: "#57a845",
  sky: "#6cb4ea",
  cyan: "#2db4c2",
  orange: "#ef8a3a",
  pink: "#e06aaa",
  brown: "#b07a4e",
};

/** --ideo-* (Congress groups), dark theme; unplaced parties in gray. */
export const IDEO: Record<string, string> = {
  left: "#e04f6e",
  "centre-left": "#c08636",
  centre: "#5a5e63",
  "centre-right": "#3a9fa8",
  right: "#6b7cf0",
  none: "#3a3e44",
};

/** --fam-* (Americas families), dark theme. */
export const FAMILY: Record<string, string> = {
  left: "#e0525c",
  "centre-left": "#f4a582",
  "centre-right": "#92c5de",
  right: "#4f93d1",
};

/** "#rrggbb" → [r, g, b]. */
export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** color-mix(in srgb, a p, b), p in 0..1. */
export function mix(a: string, b: string, p: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const c = x.map((v, i) => Math.round(v * p + y[i]! * (1 - p)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Same as mix, on [r, g, b] triples, for per-frame interpolation without parsing. */
export function mixRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  p: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];
}

export const css = (c: readonly number[]) => `rgb(${Math.round(c[0]!)},${Math.round(c[1]!)},${Math.round(c[2]!)})`;

/** Numbers the Brazilian way. */
export const int = (n: number) => Math.round(n).toLocaleString("pt-BR");
export const pct = (n: number, digits = 1) =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
export const brl = (n: number) =>
  n >= 1e6
    ? `R$ ${(n / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`
    : `R$ ${Math.round(n / 1000).toLocaleString("pt-BR")} mil`;
