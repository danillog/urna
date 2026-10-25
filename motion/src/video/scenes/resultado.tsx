/**
 * Block 4, "O resultado, eleição por eleição" (the heart of the video, version A of the
 * script: the data show a side). Part 1, the president: the error in the PT × main rival
 * margin, one row per vote, then the 1st rounds alone, where the rival was always
 * underestimated. Part 2, the states (2026, 1st round): the mean error by the candidate's side.
 */
import { interpolate, useCurrentFrame } from "remotion";
import { COLOR, DISPLAY, IDEO, T } from "../../common/theme";
import { DATA } from "../data";
import { Reveal, Scene, Title, at, clamp, easeInOut, easeOut, signed, type SceneProps } from "../kit";
import { Sfx } from "../sound";

const ROUNDS = DATA.president.filter((r) => r.marginError !== null);
const FIRST = ROUNDS.filter((r) => r.round === "r1");
const favoured = ROUNDS.filter((r) => r.marginError! > 0).length;
const rivalMean = FIRST.reduce((s, r) => s + r.rivalError!, 0) / FIRST.length;
const allUnder = FIRST.every((r) => r.rivalError! < 0);
const fewest = FIRST.reduce((a, b) => (b.polls < a.polls ? b : a));

const SIDES = [
  { key: "esquerda", label: "Esquerda", color: IDEO.left! },
  { key: "centro", label: "Centro", color: T.ink2 },
  { key: "direita", label: "Direita", color: IDEO.right! },
] as const;
const unplaced = DATA.statesBySide["sem classificação"]?.n ?? 0;

const roundName = (r: (typeof ROUNDS)[number]) => `${r.year} · ${r.round === "r1" ? "1º" : "2º"} turno`;

// Part 1 geometry.
const ZERO = 1080;
const PX = 46; // per point
const TOP = 250;
const ROW = 66;
// The beats, in fractions of the scene.
const ROWS_FROM = 0.04;
const ROW_STEP = 0.035;
const CARD1 = 0.38;
const SWITCH = 0.45;
const CARD2 = 0.52;
const PART2 = 0.62;

