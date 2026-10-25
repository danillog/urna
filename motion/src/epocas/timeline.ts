import { Easing } from "remotion";

/** Frames of each beat (30 fps). */
export const F = {
  /** The TV turns on. */
  on: [0, 34],
  /** The teletext page, 1990. */
  page: [34, 560],
  /** "Brasil 1990: 0,641", under the bars. */
  caption: 330,
  /** The tape winds to 2023. */
  ff: [560, 760],
  /** Glitch, white flash, the picture breaks out of the TV. */
  burst: [760, 810],
  /** 2023: neon dumbbells, then the time twins. */
  future: [800, 1350],
  twins: 980,
  /** Same HDI, a different plate. */
  twist: [1350, 1860],
  /** The closing line. */
  close: [1860, 2040],
} as const;

export const DURATION = F.close[1];
export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const ease = Easing.inOut(Easing.cubic);
export const easeOut = Easing.out(Easing.cubic);
