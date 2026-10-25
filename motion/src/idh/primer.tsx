/**
 * Six seconds that open each IDH/IDHM Reel for whoever does not know the index: what it
 * joins (health, education, income), that it goes from 0 to 1, and the tiers on a ruler.
 * withPrimer() puts it in front of a motion, behind an `explica` prop (on by default).
 */
import type { ComponentType } from "react";
import { Sequence, interpolate, useCurrentFrame } from "remotion";
import { Stage, useLayout } from "../common/layout";
import type { MotionDef } from "../common/registry";
import { DISPLAY, T } from "../common/theme";
import { Sfx } from "../video/sound";
import { VIRIDIS, clamp, dec, ease, hdiColor } from "./kit";

export type Scale = "idh" | "idhm";

/** UNDP tiers for countries; the Atlas's for Brazilian municipalities and states. */
export const BANDS: Record<Scale, { label: string; from: number; to: number }[]> = {
  idh: [
    { label: "Baixo", from: 0, to: 0.55 },
    { label: "Médio", from: 0.55, to: 0.7 },
    { label: "Alto", from: 0.7, to: 0.8 },
    { label: "Muito alto", from: 0.8, to: 1 },
  ],
  idhm: [
    { label: "Muito baixo", from: 0, to: 0.5 },
    { label: "Baixo", from: 0.5, to: 0.6 },
    { label: "Médio", from: 0.6, to: 0.7 },
    { label: "Alto", from: 0.7, to: 0.8 },
    { label: "Muito alto", from: 0.8, to: 1 },
  ],
};

export const PARTS = [
  { name: "Saúde", what: "quanto tempo se vive", color: VIRIDIS[6]! },
  { name: "Educação", what: "quanto se estuda", color: VIRIDIS[4]! },
  { name: "Renda", what: "quanto se ganha", color: VIRIDIS[8]! },
];

/** The 0–1 ruler with the tiers, drawn from `at`. Each band takes the color of its middle. */
export function Ruler({ scale, at = 0, lo = 0 }: { scale: Scale; at?: number; lo?: number }) {
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const bands = BANDS[scale].map((b) => ({ ...b, from: Math.max(b.from, lo) })).filter((b) => b.to > lo);
  const x = (v: number) => ((v - lo) / (1 - lo)) * 100;
  return (
    <div style={{ position: "relative", height: 120 * u }}>
      {bands.map((b, i) => {
        const g = ease(interpolate(frame, [at + i * 6, at + i * 6 + 20], [0, 1], clamp));
        return (
          <div
            key={b.label}
            style={{
              position: "absolute",
              left: `${x(b.from)}%`,
              width: `${x(b.to) - x(b.from)}%`,
              top: 0,
              opacity: g,
              paddingRight: 3 * u,
            }}
          >
            <div style={{ height: 30 * u, background: hdiColor((b.from + b.to) / 2), borderRadius: 3 * u }} />
            <div
              style={{
                marginTop: 10 * u,
                fontSize: 22 * u,
                lineHeight: 1.15,
                color: T.ink2,
                textAlign: "center",
              }}
            >
              {b.label}
            </div>
          </div>
        );
      })}
      {[lo, ...BANDS[scale].map((b) => b.to).filter((v) => v > lo)].map((v) => (
        <div
          key={v}
          style={{
            position: "absolute",
            left: `${x(v)}%`,
            top: -34 * u,
            transform: "translateX(-50%)",
            fontSize: 22 * u,
            color: T.muted,
            fontVariantNumeric: "tabular-nums",
            opacity: interpolate(frame, [at + 20, at + 35], [0, 1], clamp),
          }}
        >
          {v === 0 || v === 1 ? String(v) : dec(v, 2)}
        </div>
      ))}
    </div>
  );
}

export const PRIMER = 195;

