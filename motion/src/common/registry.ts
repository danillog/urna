import type { ComponentType } from "react";

export type Format = "landscape" | "portrait";

export const SIZE: Record<Format, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};
export const FPS = 30;

/**
 * One motion. Root registers it once per format, the first one under the bare id
 * ("Mapa" in 9:16 for Reels, "Mapa-horizontal" in 16:9), and the
 * interactive page (interativo/) plays the same component in a Player with controls.
 */
export interface MotionDef<P extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  /** Shown on the interactive page. */
  title: string;
  description: string;
  component: ComponentType<P>;
  defaultProps: P;
  durationInFrames: (props: P) => number;
  formats: Format[];
  /** Plays as a loop on the interactive page. */
  loop?: boolean;
  /** Controls for the interactive page: a prop and its choices. */
  controls?: { prop: keyof P & string; label: string; options: { value: unknown; label: string }[] }[];
}

/** Erases P so defs of different props share one array. */
export function motion<P extends Record<string, unknown>>(def: MotionDef<P>): MotionDef {
  return def as unknown as MotionDef;
}
