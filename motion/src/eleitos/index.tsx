import { Easing, interpolate, useCurrentFrame } from "remotion";
import eleitosJson from "../../data/eleitos.json";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { COLOR, DISPLAY, T, css, int, mixRgb, pct, rgb } from "../common/theme";

/** Shape of motion/data/eleitos.json, written by motion/scripts/eleitos.py. */
interface Deputy {
  party: string;
  uf: string;
  path: "reeleito" | "volta" | "outro-cargo" | "estreante";
  female: boolean;
  age: number;
  education: string;
  occupation: string;
  race: "branca" | "parda" | "preta" | "indigena" | "amarela" | null;
}
interface EleitosData {
  deputies: Deputy[];
  senate: { elected: number; reelected: number; women: number };
}
const data = eleitosJson as EleitosData;
const deps = data.deputies;
const N = deps.length;

type Props = Record<string, never>;

const INTRO = 40;
const HOLD = 150;
const MOVE = 40;
const OUTRO = 170;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.inOut(Easing.cubic);

interface Group {
  label: string;
  color: string;
  test: (d: Deputy) => boolean;
  /** Counts in the big number: drawn in full color, the rest dimmed. */
  hi?: boolean;
}
interface Cut {
  /** Kicker over the big number. */
  topic: string;
  groups: Group[];
  big: (n: number) => string;
  line: (n: number) => string;
  note?: string;
}

const count = (f: (d: Deputy) => boolean) => deps.filter(f).length;
const share = (n: number) => pct((n / N) * 100);
const ages = deps.map((d) => d.age).sort((a, b) => a - b);
const median = ages.length % 2 ? ages[(ages.length - 1) / 2]! : (ages[ages.length / 2 - 1]! + ages[ages.length / 2]!) / 2;

/** The top occupations as the TSE writes them; the rest together. */
const OCCUPATIONS = ["Deputado", "Empresário", "Advogado", "Médico", "Vereador"];
/** The site's party lines and colors (data/generated/map.json lineages); PODE in brown, the rest in gray. */
const PARTIES: [string, string][] = [
  ["PL", COLOR.blue],
  ["PT", COLOR.red],
  ["UNIÃO", COLOR.cyan],
  ["PSD", COLOR.orange],
  ["PP", COLOR.violet],
  ["REPUBLICANOS", COLOR.teal],
  ["MDB", COLOR.green],
  ["PODE", COLOR.brown],
];
const PARTY_NAME: Record<string, string> = { UNIÃO: "União", REPUBLICANOS: "Republicanos", PODE: "Podemos" };
const named = new Set(PARTIES.map(([p]) => p));
const blackBrown = count((d) => d.race === "preta" || d.race === "parda");
const youngest = ages[0]!;
const oldest = ages[ages.length - 1]!;
const second = PARTIES[1]!;

