/**
 * 4:45 · Por que os erros acontecem. Four hypothesis cards, one per quarter of the scene,
 * each with a small drawing; then the honest close: the data show the pattern, not the cause.
 */
import type { ReactNode } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { COLOR, DISPLAY, T } from "../../common/theme";
import { Reveal, Scene, at, clamp, easeInOut, easeOut, type SceneProps } from "../kit";
import { Sfx } from "../sound";

/** When each card comes in, as a fraction of the scene. */
const STARTS = [0.04, 0.25, 0.46, 0.67];
const END = 0.88;

const CARDS = [
  { title: "Decisão de última hora", text: "Parte do eleitor decide depois da última pesquisa." },
  { title: "Quem vai votar de fato", text: "Se um grupo falta mais às urnas, o resultado se desloca." },
  { title: "A amostra", text: "As cotas vinham do Censo de 2010 até o de 2022 sair." },
  { title: "O voto não declarado", text: "Quem não conta o voto, ou diz outro ao entrevistador." },
];

export function Porque({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const W = 872;
  const H = 360;
  const pos = (i: number) => ({ left: 72 + (i % 2) * (W + 32), top: 140 + Math.floor(i / 2) * (H + 32) });
  // The card being talked about is lit; the others step back.
  const current = STARTS.reduce((c, s, i) => (frame >= at(duration, s) ? i : c), -1);
  const ending = frame >= at(duration, END);

  return (
    <Scene chapter="Por que os erros acontecem">
      {CARDS.map((c, i) => {
        const start = at(duration, STARTS[i]!);
        const span = at(duration, (STARTS[i + 1] ?? END) - STARTS[i]!);
        const inP = interpolate(frame, [start, start + 16], [0, 1], { ...clamp, easing: easeOut });
        const p = interpolate(frame, [start + 10, start + span * 0.8], [0, 1], { ...clamp, easing: easeInOut });
        const lit = !ending && current === i;
        return (
          <div
            key={c.title}
            style={{
              position: "absolute",
              ...pos(i),
              width: W,
              height: H,
              opacity: inP * (lit || current < i ? 1 : ending ? 0.55 : 0.4),
              transform: `translateY(${(1 - inP) * 30}px)`,
              background: T.surface,
              border: `1px solid ${lit ? "#4a4f57" : T.rule}`,
              borderRadius: 18,
              display: "flex",
              alignItems: "center",
              gap: 36,
              padding: "0 40px",
            }}
          >
            <svg width={260} height={260} viewBox="0 0 260 260" style={{ flex: "none" }}>
              {[<LastMinute p={p} />, <Turnout p={p} />, <Quotas p={p} />, <Unsaid p={p} frame={frame} />][i]}
            </svg>
            <div>
              <Tag>hipótese {i + 1}</Tag>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 52, lineHeight: 1.05, marginTop: 14 }}>
                {c.title}
              </div>
              <div style={{ fontSize: 26, color: T.ink2, marginTop: 14, lineHeight: 1.35, maxWidth: 480 }}>{c.text}</div>
            </div>
          </div>
        );
      })}
      {STARTS.map((s, i) => (
        <Sfx key={i} name="pop" at={at(duration, s)} volume={0.35} />
      ))}

      <Reveal duration={duration} from={END} style={{ position: "absolute", left: 72, right: 72, top: 935 }}>
        <div style={{ fontSize: 40, lineHeight: 1.3 }}>
          Provavelmente uma mistura das quatro.{" "}
          <span style={{ color: T.ink2 }}>Os dados mostram o padrão, não a causa.</span>
        </div>
      </Reveal>
      <Sfx name="swish" at={at(duration, END)} volume={0.3} />
    </Scene>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: DISPLAY,
        fontWeight: 600,
        fontSize: 22,
        letterSpacing: 2,
        textTransform: "uppercase",
        color: T.muted,
        border: `1px solid ${T.rule}`,
        borderRadius: 999,
        padding: "4px 14px",
      }}
    >
      {children}
    </span>
  );
}

