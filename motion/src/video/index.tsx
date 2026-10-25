/**
 * "As pesquisas erram mais para algum lado?": the long video (about 8 minutes, 16:9), one
 * scene per block of the script, a crossfade and a whoosh between blocks, the music bed under
 * everything. The voice goes on top in the editor; timeline.ts sets each block's length.
 */
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Fragment, type ComponentType } from "react";
import { Sequence } from "remotion";
import { FPS } from "../common/registry";
import { motion } from "../common/registry";
import type { SceneProps } from "./kit";
import { Dicas } from "./scenes/dicas";
import { Fechamento } from "./scenes/fechamento";
import { Gancho } from "./scenes/gancho";
import { Institutos } from "./scenes/institutos";
import { NaoSignifica } from "./scenes/naosignifica";
import { Porque } from "./scenes/porque";
import { Promessa } from "./scenes/promessa";
import { Regras } from "./scenes/regras";
import { Resultado } from "./scenes/resultado";
import { Bed, Sfx } from "./sound";
import { BLOCKS, CROSSFADE } from "./timeline";

const SCENES: Record<string, ComponentType<SceneProps>> = {
  gancho: Gancho,
  promessa: Promessa,
  regras: Regras,
  resultado: Resultado,
  institutos: Institutos,
  porque: Porque,
  naosignifica: NaoSignifica,
  dicas: Dicas,
  fechamento: Fechamento,
};

type Props = { music: boolean };

const frames = BLOCKS.map((b) => Math.round(b.seconds * FPS));
const total = frames.reduce((a, b) => a + b, 0) - CROSSFADE * (BLOCKS.length - 1);
/** Where each block starts in the whole video, for the whooshes. */
const starts = frames.map((_, i) => frames.slice(0, i).reduce((a, b) => a + b, 0) - CROSSFADE * i);

function VideoPesquisas({ music }: Props) {
  return (
    <>
      <TransitionSeries>
        {BLOCKS.map((b, i) => {
          const Scene = SCENES[b.id]!;
          return (
            <Fragment key={b.id}>
              {i > 0 ? (
                <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: CROSSFADE })} />
              ) : null}
              <TransitionSeries.Sequence durationInFrames={frames[i]!} name={b.id}>
                <Scene duration={frames[i]!} />
              </TransitionSeries.Sequence>
            </Fragment>
          );
        })}
      </TransitionSeries>
      {starts.slice(1).map((s, i) => (
        <Sequence key={i} from={s - 10} layout="none">
          <Sfx name="whoosh" at={0} volume={0.35} />
        </Sequence>
      ))}
      {music ? <Bed /> : null}
    </>
  );
}

export const def = motion<Props>({
  id: "VideoPesquisas",
  title: "As pesquisas erram mais para algum lado? (8 min)",
  description: "O vídeo longo, bloco a bloco do roteiro, com trilha e efeitos. A voz entra por cima na edição.",
  component: VideoPesquisas,
  defaultProps: { music: true },
  durationInFrames: () => total,
  formats: ["landscape"],
  controls: [
    {
      prop: "music",
      label: "Trilha",
      options: [
        { value: true, label: "Com trilha" },
        { value: false, label: "Só efeitos" },
      ],
    },
  ],
});
