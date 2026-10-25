/**
 * Promessa: every poll in the base, one dot each, flying into a grid while the counter climbs
 * to every poll in the base; then 52 institutos, the two subtotals and the three questions.
 */
import { interpolate, useCurrentFrame } from "remotion";
import electionsJson from "../../../../data/generated/elections.json";
import type { Dataset } from "../../../../src/types";
import { COLOR, DISPLAY, T, int } from "../../common/theme";
import { DATA } from "../data";
import { Sfx } from "../sound";
import { Reveal, Scene, at, clamp, easeInOut, easeOut, type SceneProps } from "../kit";

const elections = electionsJson as unknown as Dataset;

/** Groups of dots, in grid order: president by year, then governor and senator (2026). */
const GROUPS: { label: string; color: string; n: number }[] = [
  ...Object.entries(elections.presidential)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([year, e], i) => ({
      label: `Presidente ${year}`,
      color: [COLOR.sky, COLOR.teal, COLOR.gold, COLOR.pink, COLOR.violet][i] ?? COLOR.gray,
      n: Object.values(e.rounds).reduce((s, r) => s + (r?.polls.length ?? 0), 0),
    })),
  {
    label: "Governador e senador 2026",
    color: COLOR.green,
    n: Object.values(elections.states).reduce(
      (s, st) =>
        s +
        [...Object.values(st.governor), ...Object.values(st.senate)].reduce((a, r) => a + (r?.polls.length ?? 0), 0),
      0,
    ),
  },
];
const TOTAL = GROUPS.reduce((s, g) => s + g.n, 0);
const COLORS = GROUPS.flatMap((g) => Array.from({ length: g.n }, () => g.color));

const COLS = 44;
const GAP = 17.6;
const GRID = { x: 1020, y: 190 };

/** Deterministic scatter for where each dot comes from. */
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export function Promessa({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const f = (x: number) => at(duration, x);
  const count = interpolate(frame, [f(0.04), f(0.5)], [0, TOTAL], { ...clamp, easing: easeInOut });
  const pollsters = interpolate(frame, [f(0.52), f(0.64)], [0, DATA.counts.pollsters], { ...clamp, easing: easeOut });
  // The grid steps back when the three questions come in over it.
  const gridDim = interpolate(frame, [f(0.77), f(0.8)], [1, 0.16], clamp);

  // Ticks while counting: one every few frames, not one per dot.
  const ticks: number[] = [];
  for (let t = f(0.05); t < f(0.49); t += 7) ticks.push(t);
  const pollsterTicks: number[] = [];
  for (let t = f(0.52); t < f(0.63); t += 9) pollsterTicks.push(t);

  return (
    <Scene>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: gridDim }}>
        {COLORS.map((color, i) => {
          // Each dot sets off when the counter passes it and lands 40 polls later; the last ones
          // land once the counter has stopped, so the flight runs on to TOTAL + 40.
          const q = interpolate(count * ((TOTAL + 40) / TOTAL) - i, [0, 40], [0, 1], { ...clamp, easing: easeOut });
          if (q <= 0) return null;
          const tx = GRID.x + (i % COLS) * GAP;
          const ty = GRID.y + Math.floor(i / COLS) * GAP;
          const sx = GRID.x - 300 + rand(i, 1) * 1100;
          const sy = -60 + rand(i, 2) * 1200;
          return (
            <circle
              key={i}
              cx={sx + (tx - sx) * q}
              cy={sy + (ty - sy) * q}
              r={6.4}
              fill={color}
              opacity={0.25 + 0.75 * q}
            />
          );
        })}
      </svg>

      {/* Counters. */}
      <div style={{ position: "absolute", left: 120, top: 250 }}>
        <div
          style={{
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: 220,
            lineHeight: 0.9,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {int(count)}
        </div>
        <div style={{ fontSize: 40, color: T.ink2 }}>pesquisas</div>
        <div style={{ marginTop: 50, opacity: interpolate(frame, [f(0.51), f(0.53)], [0, 1], clamp) }}>
          <span
            style={{
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: 130,
              lineHeight: 0.9,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {int(pollsters)}
          </span>
          <span style={{ fontSize: 40, color: T.ink2, marginLeft: 20 }}>institutos</span>
        </div>
      </div>

      {/* The two parts of the base. */}
      <Reveal
        duration={duration}
        from={0.68}
        style={{ position: "absolute", left: 120, top: 800, fontSize: 30, lineHeight: 1.5 }}
      >
        <div>
          <b>{int(DATA.counts.president)}</b> <span style={{ color: T.ink2 }}>para presidente, de 2010 a 2026</span>
        </div>
        <div>
          <b>{int(DATA.counts.states)}</b> <span style={{ color: T.ink2 }}>para governador e senador, em 2026</span>
        </div>
      </Reveal>

      {/* Legend under the grid. */}
      <Reveal
        duration={duration}
        from={0.1}
        until={0.78}
        style={{
          position: "absolute",
          left: GRID.x,
          top: GRID.y + Math.ceil(TOTAL / COLS) * GAP + 30,
          width: COLS * GAP,
          display: "flex",
          flexWrap: "wrap",
          gap: "10px 22px",
          fontSize: 22,
          color: T.muted,
        }}
      >
        {GROUPS.map((g) => (
          <span key={g.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i style={{ width: 14, height: 14, borderRadius: 7, background: g.color }} />
            {g.label}
          </span>
        ))}
      </Reveal>

      {/* What the video answers. */}
      <div style={{ position: "absolute", left: GRID.x, top: 360, display: "flex", flexDirection: "column", gap: 28 }}>
        {["Existe um lado?", "Quem erra mais?", "O que isso significa, e o que não"].map((q, i) => (
          <Reveal key={q} duration={duration} from={0.8 + i * 0.05}>
            <div
              style={{
                fontFamily: DISPLAY,
                fontWeight: 600,
                fontSize: 64,
                borderLeft: `4px solid ${T.ink}`,
                paddingLeft: 18,
              }}
            >
              {q}
            </div>
          </Reveal>
        ))}
      </div>

      {ticks.map((t) => (
        <Sfx key={t} name="tick" at={t} volume={0.18} />
      ))}
      <Sfx name="chime" at={f(0.5)} volume={0.35} />
      {pollsterTicks.map((t) => (
        <Sfx key={`p${t}`} name="tick" at={t} volume={0.2} />
      ))}
      {[0.8, 0.85, 0.9].map((x) => (
        <Sfx key={x} name="pop" at={f(x)} volume={0.25} />
      ))}
    </Scene>
  );
}