/** A campaign's last days: the last poll, then the vote; a voter makes up their mind in between. */
function LastMinute({ p }: { p: number }) {
  const x0 = 20;
  const x1 = 240;
  const poll = 150;
  const vote = 225;
  const walker = interpolate(p, [0.3, 0.85], [poll - 40, vote - 12], clamp);
  const gap = interpolate(p, [0.15, 0.35], [0, 1], clamp);
  return (
    <g>
      <rect x={poll} y={70} width={(vote - poll) * gap} height={120} fill="#2a2440" rx={6} />
      <line x1={x0} x2={x1} y1={160} y2={160} stroke={T.muted} strokeWidth={3} />
      {Array.from({ length: 12 }, (_, k) => (
        <line key={k} x1={x0 + k * 18} x2={x0 + k * 18} y1={154} y2={166} stroke={T.rule} strokeWidth={2} />
      ))}
      <circle cx={poll} cy={160} r={10} fill={T.ink2} />
      <text x={poll} y={205} textAnchor="middle" fill={T.muted} fontSize={17}>
        última pesquisa
      </text>
      <rect x={vote - 11} y={149} width={22} height={22} fill={T.ink} transform={`rotate(45 ${vote} 160)`} />
      <text x={vote} y={60} textAnchor="middle" fill={T.muted} fontSize={17}>
        urna
      </text>
      <line x1={vote} x2={vote} y1={68} y2={145} stroke={T.muted} strokeDasharray="3 4" />
      {/* The voter who decides late. */}
      <circle cx={walker} cy={120} r={11} fill={p > 0.85 ? COLOR.violet : T.ink2} />
      <rect x={walker - 9} y={133} width={18} height={20} rx={6} fill={p > 0.85 ? COLOR.violet : T.ink2} />
    </g>
  );
}

/** Two groups of voters; one of them goes to the polls less. */
function Turnout({ p }: { p: number }) {
  const dots: ReactNode[] = [];
  for (const [g, color, x0] of [
    [0, COLOR.red, 18],
    [1, COLOR.blue, 140],
  ] as const) {
    for (let k = 0; k < 20; k++) {
      const cx = x0 + (k % 4) * 27 + 13;
      const cy = 50 + Math.floor(k / 4) * 34;
      // Group 1 loses a third of its dots, one by one.
      const gone = g === 1 && k % 3 === 1 ? interpolate(p, [0.25 + (k / 20) * 0.5, 0.35 + (k / 20) * 0.5], [1, 0.12], clamp) : 1;
      dots.push(<circle key={`${g}-${k}`} cx={cx} cy={cy} r={10} fill={color} opacity={gone} />);
    }
  }
  return (
    <g>
      {dots}
      <text x={65} y={235} textAnchor="middle" fill={T.muted} fontSize={17}>
        grupo A
      </text>
      <text x={187} y={235} textAnchor="middle" fill={T.muted} fontSize={17}>
        grupo B
      </text>
    </g>
  );
}

/** Quota bars set from an old census, then from the new one. Illustrative: no values. */
function Quotas({ p }: { p: number }) {
  const old = [0.75, 0.5, 0.35, 0.6];
  const now = [0.55, 0.62, 0.5, 0.42];
  const q = interpolate(p, [0.3, 0.7], [0, 1], { ...clamp, easing: easeInOut });
  return (
    <g>
      {old.map((o, k) => {
        const h = (o + (now[k]! - o) * q) * 150;
        return <rect key={k} x={28 + k * 54} y={190 - h} width={38} height={h} rx={4} fill={COLOR.sky} opacity={0.85} />;
      })}
      <line x1={18} x2={242} y1={190} y2={190} stroke={T.muted} strokeWidth={2} />
      <text x={130} y={225} textAnchor="middle" fill={T.ink2} fontSize={20} fontWeight={600}>
        Censo {q < 0.5 ? "2010" : "2022"}
      </text>
      <text x={130} y={248} textAnchor="middle" fill={T.muted} fontSize={15}>
        cotas da amostra (ilustração)
      </text>
    </g>
  );
}

/** An interviewer's question and an answer that does not come. */
function Unsaid({ p, frame }: { p: number; frame: number }) {
  const shown = interpolate(p, [0.1, 0.3], [0, 1], clamp);
  return (
    <g opacity={shown}>
      <rect x={20} y={40} width={150} height={60} rx={14} fill="#2a2e34" />
      <text x={95} y={78} textAnchor="middle" fill={T.ink2} fontSize={20}>
        Em quem vota?
      </text>
      <rect x={90} y={130} width={150} height={70} rx={16} fill={COLOR.violet} opacity={0.85} />
      <path d="M200 198 L215 222 L222 196 Z" fill={COLOR.violet} opacity={0.85} />
      {[0, 1, 2].map((k) => (
        <circle
          key={k}
          cx={135 + k * 30}
          cy={165}
          r={8}
          fill={T.ink}
          opacity={0.35 + 0.65 * Math.max(0, Math.sin(((frame / 10) - k * 0.7) * 1.2))}
        />
      ))}
    </g>
  );
}
