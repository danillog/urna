/**
 * Regras: the three rules of the measurement, a third of the scene each, all on real 2026
 * 1st-round data: (1) a poll turned into valid votes, (2) only each pollster's last poll in
 * the 10 days before the election, (3) the error with a sign, on a ruler.
 */
import type { ReactNode } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import electionsJson from "../../../../data/generated/elections.json";
import type { Dataset } from "../../../../src/types";
import { COLOR, DISPLAY, T } from "../../common/theme";
import { DATA } from "../data";
import { Sfx } from "../sound";
import { Reveal, Scene, Title, at, clamp, easeInOut, easeOut, num, signed, type SceneProps } from "../kit";

const RACE = (electionsJson as unknown as Dataset).presidential["2026"]!.rounds.r1!;
const ED = RACE.electionDay;
const WINDOW = DATA.rules.window;

/** Rule 1's example: Quaest's last poll before the election (a real one, with undecided). */
const EXAMPLE = RACE.polls.filter((p) => p.p === "Quaest" && p.d < ED).at(-1)!;
const PARTS: { key: string; label: string; color: string }[] = [
  { key: "Lula", label: "Lula", color: COLOR.red },
  { key: "Flávio", label: "Flávio", color: COLOR.blue },
  { key: "Cury", label: "Cury", color: COLOR.gold },
  { key: "others", label: "Outros", color: COLOR.gray },
];
const UNDECIDED = EXAMPLE.v.undecided ?? 0;
const dayMonth = (d: number) => {
  const date = new Date(Date.UTC(2026, 0, 1) + d * 864e5);
  return `${date.getUTCDate()}/${date.getUTCMonth() + 1}`;
};

/** Rule 2: every pollster with a poll in the last 60 days, and its polls. */
const FROM = ED - 60;
const ROWS = Object.entries(
  RACE.polls
    .filter((p) => p.d >= FROM && p.d < ED)
    .reduce<Record<string, number[]>>((acc, p) => ((acc[p.p] ??= []).push(p.d), acc), {}),
)
  .map(([p, ds]) => ({ p, ds: ds.sort((a, b) => a - b) }))
  .sort((a, b) => b.ds.at(-1)! - a.ds.at(-1)!);

/** Rule 3: the signed errors of 2026 (mean of the final polls), from erro-pesquisas.json. */
const R2026 = DATA.president.find((r) => r.year === 2026 && r.round === "r1")!;

function RuleHead({
  n,
  children,
  duration,
  from,
  until,
}: {
  n: number;
  children: ReactNode;
  duration: number;
  from: number;
  until: number;
}) {
  return (
    <Reveal
      duration={duration}
      from={from}
      until={until}
      style={{ position: "absolute", left: 120, top: 150, display: "flex", gap: 36, alignItems: "center" }}
    >
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: 60,
          border: `4px solid ${T.ink}`,
          display: "grid",
          placeItems: "center",
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 76,
        }}
      >
        {n}
      </div>
      <Title size={72}>{children}</Title>
    </Reveal>
  );
}