export function Resultado({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const f = (x: number) => at(duration, x);
  // 0 → 1: the bars turn from the margin error to the rival's error, 1st rounds only.
  const toRival = interpolate(frame, [f(SWITCH), f(SWITCH) + 30], [0, 1], { ...clamp, easing: easeInOut });
  const part1 = interpolate(frame, [f(PART2) - 14, f(PART2)], [1, 0], clamp);

  return (
    <Scene chapter="O resultado, eleição por eleição">
      {/* ---- Part 1: the president ---- */}
      <div style={{ position: "absolute", inset: 0, opacity: part1 }}>
        <div style={{ position: "absolute", left: 72, top: 110 }}>
          <Title size={58} style={{ opacity: 1 - toRival }}>
            Erro na diferença entre o PT e o principal adversário
          </Title>
          <Title size={58} style={{ position: "absolute", top: 0, whiteSpace: "nowrap", opacity: toRival }}>
            Erro no voto do principal adversário do PT, 1º turno
          </Title>
          <div style={{ fontSize: 24, color: T.ink2, marginTop: 8 }}>
            {toRival < 0.5
              ? "Pontos. Para a direita: a pesquisa deu ao PT uma posição melhor do que a urna."
              : "Pontos. Para a esquerda: a pesquisa deu a ele menos votos do que a urna."}
          </div>
        </div>

        {/* Zero line. */}
        <div style={{ position: "absolute", left: ZERO, top: TOP - 16, width: 2, height: ROUNDS.length * ROW + 10, background: T.muted }} />
        <div style={{ position: "absolute", left: ZERO - 10, top: TOP + ROUNDS.length * ROW, fontSize: 20, color: T.muted }}>0</div>

        {ROUNDS.map((r, i) => {
          const grow = interpolate(frame, [f(ROWS_FROM + i * ROW_STEP), f(ROWS_FROM + i * ROW_STEP) + 18], [0, 1], {
            ...clamp,
            easing: easeOut,
          });
          const first = r.round === "r1";
          const value = first ? r.marginError! + (r.rivalError! - r.marginError!) * toRival : r.marginError!;
          const dim = first ? 1 : 1 - 0.78 * toRival;
          const w = Math.abs(value) * PX * grow;
          const color =
            first && toRival > 0.5 ? COLOR.blue : value >= 0 ? COLOR.red : COLOR.blue;
          const y = TOP + i * ROW;
          const label = toRival > 0.5 && first ? r.rival : `${r.pt} × ${r.rival}`;
          return (
            <div key={`${r.year}${r.round}`} style={{ opacity: Math.min(1, grow * 3) * dim }}>
              <div style={{ position: "absolute", left: 72, top: y + 4, width: 520 }}>
                <div style={{ fontSize: 24, color: T.ink2 }}>{roundName(r)}</div>
              </div>
              <div style={{ position: "absolute", left: 330, top: y + 2, fontSize: 28, fontWeight: 500 }}>{label}</div>
              <div
                style={{
                  position: "absolute",
                  top: y + 6,
                  height: 36,
                  left: value >= 0 ? ZERO + 2 : ZERO - w,
                  width: w,
                  background: color,
                  borderRadius: 4,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: y + 2,
                  ...(value >= 0 ? { left: ZERO + w + 14 } : { left: ZERO - w - 14, transform: "translateX(-100%)" }),
                  fontFamily: DISPLAY,
                  fontWeight: 700,
                  fontSize: 36,
                  opacity: grow,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {signed(value)}
              </div>
              {r === fewest && toRival > 0.5 ? (
                <div style={{ position: "absolute", left: 1700, top: y + 10, fontSize: 20, color: T.muted, opacity: toRival }}>
                  só {r.polls} institutos *
                </div>
              ) : null}
            </div>
          );
        })}

        {/* Summary cards. */}
        <Reveal duration={duration} from={CARD1} until={SWITCH} style={{ position: "absolute", left: 72, top: 880 }}>
          <div style={{ fontSize: 40, fontWeight: 600 }}>
            <span style={{ color: COLOR.red, fontFamily: DISPLAY, fontSize: 64 }}>
              {favoured} de {ROUNDS.length}
            </span>{" "}
            votações: a pesquisa deu ao PT uma posição melhor do que a urna.
          </div>
        </Reveal>
        <Reveal duration={duration} from={CARD2} style={{ position: "absolute", left: 72, top: 880, right: 72 }}>
          <div style={{ fontSize: 36, fontWeight: 600, lineHeight: 1.3 }}>
            {allUnder ? "Em todo 1º turno desde 2010" : "Na maioria dos 1º turnos"}, o principal adversário do PT teve mais
            votos do que as pesquisas davam:{" "}
            <span style={{ color: COLOR.blue, fontFamily: DISPLAY, fontSize: 52 }}>{signed(rivalMean)} pontos</span> em média.
          </div>
          <div style={{ fontSize: 20, color: T.muted, marginTop: 10 }}>
            * {fewest.year}, 1º turno: só {fewest.polls} institutos publicaram nos 10 dias antes da eleição.
          </div>
        </Reveal>
      </div>

      {/* ---- Part 2: the states ---- */}
      <States duration={duration} />

      {ROUNDS.map((_, i) => (
        <Sfx key={i} name="tick" at={f(ROWS_FROM + i * ROW_STEP)} volume={0.3} />
      ))}
      <Sfx name="hit" at={f(CARD1)} volume={0.45} />
      <Sfx name="swish" at={f(SWITCH)} volume={0.4} />
      <Sfx name="chime" at={f(CARD2)} volume={0.35} />
    </Scene>
  );
}

function States({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const f = (x: number) => at(duration, x);
  const show = interpolate(frame, [f(PART2), f(PART2) + 14], [0, 1], clamp);
  const zero = 960;
  const px = 150;
  const base = 360;
  const step = 150;
  const barsFrom = PART2 + 0.06;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: show }}>
      <div style={{ position: "absolute", left: 72, top: 110 }}>
        <Title size={58}>Nos estados: 2026, 1º turno</Title>
        <div style={{ fontSize: 24, color: T.ink2, marginTop: 8 }}>
          Governador e senador. Erro médio com sinal, pelo lado do partido do candidato, em pontos.
        </div>
      </div>
      <div style={{ position: "absolute", left: zero, top: base - 30, width: 2, height: step * 3, background: T.muted }} />
      {SIDES.map((s, i) => {
        const d = DATA.statesBySide[s.key];
        if (!d || d.mean === null) return null;
        const grow = interpolate(frame, [f(barsFrom + i * 0.04), f(barsFrom + i * 0.04) + 20], [0, 1], {
          ...clamp,
          easing: easeOut,
        });
        const w = Math.abs(d.mean) * px * grow;
        const y = base + i * step;
        return (
          <div key={s.key} style={{ opacity: Math.min(1, grow * 3) }}>
            <div style={{ position: "absolute", left: 300, top: y, fontFamily: DISPLAY, fontWeight: 700, fontSize: 52 }}>
              {s.label}
            </div>
            <div style={{ position: "absolute", left: 300, top: y + 58, fontSize: 20, color: T.muted }}>
              {d.n} erros medidos
            </div>
            <div
              style={{
                position: "absolute",
                top: y + 8,
                height: 60,
                left: d.mean >= 0 ? zero + 2 : zero - w,
                width: w,
                background: s.color,
                borderRadius: 5,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: y + 4,
                ...(d.mean >= 0 ? { left: zero + w + 16 } : { left: zero - w - 16, transform: "translateX(-100%)" }),
                fontFamily: DISPLAY,
                fontWeight: 700,
                fontSize: 56,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {signed(d.mean)}
            </div>
          </div>
        );
      })}
      <Reveal duration={duration} from={0.82} style={{ position: "absolute", left: 72, right: 72, top: 820 }}>
        <div style={{ fontSize: 44, fontWeight: 600 }}>Nos estados, o mesmo lado aparece, mais fraco.</div>
        <div style={{ fontSize: 20, color: T.muted, marginTop: 14, lineHeight: 1.45, maxWidth: 1500 }}>
          Cada erro é um candidato numa pesquisa final (últimos 10 dias). Lado: o grupo do partido na Câmara, pela
          escala de Zucco e Power. {unplaced} erros de partidos sem classificação ficam de fora.
        </div>
      </Reveal>
      {SIDES.map((_, i) => (
        <Sfx key={i} name="pop" at={f(barsFrom + i * 0.04)} volume={0.35} />
      ))}
      <Sfx name="swish" at={f(PART2)} volume={0.4} />
      <Sfx name="hit" at={f(0.82)} volume={0.4} />
    </div>
  );
}

