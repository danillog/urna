/**
 * 7:00 · Como ler pesquisa daqui pra frente. Three tips, one per third of the scene, each
 * with a small drawing; the earlier ones stay, dimmed.
 */
import type { ReactNode } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLOR, DISPLAY, T } from "../../common/theme";
import { Scene, at, clamp, easeInOut, easeOut, type SceneProps } from "../kit";
import { Sfx } from "../sound";

const STARTS = [0.04, 0.36, 0.68];
const TIPS = [
  { title: "Olhe a média, não uma pesquisa", text: "Uma pesquisa sai da curva; a média de várias fica mais perto." },
  { title: "Olhe o histórico do instituto", text: "Quem errou muito antes merece mais cautela." },
  { title: "Olhe o método e a data", text: "Como a entrevista foi feita e quando o campo terminou." },
];

export function Dicas({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const current = STARTS.reduce((c, s, i) => (frame >= at(duration, s) ? i : c), -1);
  const W = 568;
  return (
    <Scene chapter="Como ler pesquisa daqui pra frente">
      {TIPS.map((tip, i) => {
        const start = at(duration, STARTS[i]!);
        const inP = interpolate(frame, [start, start + 16], [0, 1], { ...clamp, easing: easeOut });
        const p = interpolate(frame, [start + 8, start + at(duration, 0.24)], [0, 1], { ...clamp, easing: easeInOut });
        return (
          <div
            key={tip.title}
            style={{
              position: "absolute",
              left: 72 + i * (W + 36),
              top: 200,
              width: W,
              opacity: inP * (current === i ? 1 : 0.45),
              transform: `translateY(${(1 - inP) * 30}px)`,
            }}
          >
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 140, lineHeight: 0.9, color: T.muted }}>{i + 1}</div>
            <div style={{ height: 300, margin: "24px 0", background: T.surface, borderRadius: 16, border: `1px solid ${T.rule}` }}>
              <svg width={W} height={300} viewBox={`0 0 ${W} 300`}>
                {[<Average p={p} />, <History p={p} />, <Method p={p} />][i] as ReactNode}
              </svg>
            </div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 50, lineHeight: 1.05 }}>{tip.title}</div>
            <div style={{ fontSize: 26, color: T.ink2, marginTop: 12, lineHeight: 1.35 }}>{tip.text}</div>
          </div>
        );
      })}
      {STARTS.map((s, i) => (
        <Sfx key={i} name="pop" at={at(duration, s)} volume={0.35} />
      ))}
    </Scene>
  );
}

/** Deterministic scatter in [-1, 1]. */
const jitter = (k: number) => Math.sin(k * 12.9898) * 43758.5453 - Math.floor(Math.sin(k * 12.9898) * 43758.5453) - 0.5;

/** Polls scattered around a smooth line, the line drawing through them. */
function Average({ p }: { p: number }) {
  const curve = (x: number) => 150 - 50 * Math.sin((x / 568) * Math.PI * 1.2);
  const dots = Array.from({ length: 26 }, (_, k) => {
    const x = 30 + k * 20;
    return { x, y: curve(x) + jitter(k) * 110 };
  });
  const until = 30 + p * 510;
  let d = "";
  for (let x = 30; x <= until; x += 6) d += `${d ? "L" : "M"}${x},${curve(x).toFixed(1)}`;
  const outlier = dots[17]!;
  return (
    <g>
      {dots.map((q, k) => (
        <circle key={k} cx={q.x} cy={q.y} r={6} fill={COLOR.sky} opacity={interpolate(p, [k / 40, k / 40 + 0.1], [0, 0.55], clamp)} />
      ))}
      <circle cx={outlier.x} cy={outlier.y} r={11} fill="none" stroke={T.ink2} strokeWidth={2} opacity={interpolate(p, [0.4, 0.5], [0, 1], clamp)} />
      <path d={d} fill="none" stroke={COLOR.sky} strokeWidth={6} strokeLinecap="round" />
    </g>
  );
}

/** One pollster's past errors, election by election. Illustrative: no names, no values. */
function History({ p }: { p: number }) {
  const errs = [0.35, 0.8, 0.25, 0.6, 0.3];
  return (
    <g>
      <line x1={40} x2={528} y1={240} y2={240} stroke={T.muted} strokeWidth={2} />
      {errs.map((e, k) => {
        const h = e * 170 * interpolate(p, [k * 0.12, k * 0.12 + 0.3], [0, 1], { ...clamp, easing: easeOut });
        return (
          <g key={k}>
            <rect x={70 + k * 92} y={240 - h} width={56} height={h} rx={5} fill={e > 0.5 ? COLOR.orange : COLOR.sky} />
            <text x={98 + k * 92} y={272} textAnchor="middle" fill={T.muted} fontSize={18}>
              {["1ª", "2ª", "3ª", "4ª", "5ª"][k]} eleição
            </text>
          </g>
        );
      })}
      <text x={40} y={40} fill={T.muted} fontSize={20}>
        erro do instituto (ilustração)
      </text>
    </g>
  );
}

/** Two poll tags: how the interviews were made and when the fieldwork ended. */
function Method({ p }: { p: number }) {
  const tags = [
    { method: "presencial", date: "campo até 28/09" },
    { method: "online", date: "campo até 01/10" },
  ];
  return (
    <g>
      {tags.map((t, k) => {
        const o = interpolate(p, [0.1 + k * 0.3, 0.3 + k * 0.3], [0, 1], clamp);
        const y = 70 + k * 110;
        return (
          <g key={k} opacity={o} transform={`translate(${(1 - o) * 20} 0)`}>
            <rect x={40} y={y} width={488} height={76} rx={38} fill="#23272d" />
            <circle cx={84} cy={y + 38} r={14} fill={k ? COLOR.violet : COLOR.teal} />
            <text x={114} y={y + 47} fill={T.ink} fontSize={28} fontWeight={600}>
              {t.method}
            </text>
            <text x={505} y={y + 47} fill={T.ink2} fontSize={26} textAnchor="end">
              {t.date}
            </text>
          </g>
        );
      })}
    </g>
  );
}
