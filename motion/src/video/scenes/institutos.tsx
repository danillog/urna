/**
 * Block 5, "Quem erra mais, e como". Part 1: the pollsters ranked by mean error (president
 * only, 3 or more votes), the 0,19 of 2022, and how a pollster's error jumps from one vote
 * to the next. Part 2: the error by method of interview, with its caveats.
 */
import { interpolate, useCurrentFrame } from "remotion";
import { COLOR, DISPLAY, T } from "../../common/theme";
import { DATA } from "../data";
import { Reveal, Scene, Title, at, clamp, easeInOut, easeOut, num, signed, type SceneProps } from "../kit";
import { Sfx } from "../sound";

const METHOD: Record<string, string> = { in_person: "presencial", phone: "telefone", online: "online" };
const RANK = DATA.rankingPresident;
const worst = RANK[RANK.length - 1]!;
const minRounds = Math.min(...RANK.map((r) => r.rounds));

// The best final poll on record: the closest pollster of any presidential vote.
const best = DATA.president
  .flatMap((r) => r.pollsters.map((x) => ({ ...x, year: r.year, round: r.round })))
  .reduce((a, b) => (b.abs < a.abs ? b : a));

// Pollsters followed vote by vote: the four with the most votes in the window, ties broken
// by how far their error swung.
const ROUNDS = DATA.president;
const errorsOf = (p: string) => ROUNDS.flatMap((r) => r.pollsters.filter((q) => q.p === p).map((q) => q.abs));
const swing = (p: string) => Math.max(...errorsOf(p)) - Math.min(...errorsOf(p));
const TRACKED = RANK.slice()
  .sort((a, b) => b.rounds - a.rounds || swing(b.p) - swing(a.p))
  .slice(0, 4)
  .map((r) => r.p);
const TRACK_COLORS = [COLOR.sky, COLOR.gold, COLOR.teal, COLOR.pink];
const series = TRACKED.map((p) =>
  ROUNDS.map((r, i) => {
    const x = r.pollsters.find((q) => q.p === p);
    return x ? { i, v: x.abs } : null;
  }).filter((x): x is { i: number; v: number } => x !== null),
);
const trackMax = Math.ceil(Math.max(...series.flat().map((s) => s.v)));

const onlinePollsters = new Set(DATA.ranking.filter((r) => r.method === "online" && r.presRounds > 0).map((r) => r.p));

// Beats.
const BARS_FROM = 0.03;
const BAR_STEP = 0.02;
const CALLOUT = 0.27;
const TRACK = 0.38;
const METHODS = 0.64;

