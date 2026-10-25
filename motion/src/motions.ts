import type { MotionDef } from "./common/registry";
import { def as americas } from "./americas";
import { def as apuracao } from "./apuracao";
import { def as capital } from "./capitais";
import { def as congresso } from "./congresso";
import { def as cota } from "./cota";
import { cues as idhAmericasCues, def as idhAmericas } from "./idh/americas";
import { cues as idhArgentinaCues, def as idhArgentina } from "./idh/argentina";
import { cues as idhComparativoCues, def as idhComparativo } from "./idh/comparativo";
import { cues as idhmEstadosCues, def as idhmEstados } from "./idh/estados";
import { cues as idhExplicadorCues, def as idhExplicador } from "./idh/explicador";
import { cues as idhmMunicipiosCues, def as idhmMunicipios } from "./idh/municipios";
import { cues as pobrezaCues, def as pobreza } from "./idh/pobreza";
import { withPrimer } from "./idh/primer";
import { withCues, withMusic } from "./idh/sound";
import { def as mapa } from "./mapa";
import { def as pesquisas } from "./pesquisas";
import { def as pobrezaAmericas } from "./pobreza";
import { def as epocas } from "./epocas";
import { def as fome } from "./fome";
import { def as pobrezaNumeros } from "./pobreza-numeros";
import { def as saopaulo } from "./saopaulo";
import { def as video } from "./video";
import { def as votoCenso } from "./votocenso";
import { def as virada } from "./virada";
import { def as governismo } from "./governismo";
import { def as ideologia } from "./ideologia";
import { def as eleitos } from "./eleitos";
import { def as presenca } from "./presenca";

/** Every motion, in the order the interactive page lists them. */
export const MOTIONS: MotionDef[] = [
  mapa,
  pesquisas,
  congresso,
  apuracao,
  capital,
  saopaulo,
  cota,
  americas,
  pobrezaAmericas,
  pobrezaNumeros,
  fome,
  epocas,
  video,
  votoCenso,
  virada,
  governismo,
  ideologia,
  eleitos,
  presenca,
  withMusic(withCues(idhExplicador, idhExplicadorCues)),
  withMusic(withPrimer(withCues(idhmMunicipios, idhmMunicipiosCues), "idhm")),
  withMusic(withPrimer(withCues(idhmEstados, idhmEstadosCues), "idhm")),
  withMusic(withPrimer(withCues(idhComparativo, idhComparativoCues), "idh")),
  withMusic(withPrimer(withCues(idhAmericas, idhAmericasCues), "idh")),
  // Explains the three parts itself; the primer only on request.
  withMusic(withPrimer(withCues(idhArgentina, idhArgentinaCues), "idh", false)),
  // Opens with its own "what counts as poor".
  withMusic(withCues(pobreza, pobrezaCues)),
];
