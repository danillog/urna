import { useLayoutEffect, useRef } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { MARGIN_STEPS, NONE, decodeRace, margin, shade, winsByGroup, type MapRace } from "../../../src/model/map-data";
import { COUNT, MAP, geo, paint } from "../common/municipios";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { COLOR, DISPLAY, T, css, int, mix, rgb } from "../common/theme";

type Props = Record<string, never>;

const INTRO = 60;
const HOLD = 78;
const MOVE = 32;
const OUTRO = 100;
/** Share of the candidate's color by margin step, as the site's --mix (28/52/76/100%). */
const STRENGTH = [0.28, 0.52, 0.76, 1];

/** The round that decided each year: the runoff when there was one. */
const RACES: MapRace[] = (() => {
  const keys = Object.keys(MAP.races).filter((k) => k.startsWith("president-"));
  const years = [...new Set(keys.map((k) => Number(k.split("-")[1])))].sort((a, b) => a - b);
  return years.map((y) => {
    const key = keys.includes(`president-${y}-r2`) ? `president-${y}-r2` : `president-${y}-r1`;
    return decodeRace(MAP, key, MAP.races[key]!);
  });
})();

/** [r, g, b] per municipality per race, computed once. */
const FILLS: Float32Array[] = RACES.map((race) => {
  const surface = rgb(T.surface);
  const empty = rgb(T.rule);
  const out = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const w = race.winner[i]!;
    let c = empty;
    if (w !== NONE) {
      const base = rgb(COLOR[race.groupColors[race.groups[w]!] ?? "gray"]);
      const s = STRENGTH[shade(margin(race, i))]!;
      c = [0, 1, 2].map((k) => base[k]! * s + surface[k]! * (1 - s)) as [number, number, number];
    }
    out.set(c, i * 3);
  }
  return out;
});

/** Labels too long for the panel, as the TSE file has them. */
const SHORT: Record<string, string> = { "Esperidiao Amin Helou Filho": "Esperidião Amin" };

const duration = () => INTRO + RACES.length * HOLD + (RACES.length - 1) * MOVE + OUTRO;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.inOut(Easing.cubic);

function roundLabel(race: MapRace): string {
  if (race.round === "r2") return "2º turno";
  // A year whose runoff has not happened (2026 until the 25th) says so.
  return RACES.at(-1) === race && race.year === 2026 ? "1º turno · 2º turno em 25/10" : "1º turno";
}

