/**
 * "Epocas": Latin America's HDI in 1990, on a CRT's teletext page, wound forward on tape to
 * 2023, where the picture breaks out into a neon future; the "time twins" (Brazil in 1990 had
 * the HDI Honduras has today), then the twist: the same HDI and a very different plate (FAO
 * food insecurity). Numbers from motion/data/epocas.json (scripts/epocas.py).
 */
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { useLayout } from "../common/layout";
import { motion } from "../common/registry";
import { BODY } from "../common/theme";
import { Bed, Sfx } from "../video/sound";
import { EPOCAS, PAIRS, TWINS } from "./data";
import { Close, Future, N, Space, Twist } from "./future";
import { Crt, Osd, TeletextPage, VCR } from "./retro";
import { DURATION, F, clamp, ease } from "./timeline";

type Props = Record<string, never>;

function Retro() {
  const frame = useCurrentFrame();
  const ff = frame >= F.ff[0];
  const wind = interpolate(frame, [F.ff[0], F.ff[1]], [0, 1], { ...clamp, easing: ease });
  const year = Math.round(EPOCAS.then + (EPOCAS.now - EPOCAS.then) * wind);
  const tear = ff ? interpolate(frame, [F.ff[0], F.ff[0] + 20, F.ff[1], F.burst[1]], [0, 1, 1, 1], clamp) : 0;
  const burst = interpolate(frame, [F.burst[0], F.burst[1]], [0, 1], { ...clamp, easing: ease });
  return (
    <Crt tear={tear} burst={burst}>
      <TeletextPage mix={wind} year={year} ff={ff} />
      <Osd ff={ff} year={year} />
    </Crt>
  );
}

function Epocas() {
  const frame = useCurrentFrame();
  const { u, pad } = useLayout();
  const future = frame >= F.burst[0] + 30;
  const futureIn = interpolate(frame, [F.burst[0] + 30, F.burst[1] + 10], [0, 1], clamp);
  const twinsBeat = Math.floor((F.future[1] - F.twins) / TWINS.length);
  const pairBeat = Math.floor((F.twist[1] - F.twist[0] - 150) / PAIRS.length);
  return (
    <AbsoluteFill style={{ background: "#050505", fontFamily: BODY }}>
      {!future || frame < F.burst[1] ? <Retro /> : null}
      {future ? (
        <div style={{ position: "absolute", inset: 0, opacity: futureIn }}>
          {/* The floor steps back when the scatter needs the space. */}
          <Space floor={interpolate(frame, [F.twist[0] - 10, F.twist[0] + 20], [1, 0.12], clamp)}>
            {frame < F.twist[0] ? <Future /> : frame < F.close[0] ? <Twist /> : <Close />}
            <div
              style={{
                position: "absolute",
                left: pad,
                right: pad,
                bottom: 40 * u,
                display: "flex",
                justifyContent: "space-between",
                fontSize: 20 * u,
                color: N.dim,
              }}
            >
              <span>
                {frame >= F.twist[0]
                  ? "IDH 2023 (PNUD) · insegurança alimentar moderada ou grave, média 2023–2025 (FAO)"
                  : "IDH: PNUD, Relatório de Desenvolvimento Humano 2025"}
              </span>
              <span style={{ whiteSpace: "nowrap" }}>danillogomes.com/urna</span>
            </div>
          </Space>
        </div>
      ) : null}
      {frame < F.page[0] + 60 ? (
        <div
          style={{
            position: "absolute",
            left: pad,
            right: pad,
            top: 70 * u,
            fontFamily: VCR,
            fontSize: 56 * u,
            color: "#e8ffe8",
            opacity: interpolate(frame, [F.on[1], F.on[1] + 10, F.page[0] + 45, F.page[0] + 60], [0, 1, 1, 0], clamp),
          }}
        >
          AMÉRICA LATINA, {EPOCAS.then}
        </div>
      ) : null}

      {/* Sound: the TV, blips as bars come in, the tape, the break-out, the neon. */}
      <Sfx name="crt" at={F.on[0] + 2} volume={0.5} />
      {Array.from({ length: 6 }, (_, i) => (
        <Sfx key={`b${i}`} name="blip" at={F.page[0] + 12 + i * 14} volume={0.18} />
      ))}
      <Sfx name="blip" at={F.caption} volume={0.3} />
      <Sfx name="vhs" at={F.ff[0]} volume={0.45} />
      <Sfx name="riser" at={F.ff[1] - 60} volume={0.35} />
      <Sfx name="hit" at={F.burst[0] + 20} volume={0.55} />
      <Sfx name="arp" at={F.burst[1]} volume={0.4} />
      <Sfx name="hum" at={F.future[0] + 10} volume={0.18} />
      {TWINS.map((_, i) => (
        <Sfx key={`t${i}`} name="swish" at={F.twins + i * twinsBeat} volume={0.3} />
      ))}
      <Sfx name="hit" at={F.twist[0]} volume={0.4} />
      <Sfx name="blip" at={F.twist[0] + 4} volume={0.25} />
      {PAIRS.map((_, i) => (
        <Sfx key={`p${i}`} name="pop" at={F.twist[0] + 120 + i * pairBeat} volume={0.35} />
      ))}
      <Sfx name="chime" at={F.close[0] + 35} volume={0.4} />
      <Sequence from={F.burst[1]} durationInFrames={DURATION - F.burst[1]} layout="none">
        <Bed volume={0.1} />
      </Sequence>
    </AbsoluteFill>
  );
}

export const def = motion<Props>({
  id: "Epocas",
  title: "Duas épocas: o IDH de 1990 a 2023, e o prato",
  description:
    "Do teletexto de 1990 ao neon de 2023: o IDH da América Latina virou outro país, mas a insegurança alimentar não acompanhou.",
  component: Epocas,
  defaultProps: {},
  durationInFrames: () => DURATION,
  formats: ["portrait", "landscape"],
});
