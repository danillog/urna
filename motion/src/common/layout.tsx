import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { BODY, DISPLAY, T } from "./theme";

/** Landscape (1920×1080) or portrait (1080×1920): every motion lays itself out for both. */
export function useLayout() {
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  /** Unit that scales type and margins with the short side (1080 → 1). */
  const u = Math.min(width, height) / 1080;
  const pad = Math.round(72 * u);
  return { width, height, portrait, u, pad };
}

export function Stage({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <AbsoluteFill style={{ background: T.bg, color: T.ink, fontFamily: BODY, ...style }}>{children}</AbsoluteFill>
  );
}

/** Fades in from `from` over `frames` frames. */
export function useFadeIn(from = 0, frames = 15): number {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, from + frames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

/** Kicker, title and an optional line under it, top left. */
export function Header({ title, subtitle, opacity = 1 }: { title: string; subtitle?: string; opacity?: number }) {
  const { u, pad } = useLayout();
  return (
    <div style={{ position: "absolute", left: pad, top: pad * 0.8, right: pad, opacity }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 26 * u, letterSpacing: 3 * u, color: T.muted }}>
        URNA
      </div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 64 * u, lineHeight: 1.02, marginTop: 6 * u }}>
        {title}
      </div>
      {subtitle ? (
        <div style={{ fontSize: 26 * u, color: T.ink2, marginTop: 12 * u, lineHeight: 1.35, maxWidth: 1100 * u }}>
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

/** Source line, bottom. */
export function Footer({ source, opacity = 1 }: { source: string; opacity?: number }) {
  const { u, pad } = useLayout();
  return (
    <div
      style={{
        position: "absolute",
        left: pad,
        right: pad,
        bottom: pad * 0.6,
        display: "flex",
        justifyContent: "space-between",
        gap: 24 * u,
        fontSize: 20 * u,
        color: T.muted,
        opacity,
      }}
    >
      <span>{source}</span>
      <span style={{ whiteSpace: "nowrap" }}>danillogomes.com/urna</span>
    </div>
  );
}
