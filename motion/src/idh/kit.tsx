/**
 * Shared by the human development (IDH/IDHM) Reels: the site's color scale (ten viridis
 * steps of 0.05, src/styles.css), Atlas tiers, number formats and timed captions.
 */
import type { ReactNode } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import americasJson from "../../../data/generated/americas.json";
import indicatorsJson from "../../../data/generated/americas-indicators.json";
import type { AmericasData } from "../../../src/model/americas";
import { STEPS, type IndicatorData } from "../../../src/model/indicators";
import { useLayout } from "../common/layout";
import { DISPLAY, T, mix, rgb } from "../common/theme";

export const IND = indicatorsJson as unknown as IndicatorData;
export const HDI = IND.indicators.hdi;
export const FIRST_YEAR = IND.firstYear;
const AMERICAS = americasJson as unknown as AmericasData;

export const countryName = (iso: string) => AMERICAS.countries[iso]?.name ?? iso;

/** The site's .q0–.q9. */
export const VIRIDIS = [
  "#440154",
  "#482878",
  "#3e4989",
  "#31688e",
  "#26828e",
  "#1f9e89",
  "#35b779",
  "#6ece58",
  "#b5de2b",
  "#fde725",
];
const VIRIDIS_RGB = VIRIDIS.map(rgb);

export function hdiStep(v: number): number {
  let k = 0;
  STEPS.hdi.forEach((s, i) => {
    if (v >= s) k = i;
  });
  return k;
}
export const hdiRgb = (v: number) => VIRIDIS_RGB[hdiStep(v)]!;
export const hdiColor = (v: number) => VIRIDIS[hdiStep(v)]!;
/** The step's color as text: the darkest purples lightened so they read on the dark ground. */
export const hdiText = (v: number) => {
  const k = hdiStep(v);
  return k > 2 ? VIRIDIS[k]! : mix(VIRIDIS[k]!, T.ink, 0.45);
};

/** Atlas do Desenvolvimento Humano tiers. */
export const TIERS = [
  { label: "Muito baixo", min: 0, color: VIRIDIS[0]! },
  { label: "Baixo", min: 0.5, color: VIRIDIS[2]! },
  { label: "Médio", min: 0.6, color: VIRIDIS[4]! },
  { label: "Alto", min: 0.7, color: VIRIDIS[6]! },
  { label: "Muito alto", min: 0.8, color: VIRIDIS[9]! },
];
export const tierOf = (v: number) => TIERS.findLastIndex((t) => v >= t.min);

/** 0,786 */
export const dec = (v: number, digits = 3) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** +0,280 */
export const signed = (v: number, digits = 3) => `${v >= 0 ? "+" : "−"}${dec(Math.abs(v), digits)}`;

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const ease = Easing.inOut(Easing.cubic);

/** 0 → 1 → 0 between `from` and `to`, with `fade` frames at each end. */
export function between(frame: number, from: number, to: number, fade = 12): number {
  return interpolate(frame, [from, from + fade, to - fade, to], [0, 1, 1, 0], clamp);
}

/** A block of text on screen between two frames, rising a little as it fades in. */
export function Caption({
  from,
  to,
  top,
  children,
}: {
  from: number;
  to: number;
  top: number;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const { u, pad } = useLayout();
  const o = between(frame, from, to);
  if (o === 0) return null;
  const rise = interpolate(frame, [from, from + 18], [16 * u, 0], { ...clamp, easing: ease });
  return (
    <div
      style={{
        position: "absolute",
        left: pad,
        right: pad,
        top,
        opacity: o,
        transform: `translateY(${rise}px)`,
        fontSize: 40 * u,
        lineHeight: 1.3,
        textWrap: "balance",
      }}
    >
      {children}
    </div>
  );
}

/** Big kicker inside a caption ("Quem mais subiu"). */
export function Kicker({ children, color = T.muted }: { children: ReactNode; color?: string }) {
  const { u } = useLayout();
  return (
    <div
      style={{
        fontFamily: DISPLAY,
        fontWeight: 600,
        fontSize: 30 * u,
        letterSpacing: 2.5 * u,
        textTransform: "uppercase",
        color,
        marginBottom: 10 * u,
      }}
    >
      {children}
    </div>
  );
}

/** The ten color steps with their lower bounds, as on the site's map key. */
export function ScaleKey({ opacity = 1 }: { opacity?: number }) {
  const { u } = useLayout();
  return (
    <div style={{ opacity, fontSize: 19 * u, color: T.muted }}>
      <div style={{ display: "flex", gap: 3 * u }}>
        {VIRIDIS.map((c) => (
          <i key={c} style={{ flex: 1, height: 14 * u, background: c, borderRadius: 2 * u }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 * u }}>
        <span>menos de 0,55</span>
        <span>0,75</span>
        <span>0,95 ou mais</span>
      </div>
    </div>
  );
}

/** Big tabular number in the display face. */
export function Big({ children, size = 150, color }: { children: ReactNode; size?: number; color?: string }) {
  const { u } = useLayout();
  return (
    <span
      style={{
        fontFamily: DISPLAY,
        fontWeight: 700,
        fontSize: size * u,
        lineHeight: 0.9,
        fontVariantNumeric: "tabular-nums",
        color,
      }}
    >
      {children}
    </span>
  );
}