const CUTS: Cut[] = [
  {
    topic: "A nova Câmara",
    groups: [{ label: "Deputados federais", color: T.ink2, test: () => true, hi: true }],
    big: () => int(N),
    line: () => "deputados federais eleitos em 4 de outubro, que tomam posse em fevereiro de 2027",
  },
  {
    topic: "De onde vieram",
    groups: [
      { label: "Reeleitos", color: COLOR.teal, test: (d) => d.path === "reeleito", hi: true },
      { label: "Voltam à Câmara", color: COLOR.sky, test: (d) => d.path === "volta" },
      { label: "Outro cargo eletivo", color: COLOR.gold, test: (d) => d.path === "outro-cargo" },
      { label: "Nunca eleitos antes", color: COLOR.pink, test: (d) => d.path === "estreante" },
    ],
    big: (n) => int(n),
    line: (n) => `foram reeleitos: ${share(n)} da Câmara`,
    note: `${count((d) => d.path === "estreante")} nunca tinham vencido uma eleição; ${count((d) => d.path === "outro-cargo")} já tinham sido eleitos para outro cargo, como vereador, prefeito ou deputado estadual.`,
  },
  {
    topic: "Gênero",
    groups: [
      { label: "Mulheres", color: COLOR.violet, test: (d) => d.female, hi: true },
      { label: "Homens", color: COLOR.gray, test: (d) => !d.female },
    ],
    big: (n) => int(n),
    line: (n) => `mulheres: ${share(n)} das cadeiras`,
    note: "No Brasil, as mulheres são 51,5% da população (Censo 2022).",
  },
  {
    topic: "Cor ou raça declarada",
    groups: [
      { label: "Branca", color: COLOR.gray, test: (d) => d.race === "branca" },
      { label: "Parda", color: COLOR.orange, test: (d) => d.race === "parda", hi: true },
      { label: "Preta", color: COLOR.brown, test: (d) => d.race === "preta", hi: true },
      { label: "Indígena", color: COLOR.green, test: (d) => d.race === "indigena" },
      { label: "Amarela", color: COLOR.gold, test: (d) => d.race === "amarela" },
    ],
    big: (n) => int(n),
    line: (n) => `pretos e pardos: ${share(n)} da Câmara`,
    note: `No Brasil, pretos e pardos são 55,5% (Censo 2022). Brancos na Câmara: ${share(count((d) => d.race === "branca"))}.`,
  },
  {
    topic: "Idade na posse",
    groups: [
      { label: "Até 34 anos", color: COLOR.cyan, test: (d) => d.age < 35 },
      { label: "35 a 44", color: COLOR.sky, test: (d) => d.age >= 35 && d.age < 45 },
      { label: "45 a 54", color: COLOR.blue, test: (d) => d.age >= 45 && d.age < 55, hi: true },
      { label: "55 a 64", color: COLOR.violet, test: (d) => d.age >= 55 && d.age < 65 },
      { label: "65 ou mais", color: COLOR.pink, test: (d) => d.age >= 65 },
    ],
    big: () => `${median} anos`,
    line: () => "é a idade mediana: metade tem mais, metade tem menos",
    note: `O mais novo terá ${youngest} anos na posse; o mais velho, ${oldest}.`,
  },
  {
    topic: "Escolaridade",
    groups: [
      { label: "Superior completo", color: COLOR.teal, test: (d) => d.education === "Superior completo", hi: true },
      { label: "Superior incompleto", color: COLOR.sky, test: (d) => d.education === "Superior incompleto" },
      { label: "Ensino médio", color: COLOR.gold, test: (d) => d.education.startsWith("Ensino médio") },
      { label: "Ensino fundamental", color: COLOR.orange, test: (d) => d.education.startsWith("Ensino fundamental") },
    ],
    big: (n) => int(n),
    line: (n) => `têm diploma de curso superior: ${share(n)}`,
    note: "No Brasil, 18,4% das pessoas com 25 anos ou mais têm (Censo 2022).",
  },
  {
    topic: "Ocupação declarada ao TSE",
    groups: [
      ...OCCUPATIONS.map((o, i) => ({
        label: o,
        color: [COLOR.gold, COLOR.sky, COLOR.violet, COLOR.teal, COLOR.orange][i]!,
        test: (d: Deputy) => d.occupation === o,
        hi: i === 0,
      })),
      { label: "Outras", color: COLOR.gray, test: (d) => !OCCUPATIONS.includes(d.occupation) },
    ],
    big: (n) => int(n),
    line: (n) => `escreveram “deputado” como profissão: ${share(n)}`,
    note: `Depois vêm empresário (${count((d) => d.occupation === "Empresário")}), advogado (${count((d) => d.occupation === "Advogado")}) e médico (${count((d) => d.occupation === "Médico")}).`,
  },
  {
    topic: "Partido",
    groups: [
      ...PARTIES.map(([p, c], i) => ({
        label: PARTY_NAME[p] ?? p,
        color: c,
        test: (d: Deputy) => d.party === p,
        hi: i === 0,
      })),
      { label: "Outros 12 partidos", color: COLOR.gray, test: (d) => !named.has(d.party) },
    ],
    big: (n) => int(n),
    line: (n) => `do PL, a maior bancada: ${share(n)}`,
    note: `O ${second[0]} vem em seguida, com ${count((d) => d.party === second[0])}.`,
  },
];

/** Index of each deputy's group, per cut, and the order they sit in (group, then the previous cut's place). */
const STAGES = (() => {
  let prev: number[] = deps.map((_, i) => i);
  return CUTS.map((cut) => {
    const group = deps.map((d) => cut.groups.findIndex((g) => g.test(d)));
    const order = deps.map((_, i) => i).sort((a, b) => group[a]! - group[b]! || prev[a]! - prev[b]!);
    const place = new Array<number>(N);
    order.forEach((i, k) => (place[i] = k));
    const sizes = cut.groups.map((_, gi) => group.filter((g) => g === gi).length);
    const hi = cut.groups.reduce((s, g, gi) => s + (g.hi ? sizes[gi]! : 0), 0);
    prev = place;
    return { cut, group, place, order, sizes, hi };
  });
})();
const missing = STAGES.flatMap((s) => s.group).filter((g) => g < 0).length;
if (missing) throw new Error(`eleitos: ${missing} deputados sem grupo`);

