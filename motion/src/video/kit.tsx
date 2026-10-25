/**
 * Shared pieces of the long video's scenes: the scene's clock in fractions, the chapter tag,
 * a counting number. 16:9, 1920×1080; sizes in px of that frame.
 */
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { BODY, DISPLAY, T } from "../common/theme";

export interface SceneProps {
  /** Frames this scene lasts (from timeline.ts): place every beat as a fraction of it. */
  duration: number;
}

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const easeOut = Easing.out(Easing.cubic);
export const easeInOut = Easing.inOut(Easing.cubic);

/** Frame at a fraction of the scene. */
export const at = (duration: number, fraction: number) => Math.round(duration * fraction);

/** 0 → 1 between two fractions of the scene, eased. */
export function useProgress(duration: number, from: number, to: number, easing = easeOut): number {
  const frame = useCurrentFrame();
  return interpolate(frame, [at(duration, from), Math.max(at(duration, from) + 1, at(duration, to))], [0, 1], {
    ...clamp,
    easing,
  });
}

/** Appears (fade and a small rise) at a fraction of the scene; leaves at another, if given. */
export function Reveal({
  duration,
  from,
  until,
  children,
  style,
  rise = 24,
}: {
  duration: number;
  from: number;
  until?: number;
  children: ReactNode;
  style?: CSSProperties;
  rise?: number;
}) {
  const frame = useCurrentFrame();
  const a = at(duration, from);
  const inP = interpolate(frame, [a, a + 14], [0, 1], { ...clamp, easing: easeOut });
  const outP = until === undefined ? 1 : interpolate(frame, [at(duration, until) - 10, at(duration, until)], [1, 0], clamp);
  return (
    <div style={{ opacity: inP * outP, transform: `translateY(${(1 - inP) * rise}px)`, ...style }}>{children}</div>
  );
}

/** The scene's ground: the site's dark background, its fonts, the chapter in the corner. */
export function Scene({ chapter, children }: { chapter?: string; children: ReactNode }) {
  return (
    <AbsoluteFill style={{ background: T.bg, color: T.ink, fontFamily: BODY }}>
      {children}
      {chapter ? (
        <div
          style={{
            position: "absolute",
            left: 72,
            top: 52,
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: 26,
            letterSpacing: 2,
            color: T.muted,
            textTransform: "uppercase",
          }}
        >
          {chapter}
        </div>
      ) : null}
      <div style={{ position: "absolute", right: 72, top: 52, fontFamily: DISPLAY, fontWeight: 600, fontSize: 26, letterSpacing: 3, color: T.muted }}>
        URNA
      </div>
    </AbsoluteFill>
  );
}

/** A big title line, Barlow Condensed. */
export function Title({ children, size = 84, style }: { children: ReactNode; size?: number; style?: CSSProperties }) {
  return (
    <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: size, lineHeight: 1.04, ...style }}>{children}</div>
  );
}

/** "3,4" with a comma and fixed digits. */
export const num = (v: number, digits = 1) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v), digits)}`;
