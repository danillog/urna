import { Easing, interpolate, useCurrentFrame } from "remotion";
import watchJson from "../../../data/generated/watch.json";
import { houseMedians, top, type WatchData } from "../../../src/model/watch";
import { Footer, Header, Stage, useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { COLOR, DISPLAY, T, css, int, mixRgb, pct, rgb } from "../common/theme";

/** pipeline/watch.py: presence counted only while in office, nobody with fewer than 20 sessions ranked. */
const data = watchJson as unknown as WatchData;
const camara = data.houses.camara!;
const ranked = camara.members.filter((m) => m.presence);
const unranked = camara.members.length - ranked.length;
const median = houseMedians(ranked).presence!;
const atLeast = (p: number) => ranked.filter((m) => m.presence!.pct >= p).length;
const below = (p: number) => ranked.filter((m) => m.presence!.pct < p).length;
const most = atLeast(90);
const senators = (data.houses.senado?.members ?? []).filter((m) => m.presence);
const senatorsAll = senators.filter((m) => m.presence!.pct === 100).length;

type Props = { top: number; closing: string };

// Scenes, in frames (30 fps).
const DIST = 30; // dots fall in
const MEDIAN_AT = 190;
const MOST_AT = 290;
const LOW_AT = 410;
const LIST = 560;
const CAVEATS = 1080;
const CLOSING = 1530;
const END = 1770;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.out(Easing.cubic);
const LOW = COLOR.orange;
const BG = rgb(T.bg);
const GREY = mixRgb(BG, rgb(T.ink2), 0.55);
const TEAL = rgb(COLOR.teal);
const ORANGE = rgb(LOW);

const dmy = (iso: string) => iso.split("-").reverse().join("/");

/** 2-point bins from 40% to 100% (100% in the last one); each deputy a square, lowest first. */
const BIN = 2;
const FROM = 40;
const BINS = (100 - FROM) / BIN;
const binOf = (p: number) => Math.min(BINS - 1, Math.floor((p - FROM) / BIN));
const dots = (() => {
  const sorted = [...ranked].sort((a, b) => a.presence!.pct - b.presence!.pct);
  const fill = new Array<number>(BINS).fill(0);
  return sorted.map((m) => {
    const bin = binOf(m.presence!.pct);
    return { m, bin, k: fill[bin]!++ };
  });
})();
const tallest = Math.max(...dots.map((d) => d.k + 1));

function Presenca({ top: n, closing }: Props) {
  const frame = useCurrentFrame();
  const { width, portrait, u, pad } = useLayout();
  const lows = top(ranked, "presentLeast", n);
  const lowSet = new Set(lows);
  const lowest = lows[lows.length - 1]!.presence!.pct;
  const threshold = Math.ceil(lowest / 10) * 10; // "abaixo de 70%"

  const headerIn = interpolate(frame, [0, 15], [0, 1], clamp);
  const fade = (a: number, b: number) =>
    interpolate(frame, [a, a + 20, b - 20, b], [0, 1, 1, 0], clamp);
  const distOn = fade(DIST - 20, LIST + 10);
  const listOn = fade(LIST, CAVEATS);
  const cavOn = fade(CAVEATS, CLOSING);
  const closeOn = interpolate(frame, [CLOSING, CLOSING + 25], [0, 1], clamp);

  // --- Distribution: a square per deputy, stacked by bin.
  const plot = portrait
    ? { left: pad, right: width - pad, base: 1500 * u, per: 2 }
    : { left: pad, right: width - pad, base: 860 * u, per: 3 };
  const colW = (plot.right - plot.left) / BINS;
  const cell = colW / plot.per;
  const plotTop = plot.base - Math.ceil(tallest / plot.per) * cell;
  const xOf = (p: number) => plot.left + ((p - FROM) / (100 - FROM)) * (plot.right - plot.left);
  const medianIn = interpolate(frame, [MEDIAN_AT, MEDIAN_AT + 20], [0, 1], clamp);
  const mostIn = interpolate(frame, [MOST_AT, MOST_AT + 20], [0, 1], clamp);
  const lowIn = interpolate(frame, [LOW_AT, LOW_AT + 20], [0, 1], clamp);
  const note = 34 * u;

  // --- The ones who miss the most.
  const box = portrait
    ? { left: pad, right: width - pad, top: 560 * u, bottom: 1520 * u }
    : { left: pad, right: width - pad, top: 385 * u, bottom: 940 * u };
  const nameW = (portrait ? 330 : 440) * u;
  const labelW = (portrait ? 200 : 260) * u;
  const rowH = (box.bottom - box.top) / n;
  const barH = rowH * (portrait ? 0.4 : 0.5);
  const barL = box.left + nameW;
  const barW = box.right - box.left - nameW - labelW;

  const caveats: [string, string][] = [
    [
      "Conta só o tempo no cargo.",
      "Quem se licenciou, por exemplo para ser ministro ou secretário de estado, não leva falta nesse período. Por isso cada um tem um total de sessões diferente.",
    ],
    [
      "Falta justificada também aparece como ausência.",
      "O dado aberto da Câmara diz quem teve a presença registrada, não o motivo de quem faltou (doença, missão oficial).",
    ],
    [
      "Presença não mede trabalho.",
      "Comissões, relatorias, negociações e a base eleitoral ficam fora desta conta. É o plenário, e só ele.",
    ],
    [
      "Pouco tempo, fora do ranking.",
      `Quem teve menos de 20 sessões no cargo não entra: ${unranked} dos ${camara.members.length} deputados em exercício.`,
    ],
  ];

  return (
    <Stage>
      <Header
        title="Quem aparece para votar"
        subtitle={`Câmara dos Deputados: em quantas sessões deliberativas do plenário cada um dos ${ranked.length} deputados em exercício teve a presença registrada, de ${dmy(camara.since)} a ${dmy(data.date)}`}
        opacity={headerIn * (1 - closeOn)}
      />

      {/* Distribution. */}
      <div style={{ opacity: distOn }}>
        {dots.map(({ m, bin, k }) => {
          const at = DIST + bin * 3 + Math.floor(k / plot.per) * 1.5;
          const t = ease(interpolate(frame, [at, at + 14], [0, 1], clamp));
          const x = plot.left + bin * colW + (k % plot.per) * cell;
          const y = plot.base - (Math.floor(k / plot.per) + 1) * cell;
          const isLow = lowSet.has(m);
          const strong = bin * BIN + FROM >= 90;
          const base = strong ? mixRgb(GREY, TEAL, mostIn) : GREY;
          const color = css(isLow ? mixRgb(base, ORANGE, lowIn) : mixRgb(base, BG, 0.55 * lowIn));
          return (
            <div
              key={`${m.name}-${m.uf}`}
              style={{
                position: "absolute",
                left: x + u,
                top: y - (1 - t) * 60 * u,
                width: cell - 2 * u,
                height: cell - 2 * u,
                borderRadius: 2 * u,
                background: color,
                opacity: t,
              }}
            />
          );
        })}
        {/* Axis. */}
        <div style={{ position: "absolute", left: plot.left, width: plot.right - plot.left, top: plot.base, height: 2 * u, background: T.rule }} />
        {[40, 50, 60, 70, 80, 90, 100].map((p) => (
          <div
            key={p}
            style={{
              position: "absolute",
              left: xOf(p) - 40 * u,
              width: 80 * u,
              top: plot.base + 12 * u,
              textAlign: "center",
              fontSize: 22 * u,
              color: T.muted,
              fontVariantNumeric: "tabular-nums",
              opacity: interpolate(frame, [DIST + 40, DIST + 60], [0, 1], clamp),
            }}
          >
            {p}%
          </div>
        ))}
        <div
          style={{
            position: "absolute",
            left: plot.left,
            top: plot.base + 48 * u,
            fontSize: 22 * u,
            color: T.muted,
            opacity: interpolate(frame, [DIST + 40, DIST + 60], [0, 1], clamp),
          }}
        >
          Cada quadrado é um deputado, na sua porcentagem de presença.
        </div>
        {/* Median. */}
        <div
          style={{
            position: "absolute",
            left: xOf(median) - u,
            top: plotTop - 50 * u,
            height: plot.base - plotTop + 50 * u,
            width: 2 * u,
            background: T.ink,
            opacity: medianIn * 0.8,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: width - xOf(median) + 12 * u,
            top: plotTop - 56 * u,
            textAlign: "right",
            fontSize: 24 * u,
            color: T.ink,
            opacity: medianIn,
            whiteSpace: "nowrap",
          }}
        >
          mediana: <b>{pct(median)}</b>
        </div>
        {/* Notes, in the empty left of the chart. */}
        <div
          style={{
            position: "absolute",
            left: plot.left,
            top: portrait ? 470 * u : plotTop + 10 * u,
            width: (portrait ? 560 : 820) * u,
            fontSize: note,
            lineHeight: 1.3,
          }}
        >
          <div style={{ opacity: medianIn, transform: `translateY(${(1 - medianIn) * 16 * u}px)` }}>
            Metade dos deputados esteve em <b>{pct(median)}</b> das sessões ou mais.
          </div>
          <div style={{ marginTop: 26 * u, opacity: mostIn, transform: `translateY(${(1 - mostIn) * 16 * u}px)` }}>
            <b style={{ color: COLOR.teal }}>{int(most)} de {int(ranked.length)}</b> estiveram em pelo menos 9 de cada 10.
          </div>
          <div style={{ marginTop: 26 * u, opacity: lowIn, transform: `translateY(${(1 - lowIn) * 16 * u}px)` }}>
            <b style={{ color: LOW }}>{below(threshold)}</b> ficaram abaixo de {threshold}%.
          </div>
        </div>
      </div>

      {/* The ones who miss the most. */}
      <div style={{ opacity: listOn }}>
        <div
          style={{
            position: "absolute",
            left: box.left,
            top: box.top - (portrait ? 110 : 108) * u,
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: 40 * u,
          }}
        >
          Os {n} com menos presença registrada
        </div>
        {/* Median across the bars. */}
        <div
          style={{
            position: "absolute",
            left: barL + (median / 100) * barW - u,
            top: box.top - 30 * u,
            height: box.bottom - box.top + 20 * u,
            width: 2 * u,
            background: T.ink2,
            opacity: 0.6,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: width - (barL + (median / 100) * barW) + 10 * u,
            top: box.top - 42 * u,
            fontSize: 20 * u,
            color: T.ink2,
            whiteSpace: "nowrap",
          }}
        >
          mediana da Câmara: {pct(median)}
        </div>
        {lows.map((m, i) => {
          const at = LIST + 20 + i * 8;
          const t = ease(interpolate(frame, [at, at + 24], [0, 1], clamp));
          const p = m.presence!;
          const y = box.top + i * rowH;
          return (
            <div
              key={`${m.name}-${m.uf}`}
              style={{ position: "absolute", left: box.left, top: y, height: rowH, width: box.right - box.left, opacity: t }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  width: nameW - 20 * u,
                  top: rowH / 2 - 30 * u,
                  textAlign: "right",
                  lineHeight: 1.1,
                }}
              >
                <div style={{ fontSize: 27 * u, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.name}
                </div>
                <div style={{ fontSize: 20 * u, color: T.muted }}>
                  {m.party} · {m.uf}
                </div>
              </div>
              <div
                style={{
                  position: "absolute",
                  left: nameW,
                  top: rowH / 2 - barH / 2,
                  width: barW,
                  height: barH,
                  background: T.grid,
                  borderRadius: 4 * u,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: nameW,
                  top: rowH / 2 - barH / 2,
                  width: (p.pct / 100) * barW * t,
                  height: barH,
                  background: LOW,
                  borderRadius: 4 * u,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: nameW + barW + 16 * u,
                  top: rowH / 2 - 30 * u,
                  lineHeight: 1.1,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                <div style={{ fontSize: 28 * u, fontWeight: 600 }}>{pct(p.pct)}</div>
                <div style={{ fontSize: 19 * u, color: T.muted }}>
                  {int(p.attended)} de {int(p.held)}
                </div>
              </div>
            </div>
          );
        })}
        <div
          style={{
            position: "absolute",
            left: box.left,
            right: pad,
            top: box.bottom + (portrait ? 40 : 18) * u,
            fontSize: 22 * u,
            color: T.muted,
            lineHeight: 1.4,
          }}
        >
          Sessões com presença registrada, de todas as que houve enquanto cada um estava no cargo.
          {portrait ? <br /> : " "}
          Licenças não contam como falta; faltas justificadas, sim (o dado não traz o motivo).
        </div>
      </div>

      {/* What the number measures. */}
      <div style={{ opacity: cavOn }}>
        <div
          style={{
            position: "absolute",
            left: pad,
            right: pad,
            top: (portrait ? 500 : 320) * u,
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: (portrait ? 60 : 56) * u,
            lineHeight: 1.05,
          }}
        >
          O que esse número mede, e o que não mede
        </div>
        <div
          style={{
            position: "absolute",
            left: pad,
            right: pad,
            top: (portrait ? 680 : 420) * u,
            display: "grid",
            gridTemplateColumns: portrait ? "1fr" : "1fr 1fr",
            columnGap: 70 * u,
            rowGap: (portrait ? 54 : 44) * u,
          }}
        >
          {caveats.map(([head, body], i) => {
            const at = CAVEATS + 25 + i * 45;
            const t = ease(interpolate(frame, [at, at + 20], [0, 1], clamp));
            return (
              <div
                key={head}
                style={{
                  opacity: t,
                  transform: `translateY(${(1 - t) * 20 * u}px)`,
                  borderLeft: `${4 * u}px solid ${COLOR.teal}`,
                  paddingLeft: 24 * u,
                }}
              >
                <div style={{ fontSize: 32 * u, fontWeight: 600, lineHeight: 1.25 }}>{head}</div>
                <div style={{ fontSize: 26 * u, color: T.ink2, marginTop: 10 * u, lineHeight: 1.4 }}>{body}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Closing card. */}
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: portrait ? 640 * u : 300 * u,
          opacity: closeOn,
          transform: `translateY(${(1 - closeOn) * 30 * u}px)`,
        }}
      >
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: (portrait ? 92 : 100) * u, lineHeight: 1.02 }}>
          A maioria aparece.
        </div>
        <div style={{ fontSize: 32 * u, color: T.ink2, marginTop: 30 * u, maxWidth: 1400 * u, lineHeight: 1.4 }}>
          Na Câmara, metade dos deputados esteve em {pct(median)} das sessões ou mais; {below(threshold)} de{" "}
          {int(ranked.length)} ficaram abaixo de {threshold}%.
        </div>
        {senators.length ? (
          <div style={{ fontSize: 26 * u, color: T.muted, marginTop: 26 * u, maxWidth: 1400 * u, lineHeight: 1.4 }}>
            No Senado a conta é outra (votações nominais, sem as ausências que o Senado registra como justificadas):{" "}
            {senatorsAll} dos {senators.length} senadores votaram em todas.
          </div>
        ) : null}
        <div style={{ fontSize: 30 * u, color: T.ink, marginTop: 44 * u, maxWidth: 1400 * u, lineHeight: 1.4 }}>
          {closing}
        </div>
      </div>

      <Footer
        source={`Câmara dos Deputados e Senado, dados abertos (sessões, presenças, histórico de cada mandato), até ${dmy(data.date)}`}
        opacity={headerIn}
      />
    </Stage>
  );
}

export const def = motion<Props>({
  id: "Presenca",
  title: "Quem aparece para votar",
  description: "A presença dos deputados federais nas sessões do plenário, e quem mais faltou.",
  component: Presenca,
  defaultProps: {
    top: 10,
    closing: "Presença não é trabalho, mas é parte do mandato. Os números são ponto de partida para perguntar.",
  },
  durationInFrames: () => END,
  formats: ["portrait", "landscape"],
});
