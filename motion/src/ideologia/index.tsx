import { Easing, interpolate, useCurrentFrame } from "remotion";
import ideologiaJson from "../../data/ideologia.json";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { DISPLAY, IDEO, T } from "../common/theme";

/** Shape of motion/data/ideologia.json, written by motion/scripts/ideologia.py. */
interface Member {
  name: string;
  party: string;
  uf: string;
  /** −1 the furthest left of the house by votes, +1 the furthest right. */
  score: number;
}
interface IdeologiaData {
  since: string;
  until: string;
  minVotes: number;
  chamber: { inOffice: number; r: number; members: Member[] };
  senate: { r: number; members: Member[] };
  /** Each party's label (Zucco & Power), as in the Congress tab. */
  labels: Record<string, { score: number; group: string }>;
}
const data = ideologiaJson as IdeologiaData;

type Props = Record<string, never>;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.inOut(Easing.cubic);
const OTHERS = "Outros";

// Timeline (frames at 30 fps).
const MOVE1 = [240, 330] as const; // label → votes
const MOVE2 = [1090, 1170] as const; // party rows → one strip
const SENATE = 1360; // the Chamber gives way to the Senate
const MOVE_SENATE = [1470, 1550] as const;
const CLOSE = 1700;
const DURATION = 1890;

const labelOf = (party: string) => data.labels[party] ?? null;
const groupOf = (party: string) => labelOf(party)?.group ?? "none";
const colorOf = (party: string) => IDEO[groupOf(party)]!;

