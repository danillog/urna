/**
 * The 1990 half: a CRT television turning on, a teletext page of HDI bars, then the tape
 * fast-forwarding to 2023 while the bars move and the picture tears.
 */
import { loadFont } from "@remotion/google-fonts/VT323";
import type { CSSProperties, ReactNode } from "react";
import { interpolate, random, useCurrentFrame } from "remotion";
import { useLayout } from "../common/layout";
import { BRAZIL, EPOCAS, PAGE_COUNTRIES, caps, hdi } from "./data";
import { F, clamp, ease } from "./timeline";

export const VCR = loadFont("normal", { weights: ["400"], subsets: ["latin", "latin-ext"] }).fontFamily;

/** Teletext's eight colors. */
const TT = { black: "#000", red: "#ff2a2a", green: "#2aff4a", yellow: "#fff23a", blue: "#2a4aff", magenta: "#ff3aff", cyan: "#3affff", white: "#f4f4f4" };
/** Names that fit a teletext row. */
const SHORT: Record<string, string> = { USA: "EUA" };
const short = (c: { iso: string; name: string }) => SHORT[c.iso] ?? caps(c.name);
/** Blocks in a full bar (HDI 1): a coarse bar reads as old. */
const BLOCKS = 24;

/** The CRT: rounded glass, scanlines, vignette, flicker, a tracking band, a power-on line. */
export function Crt({ children, tear = 0, burst = 0 }: { children: ReactNode; tear?: number; burst?: number }) {
  const frame = useCurrentFrame();
  const { width, height, portrait, u } = useLayout();
  // Power on: a white line across, then the picture opens vertically.
  const lineX = interpolate(frame, [F.on[0], F.on[0] + 9], [0, 1], { ...clamp, easing: ease });
  const openY = interpolate(frame, [F.on[0] + 9, F.on[1]], [0.006, 1], { ...clamp, easing: ease });
  const flash = interpolate(frame, [F.on[0] + 6, F.on[0] + 14, F.on[1] + 8], [0, 1, 0], clamp);
  const flicker = 0.93 + 0.07 * random(`flicker-${frame}`);
  // The screen zooms towards the camera as it breaks out.
  const zoom = 1 + burst * 2.4;
  const split = 2 * u + burst * 26 * u + tear * 4 * u;
  const screen: CSSProperties = portrait
    ? { left: 40 * u, right: 40 * u, top: 220 * u, height: 1350 * u }
    : { left: 260 * u, right: 260 * u, top: 70 * u, bottom: 70 * u };
  const band = ((frame * 6) % 140) - 20;
  return (
    <div style={{ position: "absolute", inset: 0, background: "#050505" }}>
      <div
        style={{
          position: "absolute",
          ...screen,
          borderRadius: 60 * u,
          overflow: "hidden",
          background: "#000",
          boxShadow: `0 0 0 ${18 * u}px #1b1b1b, 0 0 0 ${22 * u}px #2b2b2b, 0 0 ${80 * u}px rgba(120,255,160,0.10)`,
          transform: `scale(${zoom * lineX || 0.001}, ${zoom * openY})`,
          opacity: 1 - interpolate(burst, [0.75, 1], [0, 1], clamp),
          filter: `brightness(${flicker + flash * 2}) contrast(1.15) saturate(1.2)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            fontFamily: VCR,
            color: TT.white,
            textShadow: `${split}px 0 rgba(255,30,60,0.65), ${-split}px 0 rgba(30,220,255,0.65), 0 0 ${10 * u}px rgba(255,255,255,0.35)`,
          }}
        >
          {children}
        </div>
        {/* Scanlines and the glass's dark corners. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `repeating-linear-gradient(0deg, rgba(0,0,0,0.38) 0 ${2 * u}px, transparent ${2 * u}px ${4 * u}px)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.75) 100%)",
          }}
        />
        {/* The tracking band rolling down, stronger while the tape winds. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `${band}%`,
            height: `${4 + tear * 10}%`,
            background: `repeating-linear-gradient(90deg, rgba(255,255,255,${0.05 + tear * 0.2}) 0 ${3 * u}px, transparent ${3 * u}px ${7 * u}px)`,
            filter: "blur(1px)",
            transform: `translateX(${(random(`band-${frame}`) - 0.5) * 30 * u}px)`,
          }}
        />
        {tear > 0 ? <Tears amount={tear} /> : null}
        {/* The power-on flash. */}
        <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: flash * 0.9 }} />
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#fff",
          opacity: interpolate(burst, [0.55, 0.8, 1], [0, 1, 0], clamp),
        }}
      />
      <div style={{ width, height }} />
    </div>
  );
}