function Mapa(_: Props) {
  const frame = useCurrentFrame();
  const { width, height, portrait, u, pad } = useLayout();
  const canvas = useRef<HTMLCanvasElement>(null);
  const n = RACES.length;

  const t = frame - INTRO;
  const step = HOLD + MOVE;
  const i = t < 0 ? 0 : Math.min(n - 1, Math.floor(t / step));
  const p = t >= 0 && i < n - 1 ? interpolate(t - i * step, [HOLD, step], [0, 1], clamp) : 0;
  const a = RACES[i]!;
  const b = RACES[Math.min(i + 1, n - 1)]!;
  const outroAt = INTRO + n * HOLD + (n - 1) * MOVE;

  // Map box.
  const box = portrait
    ? { x: pad, y: 300 * u, w: width - 2 * pad, h: 960 * u }
    : { x: 700 * u, y: 120 * u, w: width - 700 * u - pad, h: height - 120 * u - 110 * u };

  const mapIn = interpolate(frame, [8, 40], [0, 1], clamp);
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const g = geo(box.w, box.h);
    const fa = FILLS[i]!;
    const fb = FILLS[Math.min(i + 1, n - 1)]!;
    const bg = rgb(T.bg);
    // The new colors sweep west to east; each municipality fades over 40% of the move.
    paint(
      el,
      g,
      (k) => {
        const q = p === 0 ? 0 : ease(interpolate(p, [g.nx[k]! * 0.6, g.nx[k]! * 0.6 + 0.4], [0, 1], clamp));
        const c = [0, 1, 2].map((j) => fa[k * 3 + j]! + (fb[k * 3 + j]! - fa[k * 3 + j]!) * q);
        // Intro: the country rises out of the background.
        return css(mapIn < 1 ? c.map((v, j) => bg[j]! + (v - bg[j]!) * mapIn) : c);
      },
      { color: T.bg, width: 1.1 * u },
    );
  });

  // Panel: the race being shown flips halfway through the move.
  const shown = p < 0.5 ? a : b;
  const flip = p === 0 ? 1 : Math.abs(p - 0.5) * 2;
  const wins = winsByGroup(shown).slice(0, 4);
  const counted = p === 0 ? 1 : p < 0.5 ? 1 : ease(interpolate(p, [0.5, 1], [0, 1], clamp));
  // Counts tick up again after the swap, from a quarter of the way, so they read as a count.
  const tick = (v: number) => (p >= 0.5 ? v * (0.25 + 0.75 * counted) : v);
  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const outro = interpolate(frame, [outroAt + 10, outroAt + 30], [0, 1], clamp);

  const panel = portrait
    ? { left: pad, right: pad, top: 1290 * u }
    : { left: pad, width: 560 * u, top: 330 * u };

  return (
    <Stage>
      <Header
        title="Como cada cidade votou"
        subtitle={portrait ? "Presidente, 1994 a 2026: quem venceu em cada município" : "Presidente, 1994 a 2026"}
        opacity={headerIn}
      />
      <canvas
        ref={canvas}
        width={Math.round(box.w)}
        height={Math.round(box.h)}
        style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h }}
      />
      <div style={{ position: "absolute", ...panel, opacity: headerIn }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 20 * u, opacity: flip }}>
          <span
            style={{
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: (portrait ? 150 : 170) * u,
              lineHeight: 0.9,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {shown.year}
          </span>
          <span style={{ fontSize: 26 * u, color: T.ink2, whiteSpace: "nowrap" }}>{roundLabel(shown)}</span>
        </div>
        <div style={{ fontSize: 22 * u, color: T.muted, margin: `${18 * u}px 0 ${12 * u}px` }}>
          municípios vencidos
        </div>
        <div style={{ display: "grid", gridTemplateColumns: portrait ? "1fr 1fr" : "1fr", gap: `${10 * u}px ${32 * u}px` }}>
          {wins.map((w) => (
            <div key={w.group} style={{ display: "flex", alignItems: "center", gap: 14 * u, opacity: flip }}>
              <i
                style={{
                  width: 22 * u,
                  height: 22 * u,
                  borderRadius: 4 * u,
                  background: COLOR[shown.groupColors[w.group] ?? "gray"],
                  flex: "none",
                }}
              />
              <span style={{ fontSize: 30 * u, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {SHORT[w.label] ?? w.label}
              </span>
              <span
                style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 40 * u, fontVariantNumeric: "tabular-nums" }}
              >
                {int(tick(w.wins))}
              </span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 34 * u, fontSize: 19 * u, color: T.muted }}>
          <div style={{ marginBottom: 8 * u }}>vantagem do vencedor no município (pontos)</div>
          <div style={{ display: "flex", gap: 4 * u }}>
            {STRENGTH.map((s, k) => (
              <div key={k} style={{ flex: 1 }}>
                <div style={{ height: 14 * u, background: mix(T.ink2, T.surface, s), borderRadius: 2 * u }} />
                <div style={{ marginTop: 6 * u }}>
                  {k < MARGIN_STEPS.length - 1 ? `${MARGIN_STEPS[k]}–${MARGIN_STEPS[k + 1]}` : `${MARGIN_STEPS[k]}+`}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 30 * u, fontSize: 26 * u, lineHeight: 1.4, opacity: outro }}>
          {RACES.length} eleições, 5.570 municípios. Explore cada um em <b>danillogomes.com/urna</b>.
        </div>
      </div>
      <Footer source="Resultados por município: TSE" opacity={headerIn} />
    </Stage>
  );
}

export const def = motion<Props>({
  id: "Mapa",
  title: "Como cada cidade votou, de 1994 a 2026",
  description: "O mapa dos municípios mudando de cor eleição a eleição: quem venceu e por quanto.",
  component: Mapa,
  defaultProps: {},
  durationInFrames: duration,
  formats: ["portrait", "landscape"],
});
