/**
 * Sound for the IDH Reels: the music bed (scripts/sons.py, synthesized, no licence needed)
 * under the whole video, louder than in the long video since there is no voice, and each
 * motion's own effects at its scene changes. `musica: false` renders it silent.
 */
import type { ComponentType } from "react";
import type { MotionDef } from "../common/registry";
import { Bed, Sfx, type SfxName } from "../video/sound";

export type Cue = { name: SfxName; at: number; volume?: number };

/** Effects at frames of the motion's own timeline (a primer in front shifts them with it). */
export function withCues(def: MotionDef, cues: Cue[]): MotionDef {
  const Inner = def.component as ComponentType<Record<string, unknown>>;
  function WithCues(props: Record<string, unknown>) {
    return (
      <>
        <Inner {...props} />
        {props.musica === false
          ? null
          : cues.map((c, i) => <Sfx key={i} name={c.name} at={c.at} volume={(c.volume ?? 0.45) * 1.4} />)}
      </>
    );
  }
  return { ...def, component: WithCues };
}

/** The bed under everything, with a `musica` switch. Goes outermost, after withPrimer. */
export function withMusic(def: MotionDef, volume = 0.7): MotionDef {
  const Inner = def.component as ComponentType<Record<string, unknown>>;
  function WithMusic(props: Record<string, unknown>) {
    return (
      <>
        <Inner {...props} />
        {props.musica === false ? null : <Bed volume={volume} />}
      </>
    );
  }
  return {
    ...def,
    component: WithMusic,
    defaultProps: { ...def.defaultProps, musica: true },
    controls: [
      ...(def.controls ?? []),
      {
        prop: "musica",
        label: "Som",
        options: [
          { value: true, label: "Com trilha e efeitos" },
          { value: false, label: "Mudo" },
        ],
      },
    ],
  };
}