/** Fast-forward tears: thin horizontal slices pushed sideways, a few per frame. */
function Tears({ amount }: { amount: number }) {
  const frame = useCurrentFrame();
  const { u } = useLayout();
  return (
    <>
      {Array.from({ length: 7 }, (_, i) => {
        const y = random(`tear-y-${frame}-${i}`) * 100;
        const h = 0.4 + random(`tear-h-${frame}-${i}`) * 2.5;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${y}%`,
              height: `${h}%`,
              background: `rgba(255,255,255,${0.12 * amount})`,
              transform: `translateX(${(random(`tear-x-${frame}-${i}`) - 0.3) * 120 * u * amount}px)`,
              mixBlendMode: "screen",
            }}
          />
        );
      })}
    </>
  );
}

/** The teletext page: a header row, a bar per country, Brazil marked; `year` and `mix` (0 = 1990,
 * 1 = 2023) move the bars during the fast-forward. */
export function TeletextPage({ mix, year, ff }: { mix: number; year: number; ff: boolean }) {
  const frame = useCurrentFrame();
  const { portrait, u } = useLayout();
  const t = frame - F.page[0];
  const size = portrait ? 46 * u : 40 * u;
  const rowGap = portrait ? 74 * u : 50 * u;
  const blink = Math.floor(frame / 15) % 2 === 0;
  const caption = interpolate(frame, [F.caption, F.caption + 12], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", inset: 0, padding: `${48 * u}px ${56 * u}px`, fontSize: size, lineHeight: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", background: TT.blue, color: TT.yellow, padding: `${6 * u}px ${14 * u}px` }}>
        <span>P100 URNA-TEXTO</span>
        <span style={{ color: TT.white }}>IDH</span>
      </div>
      <div style={{ marginTop: 18 * u, color: TT.cyan, fontSize: size * 1.25 }}>
        IDH {year} · AMÉRICAS
      </div>
      <div style={{ color: TT.green, fontSize: size * 0.8, marginTop: 6 * u }}>
        DESENVOLVIMENTO HUMANO, DE 0 A 1
      </div>
      <div style={{ marginTop: 26 * u }}>
        {PAGE_COUNTRIES.map((c, i) => {
          const grow = interpolate(t, [10 + i * 7, 40 + i * 7], [0, 1], clamp);
          const value = c.then + (c.now - c.then) * mix;
          const blocks = Math.round(value * BLOCKS * grow);
          const isBrazil = c.iso === BRAZIL.iso;
          const color = isBrazil ? TT.yellow : value >= 0.8 ? TT.green : value >= 0.7 ? TT.cyan : value >= 0.55 ? TT.magenta : TT.red;
          return (
            <div key={c.iso} style={{ display: "flex", alignItems: "center", height: rowGap, opacity: grow > 0 ? 1 : 0 }}>
              <span style={{ width: portrait ? 330 * u : 300 * u, color: isBrazil ? TT.yellow : TT.white }}>
                {isBrazil && blink ? "►" : " "}
                {short(c)}
              </span>
              <span style={{ display: "flex", gap: 3 * u, flex: 1 }}>
                {Array.from({ length: blocks }, (_, k) => (
                  <i key={k} style={{ width: portrait ? 18 * u : 22 * u, height: size * 0.7, background: color }} />
                ))}
              </span>
              <span style={{ width: 120 * u, textAlign: "right", color }}>{grow > 0.95 ? hdi(value) : ""}</span>
            </div>
          );
        })}
      </div>
      {!ff ? (
        <div style={{ marginTop: 24 * u, color: TT.yellow, fontSize: size * 1.05, opacity: caption, lineHeight: 1.15 }}>
          {caps(BRAZIL.name)} {EPOCAS.then}: IDH {hdi(BRAZIL.then)}
          <div style={{ color: TT.white, fontSize: size * 0.85 }}>GUARDE ESSE NÚMERO.</div>
        </div>
      ) : null}
    </div>
  );
}

/** The VCR's on-screen display: PLAY, or the winding arrows and the counter. */
export function Osd({ ff, year }: { ff: boolean; year: number }) {
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const show = interpolate(frame, [F.on[1], F.on[1] + 6], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", inset: 0, opacity: show, fontFamily: VCR, color: "#e8ffe8" }}>
      <div style={{ position: "absolute", right: 64 * u, top: 110 * u, fontSize: 48 * u }}>
        {ff ? "►► ×16" : "PLAY ►"}
      </div>
      <div style={{ position: "absolute", right: 64 * u, bottom: 36 * u, fontSize: 60 * u }}>
        {ff ? `${year}` : `JAN ${EPOCAS.then}`}
      </div>
    </div>
  );
}
