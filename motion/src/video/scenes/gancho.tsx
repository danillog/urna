/**
 * Gancho: the 2026 1st round. The average of the polls runs up to election day, then the
 * official result drops in as diamonds, and Flávio's falls well above his line.
 */
import { interpolate, useCurrentFrame } from "remotion";
import { prepare } from "../../pesquisas";
import { COLOR, DISPLAY, T } from "../../common/theme";
import { Sfx } from "../sound";
import { Reveal, Scene, Title, at, clamp, easeInOut, easeOut, num, type SceneProps } from "../kit";

const P = prepare(2026, "r1")!;
const SHOWN = ["Flávio", "Lula"];
const LINES = P.lines.filter((l) => SHOWN.includes(l.series));
/** The last four months: the stretch where the average decides how the eve looks. */
const D0 = P.endDay - 120;
const D1 = P.endDay + 8;
const Y0 = 30;
const Y1 = 55;

const CH = { x: 200, y: 200, w: 1300, h: 680 };
const xOf = (d: number) => CH.x + ((d - D0) / (D1 - D0)) * CH.w;
const yOf = (v: number) => CH.y + CH.h - ((v - Y0) / (Y1 - Y0)) * CH.h;
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out"];
const monthDay = (m: number) => (Date.UTC(2026, m, 1) - Date.UTC(2026, 0, 1)) / 864e5;