export function Institutos({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const f = (x: number) => at(duration, x);
  const rankOut = interpolate(frame, [f(TRACK) - 14, f(TRACK)], [1, 0], clamp);
  return (
    <Scene chapter="Quem erra mais, e como">
      <div style={{ position: "absolute", inset: 0, opacity: rankOut }}>
        <Ranking duration={duration} />
      </div>
      <Track duration={duration} />
      <Methods duration={duration} />
    </Scene>
  );
}

function Ranking({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const f = (x: number) => at(duration, x);
  const left = 640;
  const px = 230;
  const top = 230;
  const row = 58;
  return (
    <>
      <div style={{ position: "absolute", left: 72, top: 110 }}>
        <Title size={58}>Erro médio de cada instituto</Title>
        <div style={{ fontSize: 24, color: T.ink2, marginTop: 8 }}>
          Pontos, sem sinal. Só presidente, institutos com {minRounds} ou mais votações na base.
        </div>
      </div>
      {RANK.map((r, i) => {
        const grow = interpolate(frame, [f(BARS_FROM + i * BAR_STEP), f(BARS_FROM + i * BAR_STEP) + 16], [0, 1], {
          ...clamp,
          easing: easeOut,
        });
        const y = top + i * row;
        const color = i === 0 ? COLOR.teal : r === worst ? COLOR.orange : T.ink2;
        return (
          <div key={r.p} style={{ opacity: Math.min(1, grow * 3) }}>
            <div style={{ position: "absolute", left: 72, top: y + 4, fontSize: 28, fontWeight: 500 }}>{r.p}</div>
            <div style={{ position: "absolute", left: 400, top: y + 9, fontSize: 19, color: T.muted }}>
              {r.method ? METHOD[r.method] : "—"} · {r.rounds} votações
            </div>
            <div
              style={{
                position: "absolute",
                left,
                top: y + 8,
                height: 34,
                width: r.absError * px * grow,
                background: color,
                borderRadius: 4,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: left + r.absError * px * grow + 14,
                top: y + 2,
                fontFamily: DISPLAY,
                fontWeight: 700,
                fontSize: 34,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {num(r.absError, 2)}
            </div>
          </div>
        );
      })}
      <Reveal
        duration={duration}
        from={CALLOUT}
        style={{
          position: "absolute",
          left: 72,
          top: 905,
          padding: "16px 30px",
          background: T.surface,
          border: `1px solid ${T.rule}`,
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          gap: 28,
        }}
      >
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 88, lineHeight: 1, color: COLOR.teal }}>
          {num(best.abs, 2)}
        </div>
        <div style={{ fontSize: 28, lineHeight: 1.3 }}>
          ponto de erro médio: {best.p} no {best.round === "r1" ? "1º" : "2º"} turno de {best.year},
          <br />a pesquisa final mais perto da urna desde 2010.
        </div>
      </Reveal>
      {RANK.map((_, i) => (
        <Sfx key={i} name="tick" at={f(BARS_FROM + i * BAR_STEP)} volume={0.25} />
      ))}
      <Sfx name="pop" at={f(CALLOUT)} volume={0.45} />
    </>
  );
}

/** The same pollsters vote by vote: the error jumps around. */
function Track({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const f = (x: number) => at(duration, x);
  const show = interpolate(frame, [f(TRACK), f(TRACK) + 14, f(METHODS) - 14, f(METHODS)], [0, 1, 1, 0], clamp);
  const draw = interpolate(frame, [f(TRACK + 0.02), f(TRACK + 0.16)], [0, 1], { ...clamp, easing: easeInOut });
  const x0 = 360;
  const x1 = 1780;
  const y0 = 820;
  const y1 = 330;
  const X = (i: number) => x0 + ((x1 - x0) * i) / (ROUNDS.length - 1);
  const Y = (v: number) => y0 - ((y0 - y1) * v) / trackMax;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: show }}>
      <div style={{ position: "absolute", left: 72, top: 110 }}>
        <Title size={58}>O ranking muda de uma eleição para outra</Title>
        <div style={{ fontSize: 24, color: T.ink2, marginTop: 8 }}>
          Erro médio da última pesquisa de cada instituto, em pontos, votação a votação.
        </div>
        <div style={{ display: "flex", gap: 34, marginTop: 22 }}>
          {TRACKED.map((p, k) => (
            <span key={p} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 26, fontWeight: 600 }}>
              <i style={{ width: 18, height: 18, borderRadius: "50%", background: TRACK_COLORS[k] }} />
              {p}
            </span>
          ))}
        </div>
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {[0, Math.round(trackMax / 2), trackMax].map((v) => (
          <g key={v}>
            <line x1={x0} x2={x1} y1={Y(v)} y2={Y(v)} stroke={T.grid} strokeWidth={2} />
            <text x={x0 - 20} y={Y(v) + 8} fill={T.muted} fontSize={22} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {ROUNDS.map((r, i) => (
          <text key={i} x={X(i)} y={y0 + 44} fill={T.muted} fontSize={21} textAnchor="middle">
            {`${String(r.year).slice(2)}·${r.round === "r1" ? "1º" : "2º"}`}
          </text>
        ))}
        {series.map((pts, k) => {
          const shown = pts.filter((p) => p.i <= draw * (ROUNDS.length - 1) + 0.001);
          const d = shown.map((p, j) => `${j ? "L" : "M"}${X(p.i)},${Y(p.v)}`).join(" ");
          return (
            <g key={TRACKED[k]}>
              <path d={d} fill="none" stroke={TRACK_COLORS[k]} strokeWidth={5} strokeLinejoin="round" />
              {shown.map((p) => (
                <circle key={p.i} cx={X(p.i)} cy={Y(p.v)} r={8} fill={TRACK_COLORS[k]} />
              ))}
            </g>
          );
        })}
      </svg>
      <Reveal duration={duration} from={TRACK + 0.18} until={METHODS} style={{ position: "absolute", left: 72, bottom: 110 }}>
        <div style={{ fontSize: 34, fontWeight: 600 }}>O histórico importa mais do que o último acerto.</div>
      </Reveal>
      <Sfx name="swish" at={f(TRACK)} volume={0.4} />
      <Sfx name="riser" at={f(TRACK + 0.02)} volume={0.25} />
      <Sfx name="hit" at={f(TRACK + 0.18)} volume={0.35} />
    </div>
  );
}

/** Mean signed margin error by method of interview. */
function Methods({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const f = (x: number) => at(duration, x);
  const show = interpolate(frame, [f(METHODS), f(METHODS) + 14], [0, 1], clamp);
  const keys = ["in_person", "phone", "online"] as const;
  const max = Math.max(...keys.map((k) => Math.abs(DATA.byMethod[k]?.mean ?? 0)));
  const base = 760;
  const h = 380;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: show }}>
      <div style={{ position: "absolute", left: 72, top: 110 }}>
        <Title size={58}>E o jeito de entrevistar?</Title>
        <div style={{ fontSize: 24, color: T.ink2, marginTop: 8 }}>
          Erro na diferença entre o PT e o principal adversário, por método, em pontos (presidente).
        </div>
      </div>
      <div style={{ position: "absolute", left: 200, right: 200, top: base, height: 2, background: T.muted }} />
      {keys.map((k, i) => {
        const m = DATA.byMethod[k];
        if (!m || m.mean === null) return null;
        const grow = interpolate(frame, [f(METHODS + 0.04 + i * 0.05), f(METHODS + 0.04 + i * 0.05) + 20], [0, 1], {
          ...clamp,
          easing: easeOut,
        });
        const bh = (Math.abs(m.mean) / max) * h * grow;
        const thin = k === "online";
        const cx = 480 + i * 480;
        return (
          <div key={k} style={{ opacity: Math.min(1, grow * 3) }}>
            <div
              style={{
                position: "absolute",
                left: cx - 90,
                width: 180,
                top: m.mean >= 0 ? base - bh : base,
                height: bh,
                background: thin
                  ? `repeating-linear-gradient(45deg, ${COLOR.red} 0 10px, transparent 10px 20px)`
                  : COLOR.red,
                border: thin ? `3px solid ${COLOR.red}` : undefined,
                borderRadius: 5,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: cx - 150,
                width: 300,
                top: base - bh - 80,
                textAlign: "center",
                fontFamily: DISPLAY,
                fontWeight: 700,
                fontSize: 64,
              }}
            >
              {signed(m.mean)}
            </div>
            <div style={{ position: "absolute", left: cx - 200, width: 400, top: base + 18, textAlign: "center" }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 44 }}>{METHOD[k]}</div>
              <div style={{ fontSize: 20, color: T.muted }}>
                {m.n} pesquisas finais
                {thin ? ` · ${onlinePollsters.size === 1 ? "um único instituto" : `${onlinePollsters.size} institutos`}` : ""}
              </div>
            </div>
          </div>
        );
      })}
      <Reveal duration={duration} from={0.84} style={{ position: "absolute", left: 72, right: 72, top: 900 }}>
        <div style={{ fontSize: 40, fontWeight: 600 }}>Nenhum método escapa do lado.</div>
        <div style={{ fontSize: 20, color: T.muted, marginTop: 10 }}>
          Método é o que cada instituto costuma usar; algum pode ter mudado numa rodada. Só {DATA.counts.withMethod} dos{" "}
          {DATA.counts.pollsters} institutos têm método classificado.
        </div>
      </Reveal>
      <Sfx name="swish" at={f(METHODS)} volume={0.4} />
      {keys.map((_, i) => (
        <Sfx key={i} name="pop" at={f(METHODS + 0.04 + i * 0.05)} volume={0.35} />
      ))}
      <Sfx name="chime" at={f(0.84)} volume={0.35} />
    </div>
  );
}