/** Blocks: each group wraps in rows of K squares of side s; a block is at least a label high. */
interface Block {
  y: number;
  rows: number;
}
function blocks(sizes: number[], K: number, s: number, minH: number, gap: number) {
  let y = 0;
  const out: Block[] = [];
  for (const n of sizes) {
    const rows = Math.max(1, Math.ceil(n / K));
    out.push({ y, rows });
    y += Math.max(rows * s, minH) + gap;
  }
  return { blocks: out, height: y - gap };
}

const duration = () => INTRO + CUTS.length * HOLD + (CUTS.length - 1) * MOVE + OUTRO;

function Eleitos(_: Props) {
  const frame = useCurrentFrame();
  const { width, height, portrait, u, pad } = useLayout();

  const box = portrait
    ? { left: pad, top: 700 * u, width: width - 2 * pad, height: 1060 * u }
    : { left: 760 * u, top: 300 * u, width: width - pad - 760 * u, height: 690 * u };
  const labelW = (portrait ? 300 : 330) * u;
  const minH = 34 * u;
  const gap = 14 * u;
  const areaW = box.width - labelW;

  // One square size for every cut: the largest that fits all of them.
  let s = 60 * u;
  for (; s > 6 * u; s -= 0.5 * u) {
    const K = Math.floor(areaW / s);
    if (STAGES.every((st) => blocks(st.sizes, K, s, minH, gap).height <= box.height)) break;
  }
  const K = Math.floor(areaW / s);
  const layouts = STAGES.map((st) => blocks(st.sizes, K, s, minH, gap).blocks);
  const starts = STAGES.map((st) => st.sizes.map((_, gi) => st.sizes.slice(0, gi).reduce((a, b) => a + b, 0)));

  const pos = (k: number, i: number) => {
    const st = STAGES[k]!;
    const g = st.group[i]!;
    const j = st.place[i]! - starts[k]![g]!;
    const b = layouts[k]![g]!;
    return [box.left + labelW + (j % K) * s, box.top + b.y + Math.floor(j / K) * s] as const;
  };
  const colorOf = (k: number, i: number) => {
    const g = STAGES[k]!.cut.groups[STAGES[k]!.group[i]!]!;
    return g.hi ? rgb(g.color) : mixRgb(rgb(g.color), rgb(T.bg), 0.45);
  };

  // Where we are: holding cut i, or moving from i to i + 1 with progress p.
  const n = CUTS.length;
  const t = frame - INTRO;
  const step = HOLD + MOVE;
  let i = Math.max(0, Math.min(n - 1, Math.floor(t / step)));
  let p = 0;
  if (t >= 0 && i < n - 1) p = interpolate(t - i * step, [HOLD, step], [0, 1], clamp);
  if (t < 0) i = 0;
  const j = Math.min(i + 1, n - 1);
  const outroAt = INTRO + n * HOLD + (n - 1) * MOVE;

  const side = s * 0.84;
  const squares = deps.map((_, d) => {
    const [x0, y0] = pos(i, d);
    let x = x0;
    let y = y0;
    let c = colorOf(i, d);
    let scale = 1;
    if (frame < INTRO + 10) {
      const delay = (STAGES[0]!.place[d]! / N) * 30;
      scale = interpolate(frame, [delay, delay + 12], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
    }
    if (p > 0) {
      // A sweep in the order of the new places: the first ones leave a little earlier.
      const delay = (STAGES[j]!.place[d]! / N) * 0.3;
      const q = ease(interpolate(p, [delay, delay + 0.7], [0, 1], clamp));
      const [x1, y1] = pos(j, d);
      x = x0 + (x1 - x0) * q;
      y = y0 + (y1 - y0) * q;
      c = mixRgb(c, colorOf(j, d), q);
    }
    return { x, y, c: css(c), scale };
  });

  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const outro = interpolate(frame, [outroAt + 10, outroAt + 30], [0, 1], clamp);
  // Text of cut i fades out in the first part of the move; cut i + 1 comes in at the end.
  const outA = p > 0 ? interpolate(p, [0, 0.35], [1, 0], clamp) : 1;
  const inB = p > 0 ? interpolate(p, [0.6, 1], [0, 1], clamp) : 0;
  const textIn = interpolate(frame, [INTRO - 20, INTRO], [0, 1], clamp);

  const labels = (k: number, opacity: number) => {
    const st = STAGES[k]!;
    return st.cut.groups.map((g, gi) => (
      <div
        key={`${k}-${gi}`}
        style={{
          position: "absolute",
          left: box.left,
          width: labelW - 16 * u,
          top: box.top + layouts[k]![gi]!.y,
          height: minH,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10 * u,
          opacity,
        }}
      >
        <span
          style={{
            fontSize: 21 * u,
            color: g.hi ? T.ink : T.ink2,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {g.label}
        </span>
        <span
          style={{
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: 30 * u,
            color: g.hi ? g.color : T.ink2,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {int(st.sizes[gi]!)}
        </span>
      </div>
    ));
  };

  const numbers = (k: number, opacity: number, dy: number) => {
    const st = STAGES[k]!;
    return (
      <div
        style={{
          position: "absolute",
          left: pad,
          top: (portrait ? 360 * u : 300 * u) + dy,
          width: portrait ? width - 2 * pad : 760 * u - pad - 60 * u,
          opacity,
        }}
      >
        <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 28 * u, letterSpacing: 2 * u, color: T.muted }}>
          {st.cut.topic.toUpperCase()}
        </div>
        <div
          style={{
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: (portrait ? 150 : 170) * u,
            lineHeight: 0.95,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {st.cut.big(st.hi)}
        </div>
        <div style={{ fontSize: 30 * u, lineHeight: 1.3, color: T.ink, marginTop: 6 * u }}>{st.cut.line(st.hi)}</div>
        {st.cut.note ? (
          <div style={{ fontSize: 23 * u, lineHeight: 1.4, color: T.ink2, marginTop: 14 * u }}>{st.cut.note}</div>
        ) : null}
      </div>
    );
  };

  const fade = 1 - outro * 0.7;
  const sen = data.senate;
  const women = count((d) => d.female);
  const reel = STAGES[1]!.hi;

  return (
    <Stage>
      <Header
        title="Quem o Brasil elegeu em 2026"
        subtitle="A Câmara dos Deputados eleita: cada quadrado é um dos 513 deputados federais"
        opacity={headerIn}
      />
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, opacity: fade }}>
        {squares.map((q, k) => {
          const w = side * q.scale;
          return (
            <rect
              key={k}
              x={q.x + (side - w) / 2}
              y={q.y + (side - w) / 2}
              width={Math.max(0, w)}
              height={Math.max(0, w)}
              rx={side * 0.18}
              fill={q.c}
            />
          );
        })}
      </svg>
      <div style={{ opacity: textIn * fade }}>
        {labels(i, outA)}
        {p > 0 ? labels(j, inB) : null}
      </div>
      <div style={{ opacity: textIn * (1 - outro) }}>
        {numbers(i, outA, -(1 - outA) * 20 * u)}
        {p > 0 ? numbers(j, inB, (1 - inB) * 20 * u) : null}
      </div>

      {/* Closing: the Chamber in one line, and the Senate. */}
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: portrait ? 360 * u : 300 * u,
          opacity: outro,
          maxWidth: portrait ? undefined : 760 * u - pad - 60 * u,
        }}
      >
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: (portrait ? 58 : 60) * u, lineHeight: 1.05 }}>
          Uma Câmara mais branca, mais masculina e mais escolarizada que o país
        </div>
        <div style={{ fontSize: (portrait ? 28 : 30) * u, lineHeight: 1.45, color: T.ink2, marginTop: 22 * u }}>
          {int(reel)} reeleitos, {int(women)} mulheres ({share(women)}), {int(blackBrown)} pretos e pardos (
          {share(blackBrown)}).
          <br />
          No Senado, {int(sen.elected)} eleitos: {int(sen.reelected)} reeleitos e {int(sen.women)} mulheres.
        </div>
      </div>
      <Footer source="TSE, candidaturas de 2026 · trajetória: eleições desde 2010" opacity={headerIn} />
    </Stage>
  );
}

export const def = motion<Props>({
  id: "Eleitos",
  title: "Quem o Brasil elegeu em 2026",
  description: "Os 513 deputados federais, um quadrado cada, reagrupados por trajetória, gênero, cor, idade, escolaridade, ocupação e partido.",
  component: Eleitos,
  defaultProps: {},
  durationInFrames: duration,
  formats: ["portrait", "landscape"],
});