/** −0,53 / +0,75, with a real minus sign. */
const num = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2).replace(".", ",")}`;
const dec = (v: number) => v.toFixed(2).replace(".", ",");
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length / 2;
  return s.length % 2 ? s[Math.floor(m)]! : (s[m - 1]! + s[m]!) / 2;
};
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (i - lo);
};
const sd = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
const month = (iso: string) =>
  `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}`;

interface Row {
  party: string;
  members: Member[];
  median: number;
}

/** Parties with at least `min` members, ordered by their label left to right; the rest in one row. */
function rowsOf(members: Member[], min: number): Row[] {
  const by = new Map<string, Member[]>();
  for (const m of members) by.set(m.party, [...(by.get(m.party) ?? []), m]);
  const rows: Row[] = [];
  const rest: Member[] = [];
  for (const [party, ms] of by) {
    if (ms.length >= min && labelOf(party)) rows.push({ party, members: ms, median: median(ms.map((m) => m.score)) });
    else rest.push(...ms);
  }
  rows.sort((a, b) => labelOf(a.party)!.score - labelOf(b.party)!.score);
  if (rest.length) rows.push({ party: OTHERS, members: rest, median: median(rest.map((m) => m.score)) });
  return rows;
}

const chamberRows = rowsOf(data.chamber.members, 3);
const senateRows = rowsOf(data.senate.members, 1);
const rowOf = (rows: Row[], party: string) => rows.find((r) => r.party === party)!;

// The numbers the captions cite, from the data.
const C = data.chamber.members;
const med = (party: string) => rowOf(chamberRows, party).median;
const smed = (party: string) => rowOf(senateRows, party).median;
const ptMax = Math.max(...C.filter((m) => m.party === "PT").map((m) => m.score));
const rightLabelled = C.filter((m) => groupOf(m.party) === "right");
const rightLeftOfPt = rightLabelled.filter((m) => m.score < ptMax).length;
const farRight = C.filter((m) => m.score > 0.4);
const spread = chamberRows
  .filter((r) => r.party !== OTHERS && r.members.length >= 10)
  .map((r) => ({ r, s: sd(r.members.map((m) => m.score)) }))
  .sort((a, b) => b.s - a.s)[0]!.r;
const spreadScores = spread.members.map((m) => m.score);

interface Cue {
  from: number;
  to: number;
  text: string;
  /** Parties lit while the cue is up (the rest dim); a function for the strip. */
  focus?: string[] | ((m: Member) => boolean);
  /** Shows the PT's furthest-right deputy as a line. */
  ptLine?: boolean;
  /** How far the rest fade (default 0.82). */
  dim?: number;
}

const CUES: Cue[] = [
  {
    from: 45,
    to: 235,
    text: `Primeiro, pelo rótulo: cada partido onde os próprios parlamentares o põem, numa pesquisa (Zucco e Power). A cor é esse rótulo.`,
  },
  {
    from: 345,
    to: 495,
    text: `Agora, pelos votos: cada um dos ${C.length} deputados vai para a sua posição nas votações disputadas desde ${month(data.since)}.`,
  },
  {
    from: 505,
    to: 655,
    focus: ["PT", "PV", "PSOL"],
    text: `O PV, rotulado de centro, vota como o PT (${num(med("PV"))} e ${num(med("PT"))}): estão na mesma federação. O PSOL, rótulo mais à esquerda, fica à direita dos dois (${num(med("PSOL"))}).`,
  },
  {
    from: 665,
    to: 825,
    focus: ["UNIÃO", "PP", "Republicanos", "MDB", "PSD"],
    text: `União, PP e Republicanos têm rótulo de direita, mas votam no miolo da Câmara (${num(med("UNIÃO"))}, ${num(med("PP"))} e ${num(med("Republicanos"))}), junto de MDB (${num(med("MDB"))}) e PSD (${num(med("PSD"))}).`,
  },
  {
    from: 835,
    to: 965,
    focus: ["PL", "NOVO"],
    text: `A direita pelos votos é quase só PL e NOVO (${num(med("PL"))} e ${num(med("NOVO"))}). Dos ${farRight.length} deputados acima de +0,40, ${farRight.filter((m) => m.party === "PL").length} são do PL.`,
  },
  {
    from: 975,
    to: 1085,
    focus: [spread.party],
    text: `O partido mais espalhado é o ${spread.party}: de ${num(Math.min(...spreadScores))} a ${num(Math.max(...spreadScores))}, metade dele entre ${num(quantile(spreadScores, 0.25))} e ${num(quantile(spreadScores, 0.75))}.`,
  },
  {
    from: 1180,
    to: 1350,
    focus: (m) => groupOf(m.party) === "right" && m.score < ptMax,
    ptLine: true,
    dim: 0.6,
    text: `Todos juntos, os rótulos se misturam: ${rightLeftOfPt} dos ${rightLabelled.length} deputados de partidos rotulados de direita votam mais à esquerda que o deputado do PT mais à direita (${num(ptMax)}).`,
  },
  {
    from: SENATE + 20,
    to: SENATE + 105,
    text: `No Senado, primeiro pelo rótulo: ${data.senate.members.length} senadores com ${data.minVotes} votos ou mais no mandato.`,
  },
  {
    from: MOVE_SENATE[1] + 10,
    to: CLOSE - 10,
    focus: ["PT", "PL", "MDB", "PSD"],
    text: `Pelos votos, o mesmo desenho: PT numa ponta (${num(smed("PT"))}), PL na outra (${num(smed("PL"))}). MDB (${num(smed("MDB"))}) e PSD (${num(smed("PSD"))}) votam bem mais perto do PT.`,
  },
];

/** 0 → 1 → 0 around a cue. */
const cueIn = (c: Cue, frame: number) =>
  interpolate(frame, [c.from, c.from + 14, c.to - 12, c.to], [0, 1, 1, 0], clamp);

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** One house: party rows by label, then by votes, then (optionally) one strip of all. */
function Swarm({
  rows,
  box,
  labelW,
  pitch,
  maxLanes,
  move,
  strip,
  frame,
  start = 0,
  opacity,
}: {
  rows: Row[];
  box: Box;
  labelW: number;
  pitch: number;
  maxLanes: number;
  move: readonly [number, number];
  strip?: readonly [number, number];
  frame: number;
  /** When the dots pop in. */
  start?: number;
  opacity: number;
}) {
  const { u } = useLayout();
  const x0 = box.left + labelW;
  const x1 = box.right;
  const x = (v: number) => x0 + ((v + 1) / 2) * (x1 - x0);
  const rowH = (box.bottom - box.top) / rows.length;
  const lanes = Math.max(1, Math.min(maxLanes, Math.floor((rowH * 0.8) / pitch)));
  const rowY = (k: number) => box.top + (k + 0.5) * rowH;
  const laneY = (j: number) => (j - (lanes - 1) / 2) * pitch;

  const p1 = interpolate(frame, move, [0, 1], clamp);
  const p2 = strip ? interpolate(frame, strip, [0, 1], clamp) : 0;

  // The strip: all members binned by position, stacked by label from left to right.
  const bins = new Map<number, number>();
  const stackOf = new Map<Member, [number, number]>();
  const order = Object.keys(IDEO);
  const all = rows.flatMap((r) => r.members);
  // The strip has room for bigger dots.
  const sp = pitch * 1.4;
  for (const m of [...all].sort((a, b) => order.indexOf(groupOf(a.party)) - order.indexOf(groupOf(b.party)))) {
    const b = Math.round((x(m.score) - x0) / sp);
    const h = bins.get(b) ?? 0;
    bins.set(b, h + 1);
    stackOf.set(m, [b, h]);
  }
  const tallest = Math.max(...bins.values());
  const base = (box.top + box.bottom) / 2 + (tallest * sp) / 2;

  // Focus: the cue that is up lights some parties and dims the rest.
  const cue = CUES.find((c) => c.focus && frame >= c.from && frame <= c.to);
  const w = cue ? cueIn(cue, frame) : 0;
  const lit = (m: Member) =>
    !cue?.focus ? true : typeof cue.focus === "function" ? cue.focus(m) : cue.focus.includes(m.party);
  const rowLit = (r: Row) => !cue?.focus || typeof cue.focus === "function" || cue.focus.includes(r.party);

  const dots: { x: number; y: number; c: string; a: number; s: number }[] = [];
  rows.forEach((r, k) => {
    // By label: a block for each party (or sub-party, in the last row) at its label.
    const parties = [...new Set(r.members.map((m) => m.party))];
    const grouped = new Map<Member, [number, number]>();
    for (const party of parties) {
      const ms = r.members.filter((m) => m.party === party).sort((a, b) => a.score - b.score);
      const cols = Math.ceil(ms.length / lanes);
      const cx = x(labelOf(party)?.score ?? 0);
      ms.forEach((m, j) => {
        grouped.set(m, [cx + (Math.floor(j / lanes) - (cols - 1) / 2) * pitch, rowY(k) + laneY(j % lanes)]);
      });
    }
    const sorted = [...r.members].sort((a, b) => a.score - b.score);
    sorted.forEach((m, j) => {
      const [gx, gy] = grouped.get(m)!;
      const vx = x(m.score);
      const vy = rowY(k) + laneY(j % lanes);
      // Rows leave one after another, top first.
      const d = (k / rows.length) * 0.35;
      const q = ease(interpolate(p1, [d, d + 0.65], [0, 1], clamp));
      let px = gx + (vx - gx) * q;
      let py = gy + (vy - gy) * q;
      if (p2 > 0) {
        const [b, h] = stackOf.get(m)!;
        const d2 = ((m.score + 1) / 2) * 0.3;
        const q2 = ease(interpolate(p2, [d2, d2 + 0.7], [0, 1], clamp));
        px += (x0 + b * sp - px) * q2;
        py += (base - h * sp - py) * q2;
      }
      const size = 1 + (sp / pitch - 1) * (p2 > 0 ? ease(p2) : 0);
      // Pop in by row at the start.
      const pop = interpolate(frame - start, [12 + k * 2, 26 + k * 2], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
      dots.push({ x: px, y: py, c: colorOf(m.party), a: 1 - w * (lit(m) ? 0 : (cue?.dim ?? 0.82)), s: pop * size });
    });
  });

  const rowsOut = 1 - p2;
  const ptLine = cue?.ptLine ? w : 0;
  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        {/* Centre line and row rules. */}
        <line x1={x(0)} x2={x(0)} y1={box.top} y2={box.bottom} stroke={T.rule} strokeWidth={1.5 * u} />
        {rows.map((r, k) => (
          <line
            key={r.party}
            x1={x(-1)}
            x2={x(1)}
            y1={rowY(k)}
            y2={rowY(k)}
            stroke={T.grid}
            strokeWidth={1 * u}
            opacity={rowsOut}
          />
        ))}
        {dots.map((d, k) => (
          <circle key={k} cx={d.x} cy={d.y} r={Math.max(0, pitch * 0.42 * d.s)} fill={d.c} opacity={d.a} />
        ))}
        {/* Each party's median, once placed by votes. */}
        {rows.map((r, k) =>
          r.party === OTHERS ? null : (
            <line
              key={r.party}
              x1={x(r.median)}
              x2={x(r.median)}
              y1={rowY(k) - (lanes * pitch) / 2 - 4 * u}
              y2={rowY(k) + (lanes * pitch) / 2 + 4 * u}
              stroke={T.ink}
              strokeWidth={3 * u}
              strokeLinecap="round"
              opacity={interpolate(p1, [0.8, 1], [0, 1], clamp) * rowsOut * (rowLit(r) ? 1 : 1 - w * 0.8)}
            />
          ),
        )}
        {ptLine > 0 ? (
          <line
            x1={x(ptMax)}
            x2={x(ptMax)}
            y1={box.top}
            y2={base + sp}
            stroke={T.ink}
            strokeWidth={2 * u}
            strokeDasharray={`${6 * u} ${6 * u}`}
            opacity={ptLine}
          />
        ) : null}
      </svg>
      {ptLine > 0 ? (
        <div
          style={{
            position: "absolute",
            left: x(ptMax) - 300 * u,
            width: 290 * u,
            top: box.top,
            textAlign: "right",
            fontSize: 20 * u,
            color: T.ink2,
            opacity: ptLine,
            lineHeight: 1.3,
          }}
        >
          deputado do PT mais à direita ({num(ptMax)})
        </div>
      ) : null}
      {/* Party labels, colored by the label's group. */}
      {rows.map((r, k) => (
        <div
          key={r.party}
          style={{
            position: "absolute",
            left: box.left,
            width: labelW - 14 * u,
            top: rowY(k) - 15 * u,
            height: 30 * u,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8 * u,
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: Math.min(26, rowH * 0.62 / u) * u,
            whiteSpace: "nowrap",
            opacity: rowsOut * (rowLit(r) ? 1 : 1 - w * 0.75) * interpolate(frame - start, [10 + k * 2, 24 + k * 2], [0, 1], clamp),
          }}
        >
          <span style={{ color: r.party === OTHERS ? T.muted : colorOf(r.party) }}>
            {r.party === OTHERS ? "outros" : r.party}
          </span>
          <span style={{ color: T.muted, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{r.members.length}</span>
        </div>
      ))}
      {/* Axis ends. */}
      <div
        style={{
          position: "absolute",
          left: x0,
          width: x1 - x0,
          top: box.bottom + 10 * u,
          display: "flex",
          justifyContent: "space-between",
          fontSize: 20 * u,
          color: T.muted,
        }}
      >
        <span>← −1 esquerda</span>
        <span>0</span>
        <span>direita +1 →</span>
      </div>
    </div>
  );
}

const GROUP_NAME: Record<string, string> = {
  left: "esquerda",
  "centre-left": "centro-esquerda",
  centre: "centro",
  "centre-right": "centro-direita",
  right: "direita",
};

function Ideologia(_: Props) {
  const frame = useCurrentFrame();
  const { width, height, portrait, u, pad } = useLayout();

  const box: Box = portrait
    ? { left: pad, right: width - pad, top: 420 * u, bottom: 1330 * u }
    : { left: pad, right: 1290 * u, top: 345 * u, bottom: 945 * u };
  const labelW = (portrait ? 190 : 200) * u;
  const captionBox = portrait
    ? { left: pad, right: pad, top: 1440 * u }
    : { left: 1360 * u, right: pad, top: 430 * u };

  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const chamberOut = interpolate(frame, [SENATE - 10, SENATE + 10], [1, 0], clamp);
  const senateIn = interpolate(frame, [SENATE + 5, SENATE + 25], [0, 1], clamp);
  const closeIn = interpolate(frame, [CLOSE, CLOSE + 20], [0, 1], clamp);
  const isSenate = frame >= SENATE;

  // Which reading the dots show, above the chart.
  const byVotes = isSenate ? frame >= (MOVE_SENATE[0] + MOVE_SENATE[1]) / 2 : frame >= (MOVE1[0] + MOVE1[1]) / 2;
  const stripOn = !isSenate && frame >= MOVE2[0];
  const tag = `${isSenate ? "Senado" : "Câmara"} · ${byVotes ? (stripOn ? "todos pelos votos" : "pelos votos") : "pelo rótulo do partido"}`;
  const tagFlip = isSenate
    ? Math.min(
        interpolate(frame, [SENATE, SENATE + 15], [0, 1], clamp),
        Math.abs(interpolate(frame, MOVE_SENATE, [-1, 1], clamp)),
      )
    : Math.min(
        Math.abs(interpolate(frame, MOVE1, [-1, 1], clamp)),
        frame < MOVE2[0] + 30 ? Math.abs(interpolate(frame, [MOVE2[0] - 10, MOVE2[0] + 30], [-1, 1], clamp)) : 1,
        1 - interpolate(frame, [SENATE - 10, SENATE], [0, 1], clamp),
      );

  const cue = CUES.find((c) => frame >= c.from && frame <= c.to);
  const chartFade = 1 - closeIn * 0.95;

  return (
    <Stage>
      <Header
        title="Onde cada deputado senta, pelos votos"
        subtitle="Cada ponto é um parlamentar em exercício. A cor é o rótulo do partido; a posição, a linha que mais separa os votos neste mandato."
        opacity={headerIn}
      />
      <div
        style={{
          position: "absolute",
          left: box.left + labelW,
          top: box.top - 64 * u,
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 38 * u,
          letterSpacing: 1 * u,
          color: T.ink,
          opacity: headerIn * tagFlip * chartFade,
        }}
      >
        {tag}
      </div>
      <div style={{ opacity: chartFade }}>
        {frame < SENATE + 15 ? (
          <Swarm
            rows={chamberRows}
            box={box}
            labelW={labelW}
            pitch={(portrait ? 9.4 : 8) * u}
            maxLanes={4}
            move={MOVE1}
            strip={MOVE2}
            frame={frame}
            opacity={chamberOut}
          />
        ) : null}
        {frame >= SENATE ? (
          <Swarm
            rows={senateRows}
            box={box}
            labelW={labelW}
            pitch={(portrait ? 17 : 14) * u}
            maxLanes={3}
            move={MOVE_SENATE}
            frame={frame}
            start={SENATE}
            opacity={senateIn}
          />
        ) : null}
      </div>

      {/* Legend: the label's groups. */}
      <div
        style={{
          position: "absolute",
          left: portrait ? pad : captionBox.left,
          right: pad,
          top: portrait ? 1385 * u : 345 * u,
          display: "flex",
          flexWrap: "wrap",
          gap: `${6 * u}px ${18 * u}px`,
          fontSize: 19 * u,
          color: T.muted,
          opacity: headerIn * chartFade,
        }}
      >
        <span>Rótulo:</span>
        {Object.entries(GROUP_NAME).map(([g, name]) => (
          <span key={g} style={{ display: "flex", alignItems: "center", gap: 6 * u }}>
            <i style={{ width: 12 * u, height: 12 * u, borderRadius: "50%", background: IDEO[g] }} />
            {name}
          </span>
        ))}
      </div>

      {/* Captions. */}
      {cue ? (
        <div
          style={{
            position: "absolute",
            ...captionBox,
            fontSize: (portrait ? 34 : 32) * u,
            lineHeight: 1.4,
            color: T.ink,
            opacity: cueIn(cue, frame),
            transform: `translateY(${(1 - cueIn(cue, frame)) * 14 * u}px)`,
          }}
        >
          {cue.text}
        </div>
      ) : null}
      {/* The method, in one sentence, while the strip is up. */}
      <div
        style={{
          position: "absolute",
          ...captionBox,
          top: portrait ? 1690 * u : 760 * u,
          fontSize: 22 * u,
          lineHeight: 1.45,
          color: T.ink2,
          opacity: interpolate(frame, [345, 365, SENATE - 15, SENATE], [0, 1, 1, 0], clamp),
        }}
      >
        Método: a primeira componente principal das votações disputadas (10% ou mais do lado perdedor). Mede quem
        vota junto com quem, não ideologia em si.
      </div>

      {/* Closing card. */}
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: portrait ? 640 * u : 330 * u,
          opacity: closeIn,
          transform: `translateY(${(1 - closeIn) * 30 * u}px)`,
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: (portrait ? 80 : 88) * u,
            lineHeight: 1.05,
            maxWidth: 1500 * u,
          }}
        >
          O rótulo diz como o partido é visto. O voto, com quem ele anda.
        </div>
        <div style={{ fontSize: 30 * u, color: T.ink2, marginTop: 34 * u, maxWidth: 1300 * u, lineHeight: 1.45 }}>
          Neste mandato, a linha que mais separa os votos mistura esquerda e direita com governo e oposição. Ainda
          assim, a média de cada partido acompanha a nota de Zucco e Power: correlação de {dec(data.chamber.r)} na
          Câmara e {dec(data.senate.r)} no Senado.
        </div>
        <div style={{ fontSize: 22 * u, color: T.muted, marginTop: 28 * u, maxWidth: 1300 * u, lineHeight: 1.45 }}>
          Câmara: {C.length} dos {data.chamber.inOffice} deputados em exercício; os outros têm menos de{" "}
          {data.minVotes} votos disputados no mandato.
        </div>
      </div>
      <Footer
        source={`Votações nominais do plenário, Câmara e Senado, ${month(data.since)} a ${month(data.until)} · rótulos: Zucco e Power`}
        opacity={headerIn}
      />
    </Stage>
  );
}

export const def = motion<Props>({
  id: "Ideologia",
  title: "Onde cada deputado senta, pelos votos",
  description: "Os deputados saem do rótulo do partido e vão para onde os votos os põem; depois, o Senado.",
  component: Ideologia,
  defaultProps: {},
  durationInFrames: () => DURATION,
  formats: ["portrait", "landscape"],
});
