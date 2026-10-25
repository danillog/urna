/**
 * The blocks of "As pesquisas erram mais para algum lado?", in order, with how long each
 * lasts. After recording the voice, set each block's seconds to its take's length (Whisper's
 * timestamps, or the editor's): every animation inside a scene is placed in fractions of the
 * scene, so it stretches with it.
 */
export interface Block {
  id: string;
  /** Shown small in the corner, like a chapter. */
  chapter: string;
  seconds: number;
}

export const BLOCKS: Block[] = [
  { id: "gancho", chapter: "", seconds: 20 },
  { id: "promessa", chapter: "", seconds: 40 },
  { id: "regras", chapter: "Como medir sem se enganar", seconds: 60 },
  { id: "resultado", chapter: "O resultado, eleição por eleição", seconds: 90 },
  { id: "institutos", chapter: "Quem erra mais, e como", seconds: 75 },
  { id: "porque", chapter: "Por que os erros acontecem", seconds: 75 },
  { id: "naosignifica", chapter: "O que isso não significa", seconds: 60 },
  { id: "dicas", chapter: "Como ler pesquisa daqui pra frente", seconds: 40 },
  { id: "fechamento", chapter: "", seconds: 20 },
];

/** Frames of crossfade between two blocks (taken from both, so the total shrinks by this). */
export const CROSSFADE = 18;