export function Regras({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const f = (x: number) => at(duration, x);
  const third = 1 / 3;

  // Rule 1: blank, null and undecided leave the bar, the rest stretches to 100%.
  const leave = interpolate(frame, [f(0.13), f(0.18)], [0, 1], { ...clamp, easing: easeInOut });
  const stretch = interpolate(frame, [f(0.18), f(0.24)], [0, 1], { ...clamp, easing: easeInOut });
  const BAR = { x: 220, w: 1480, h: 110 };
  const base = 100 - UNDECIDED * stretch;

  // Rule 2.
  const TL = { x: 520, w: 1240, y: 330, row: 44 };
  const xOf = (d: number) => TL.x + ((d - FROM) / (ED - FROM)) * TL.w;
  const windowIn = interpolate(frame, [f(0.43), f(0.47)], [0, 1], { ...clamp, easing: easeOut });
  const pick = interpolate(frame, [f(0.5), f(0.56)], [0, 1], clamp);

  // Rule 3: the ruler from −6 to +6 points.
  const RU = { x: 260, w: 1400, y: 600 };
  const xr = (v: number) => RU.x + ((v + 6) / 12) * RU.w;
  const slide1 = interpolate(frame, [f(0.78), f(0.84)], [0, R2026.rivalError!], { ...clamp, easing: easeInOut });
  const slide2 = interpolate(frame, [f(0.87), f(0.92)], [0, R2026.ptError!], { ...clamp, easing: easeInOut });

  return (
    <Scene chapter="Como medir sem se enganar">
      {/* --- 1. Same base --------------------------------------------------------------- */}
      <RuleHead n={1} duration={duration} from={0.02} until={third}>
        Mesma base: votos válidos
      </RuleHead>
      <Reveal duration={duration} from={0.06} until={third} style={{ position: "absolute", inset: 0 }}>
        <div style={{ position: "absolute", left: BAR.x, top: 390, fontSize: 28, color: T.ink2 }}>
          {stretch < 0.5 ? "Votos totais: como a pesquisa pergunta" : "Votos válidos: como o TSE divulga"}
        </div>
        <div style={{ position: "absolute", left: BAR.x, top: 440, width: BAR.w, height: BAR.h, display: "flex" }}>
          {PARTS.map((part) => {
            const v = EXAMPLE.v[part.key] ?? 0;
            return (
              <div
                key={part.key}
                style={{
                  width: `${(v / base) * 100}%`,
                  background: part.color,
                  borderRight: `3px solid ${T.bg}`,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  paddingLeft: (v / base) * BAR.w < 140 ? 8 : 16,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                }}
              >
                <div style={{ fontSize: (v / base) * BAR.w < 140 ? 18 : 26, fontWeight: 600 }}>{part.label}</div>
                <div
                  style={{
                    fontFamily: DISPLAY,
                    fontWeight: 700,
                    fontSize: (v / base) * BAR.w < 140 ? 28 : 40,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {num((v / base) * 100)}%
                </div>
              </div>
            );
          })}
          {/* Blank, null and undecided: drop out of the bar. */}
          <div
            style={{
              width: `${(UNDECIDED / base) * 100 * (1 - stretch)}%`,
              background: "repeating-linear-gradient(135deg, #3a3e44 0 10px, #2a2e34 10px 20px)",
              transform: `translateY(${leave * 160}px)`,
              opacity: (1 - leave * 0.5) * (1 - stretch),
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              paddingLeft: 14,
              whiteSpace: "nowrap",
              overflow: "visible",
            }}
          >
            <div style={{ fontSize: 22, color: T.ink2 }}>brancos, nulos e indecisos</div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 36 }}>{num(UNDECIDED, 0)}%</div>
          </div>
        </div>
        <div style={{ position: "absolute", left: BAR.x, top: 790, fontSize: 24, color: T.muted }}>
          Exemplo real: Quaest, campo até {dayMonth(EXAMPLE.d)}, 1º turno de 2026
        </div>
      </Reveal>

      {/* --- 2. The last poll of each pollster, in the window ------------------------------ */}
      <RuleHead n={2} duration={duration} from={third + 0.01} until={2 * third}>
        Só a última pesquisa de cada instituto
      </RuleHead>
      <Reveal duration={duration} from={third + 0.03} until={2 * third} style={{ position: "absolute", inset: 0 }}>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          {/* The 10-day window. */}
          <rect
            x={xOf(ED - WINDOW)}
            y={TL.y - 30}
            width={(xOf(ED) - xOf(ED - WINDOW)) * windowIn}
            height={ROWS.length * TL.row + 30}
            fill={T.ink}
            opacity={0.08}
          />
          <line
            x1={xOf(ED)}
            x2={xOf(ED)}
            y1={TL.y - 40}
            y2={TL.y + ROWS.length * TL.row}
            stroke={T.muted}
            strokeDasharray="6 8"
            strokeWidth={2}
          />
          <text x={xOf(ED)} y={TL.y - 52} fill={T.ink2} fontSize={24} textAnchor="middle">
            eleição
          </text>
          <text
            x={xOf(ED - WINDOW / 2)}
            y={TL.y + ROWS.length * TL.row + 44}
            fill={T.ink}
            fontSize={26}
            textAnchor="middle"
            opacity={windowIn}
          >
            10 dias
          </text>
          {ROWS.map((r, i) => {
            const y = TL.y + i * TL.row + TL.row / 2 - 10;
            const inWindow = r.ds.filter((d) => d >= ED - WINDOW);
            const chosen = inWindow.at(-1);
            return (
              <g key={r.p}>
                <text
                  x={TL.x - 24}
                  y={y + 8}
                  fill={T.ink2}
                  fontSize={22}
                  textAnchor="end"
                  opacity={chosen == null ? 1 - 0.6 * pick : 1}
                >
                  {r.p}
                </text>
                <line x1={TL.x} x2={TL.x + TL.w} y1={y} y2={y} stroke={T.grid} strokeWidth={1} />
                {r.ds.map((d) => {
                  const lit = d === chosen;
                  return (
                    <circle
                      key={d}
                      cx={xOf(d)}
                      cy={y}
                      r={lit ? 9 + 3 * pick : 8}
                      fill={lit ? COLOR.gold : T.ink2}
                      opacity={lit ? 1 : 1 - 0.75 * pick}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
        <Reveal
          duration={duration}
          from={0.57}
          style={{
            position: "absolute",
            left: 120,
            top: 330,
            width: 280,
            fontSize: 26,
            color: T.ink2,
            lineHeight: 1.4,
          }}
        >
          <span style={{ color: COLOR.gold }}>●</span> a que entra na conta
        </Reveal>
      </Reveal>

      {/* --- 3. Signed error --------------------------------------------------------------- */}
      <RuleHead n={3} duration={duration} from={2 * third + 0.01} until={1.01}>
        Erro com sinal
      </RuleHead>
      <Reveal duration={duration} from={2 * third + 0.03} style={{ position: "absolute", inset: 0 }}>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <line x1={RU.x} x2={RU.x + RU.w} y1={RU.y} y2={RU.y} stroke={T.ink2} strokeWidth={3} />
          {Array.from({ length: 13 }, (_, i) => i - 6).map((v) => (
            <g key={v}>
              <line
                x1={xr(v)}
                x2={xr(v)}
                y1={RU.y - (v === 0 ? 30 : 14)}
                y2={RU.y + (v === 0 ? 30 : 14)}
                stroke={T.ink2}
                strokeWidth={v === 0 ? 4 : 2}
              />
              <text
                x={xr(v)}
                y={RU.y + 62}
                fill={v === 0 ? T.ink : T.muted}
                fontSize={v === 0 ? 34 : 24}
                textAnchor="middle"
              >
                {v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0"}
              </text>
            </g>
          ))}
        </svg>
        <Reveal
          duration={duration}
          from={0.72}
          style={{ position: "absolute", left: RU.x, top: 430, fontSize: 32, color: T.ink2 }}
        >
          ← subestimou: a pesquisa deu <b style={{ color: T.ink }}>menos</b> que a urna
        </Reveal>
        <Reveal
          duration={duration}
          from={0.74}
          style={{
            position: "absolute",
            right: 1920 - RU.x - RU.w,
            top: 430,
            fontSize: 32,
            color: T.ink2,
            textAlign: "right",
          }}
        >
          superestimou: deu <b style={{ color: T.ink }}>mais</b> que a urna →
        </Reveal>
        {/* Two real markers: 2026, mean error of the final polls. */}
        {[
          { v: slide1, name: R2026.rival, color: COLOR.blue, from: 0.78, y: RU.y + 130 },
          { v: slide2, name: R2026.pt, color: COLOR.red, from: 0.87, y: RU.y + 230 },
        ].map((m) => (
          <Reveal key={m.name} duration={duration} from={m.from} style={{ position: "absolute", inset: 0 }}>
            <div
              style={{
                position: "absolute",
                left: xr(m.v) - 14,
                top: RU.y - 14,
                width: 28,
                height: 28,
                transform: "rotate(45deg)",
                background: m.color,
              }}
            />
            <div style={{ position: "absolute", left: xr(m.v) - 200, width: 400, top: m.y, textAlign: "center" }}>
              <div style={{ fontSize: 28, color: m.color, fontWeight: 600 }}>{m.name}, 2026</div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 64, lineHeight: 1 }}>{signed(m.v)}</div>
            </div>
          </Reveal>
        ))}
      </Reveal>

      <Sfx name="pop" at={f(0.02)} volume={0.3} />
      <Sfx name="swish" at={f(0.13)} volume={0.35} />
      <Sfx name="tick" at={f(0.24)} volume={0.3} />
      <Sfx name="pop" at={f(third + 0.01)} volume={0.3} />
      <Sfx name="swish" at={f(0.43)} volume={0.3} />
      <Sfx name="chime" at={f(0.5)} volume={0.25} />
      <Sfx name="pop" at={f(2 * third + 0.01)} volume={0.3} />
      <Sfx name="swish" at={f(0.78)} volume={0.3} />
      <Sfx name="swish" at={f(0.87)} volume={0.3} />
    </Scene>
  );
}