export function Primer({ scale, sound = true }: { scale: Scale; sound?: boolean }) {
  const frame = useCurrentFrame();
  const { u, pad } = useLayout();
  const out = interpolate(frame, [PRIMER - 14, PRIMER], [1, 0], clamp);
  const fade = (at: number) => interpolate(frame, [at, at + 12], [0, 1], clamp) * out;
  const rise = (at: number) => interpolate(frame, [at, at + 16], [14 * u, 0], { ...clamp, easing: ease });
  return (
    <Stage>
      {sound ? (
        <>
          <Sfx name="swish" at={2} />
          {PARTS.map((_, i) => (
            <Sfx key={i} name="pop" at={40 + i * 14} volume={0.35} />
          ))}
          <Sfx name="tick" at={95} volume={0.4} />
          <Sfx name="whoosh" at={PRIMER - 12} />
        </>
      ) : null}
      <div style={{ position: "absolute", left: pad, right: pad, top: 330 * u }}>
        <div
          style={{
            opacity: fade(0),
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: 30 * u,
            letterSpacing: 2.5 * u,
            textTransform: "uppercase",
            color: T.muted,
          }}
        >
          Antes de começar
        </div>
        <div style={{ opacity: fade(4), fontFamily: DISPLAY, fontWeight: 700, fontSize: 92 * u, lineHeight: 1 }}>
          {scale === "idh" ? "O que é o IDH?" : "O que é o IDHM?"}
        </div>
        <div style={{ opacity: fade(14), fontSize: 38 * u, lineHeight: 1.35, marginTop: 26 * u, color: T.ink2 }}>
          {scale === "idh" ? (
            <>
              Índice de Desenvolvimento Humano: uma <b style={{ color: T.ink }}>nota de 0 a 1</b> que a ONU dá a cada
              país, juntando três coisas:
            </>
          ) : (
            <>
              O Índice de Desenvolvimento Humano <b style={{ color: T.ink }}>Municipal</b>: a mesma ideia da nota da ONU
              para países, de <b style={{ color: T.ink }}>0 a 1</b>, calculada para cada cidade e estado. Junta:
            </>
          )}
        </div>
        <div style={{ marginTop: 34 * u }}>
          {PARTS.map((p, i) => (
            <div
              key={p.name}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 18 * u,
                marginTop: 14 * u,
                opacity: fade(40 + i * 14),
                transform: `translateY(${rise(40 + i * 14)}px)`,
              }}
            >
              <i style={{ width: 22 * u, height: 22 * u, borderRadius: "50%", background: p.color, flex: "none" }} />
              <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 56 * u, width: 260 * u }}>{p.name}</span>
              <span style={{ fontSize: 36 * u, color: T.ink2 }}>{p.what}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 90 * u, opacity: out }}>
          <Ruler scale={scale} at={95} />
        </div>
        <div style={{ opacity: fade(125), fontSize: 40 * u, marginTop: 20 * u, fontWeight: 600 }}>
          Quanto mais perto de 1, melhor se vive.
        </div>
      </div>
    </Stage>
  );
}

/** The same motion with the primer in front, switchable with `explica`. */
export function withPrimer(def: MotionDef, scale: Scale, on = true): MotionDef {
  const Inner = def.component as ComponentType<Record<string, unknown>>;
  const has = (p: Record<string, unknown>) => p.explica !== false;
  function WithPrimer(props: Record<string, unknown>) {
    if (!has(props)) return <Inner {...props} />;
    return (
      <>
        <Sequence durationInFrames={PRIMER} name="o que é">
          <Primer scale={scale} sound={props.musica !== false} />
        </Sequence>
        <Sequence from={PRIMER} name={def.id}>
          <Inner {...props} />
        </Sequence>
      </>
    );
  }
  return {
    ...def,
    component: WithPrimer,
    defaultProps: { ...def.defaultProps, explica: on },
    durationInFrames: (p) => def.durationInFrames(p) + (has(p) ? PRIMER : 0),
    controls: [
      ...(def.controls ?? []),
      {
        prop: "explica",
        label: "Abertura",
        options: [
          { value: true, label: "Com “o que é o IDH”" },
          { value: false, label: "Sem" },
        ],
      },
    ],
  };
}