export function Gancho({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const f = (x: number) => at(duration, x);
  const axesIn = interpolate(frame, [0, f(0.05)], [0, 1], clamp);
  // The cursor day: sweeps the last four months up to election day.
  const cursor = interpolate(frame, [f(0.04), f(0.42)], [D0, P.endDay], { ...clamp, easing: easeInOut });
  const eve = interpolate(frame, [f(0.42), f(0.46)], [0, 1], clamp);
  const drop = (start: number) =>
    interpolate(frame, [f(start), f(start) + 18], [0, 1], { ...clamp, easing: (t) => 1 - (1 - t) ** 3 });
  const bracket = interpolate(frame, [f(0.6), f(0.66)], [0, 1], { ...clamp, easing: easeOut });
  const dim = interpolate(frame, [f(0.8), f(0.84)], [1, 0.25], clamp);

  const flavio = LINES.find((l) => l.series === "Flávio")!;
  const lula = LINES.find((l) => l.series === "Lula")!;
  const fFinal = flavio.final!;
  const fResult = flavio.result!;
  const gap = fResult - fFinal;
  const ex = xOf(P.endDay);

  return (
    <Scene>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: axesIn * dim }}>
        {[30, 35, 40, 45, 50, 55].map((v) => (
          <g key={v}>
            <line x1={CH.x} x2={CH.x + CH.w} y1={yOf(v)} y2={yOf(v)} stroke={T.grid} strokeWidth={1.5} />
            <text x={CH.x - 18} y={yOf(v) + 9} fill={T.muted} fontSize={26} textAnchor="end">
              {v}%
            </text>
          </g>
        ))}
        {[6, 7, 8, 9].map((m) => (
          <text key={m} x={xOf(monthDay(m))} y={CH.y + CH.h + 44} fill={T.muted} fontSize={26} textAnchor="middle">
            {MONTHS[m]}
          </text>
        ))}
        {/* Election day. */}
        <line x1={ex} x2={ex} y1={CH.y - 20} y2={CH.y + CH.h} stroke={T.muted} strokeDasharray="6 8" strokeWidth={2} />
        <text x={ex} y={CH.y - 32} fill={T.ink2} fontSize={26} textAnchor="middle">
          4 de outubro
        </text>

        {/* The averages, drawn up to the cursor. */}
        {LINES.map((l) => {
          const pts = l.points.filter((p) => p.d >= D0 && p.d <= cursor);
          if (pts.length < 2) return null;
          const d = pts.map((p, i) => `${i ? "L" : "M"}${xOf(p.d).toFixed(1)},${yOf(p.y).toFixed(1)}`).join("");
          const end = pts.at(-1)!;
          return (
            <g key={l.series}>
              <path d={d} fill="none" stroke={l.color} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={xOf(end.d)} cy={yOf(end.y)} r={10} fill={l.color} />
            </g>
          );
        })}

        {/* The result: diamonds falling onto election day. */}
        {[
          { l: flavio, start: 0.5 },
          { l: lula, start: 0.53 },
        ].map(({ l, start }) => {
          const q = drop(start);
          if (q <= 0) return null;
          const y = yOf(l.result!) - (1 - q) * 520;
          return (
            <g key={l.series} opacity={Math.min(1, q * 3)} transform={`translate(${ex + 46},${y}) rotate(45)`}>
              <rect x={-12} y={-12} width={24} height={24} fill={T.bg} stroke={l.color} strokeWidth={5} />
            </g>
          );
        })}

        {/* Flávio's gap: from the average's end to the diamond. */}
        {bracket > 0 ? (
          <g opacity={bracket}>
            <path
              d={`M${ex + 12},${yOf(fFinal)} H${ex + 236} V${yOf(fFinal) - (yOf(fFinal) - yOf(fResult)) * bracket} H${ex + 216}`}
              fill="none"
              stroke={T.ink}
              strokeWidth={3}
            />
          </g>
        ) : null}
      </svg>

      {/* The eve's numbers beside the lines' ends, then the ballot's beside the diamonds. */}
      <div style={{ opacity: dim }}>
        {[
          { l: lula, dy: -46 },
          { l: flavio, dy: 22 },
        ].map(({ l, dy }) => (
          <div
            key={l.series}
            style={{
              position: "absolute",
              left: xOf(P.endDay - 34),
              top: yOf(l.final!) + dy,
              opacity: eve,
              fontSize: 30,
              color: l.color,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {l.series} {num(l.final!)}%
          </div>
        ))}
        <div
          style={{
            position: "absolute",
            left: ex + 80,
            top: yOf(fResult) - 30,
            opacity: drop(0.5),
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: 52,
            color: COLOR.blue,
          }}
        >
          {num(fResult)}%
        </div>
        <div
          style={{
            position: "absolute",
            left: ex + 80,
            top: yOf(lula.result!) - 2,
            opacity: drop(0.53),
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: 36,
            color: COLOR.red,
          }}
        >
          {num(lula.result!)}%
        </div>
        <div
          style={{
            position: "absolute",
            left: ex + 256,
            top: (yOf(fFinal) + yOf(fResult)) / 2 - 50,
            opacity: bracket,
            transform: `translateX(${(1 - bracket) * 20}px)`,
          }}
        >
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 72, lineHeight: 1 }}>+{num(gap)}</div>
          <div style={{ fontSize: 26, color: T.ink2 }}>pontos</div>
        </div>
        <Reveal duration={duration} from={0.46} style={{ position: "absolute", left: CH.x, top: 96 }}>
          <div style={{ fontSize: 30, color: T.ink2 }}>
            1º turno de 2026 · <span style={{ color: T.ink }}>linha</span>: média das pesquisas ·{" "}
            <span style={{ color: T.ink }}>◇</span>: urna
          </div>
        </Reveal>
        <Reveal duration={duration} from={0.68} style={{ position: "absolute", left: CH.x, top: CH.y + CH.h - 130 }}>
          <div style={{ fontSize: 34, color: T.ink, background: `${T.bg}cc`, padding: "8px 0" }}>
            A média tinha Lula na frente. A urna, Flávio.
          </div>
        </Reveal>
      </div>

      {/* The question. */}
      <Reveal
        duration={duration}
        from={0.84}
        style={{ position: "absolute", left: 0, right: 0, top: 420, textAlign: "center" }}
      >
        <Title size={110}>Azar, ou sempre</Title>
        <Title size={110}>para o mesmo lado?</Title>
      </Reveal>

      <Sfx name="swish" at={f(0.03)} volume={0.3} />
      <Sfx name="hit" at={f(0.5) + 14} volume={0.55} />
      <Sfx name="pop" at={f(0.53) + 14} volume={0.35} />
      <Sfx name="swish" at={f(0.6)} volume={0.35} />
      <Sfx name="riser" at={f(0.84) - 60} volume={0.3} />
      <Sfx name="hit" at={f(0.84)} volume={0.4} />
    </Scene>
  );
}
