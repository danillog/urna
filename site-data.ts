/**
 * Splits the generated datasets into the pieces the page loads on demand.
 *
 * Each piece is a virtual module, `virtual:site-data/<name>`, whose default export is the
 * piece's data; `virtual:site-data` maps every name to a dynamic import of it. Rollup turns
 * each piece into a chunk of its own with a content hash, so a tab downloads only what it
 * draws, and the same code runs in `vite dev`, in vitest and in the build. src/data.ts is the
 * page's side.
 *
 * Pieces:
 * - map: municipalities, party colors, HDI and the municipal mesh; map-race/<key>: one
 *   election (president-2022-r2, mayor-2024...).
 * - capitals: the 27 capitals without their areas; capital/<IBGE code>: one capital's areas
 *   and the part of the mesh they use (São Paulo's districts and subprefeituras too).
 * - profiles: everyone elected, without news; profiles-news/<UF>: news per person in a state.
 * - one piece per remaining file (census-vote, mandate, congress, governismo,
 *   apuracao-cidades, americas, americas-topo, americas-indicators).
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const ID = "virtual:site-data";
const DIR = resolve(__dirname, "data/generated");

/** Generated file → its pieces. */
type Pieces = Record<string, unknown>;

interface Topo {
  arcs: unknown[];
  objects: Record<string, { type: string; geometries: { id?: string | number; arcs?: unknown }[] }>;
  [key: string]: unknown;
}

/** One object's geometries, with only the arcs they use (renumbered; the transform stays). */
export function subTopology(topo: Topo, object: string, keep: (id: string) => boolean): Topo {
  const used = new Map<number, number>();
  const arcs: unknown[] = [];
  const remap = (i: number): number => {
    const j = i < 0 ? ~i : i;
    let k = used.get(j);
    if (k === undefined) {
      k = arcs.length;
      used.set(j, k);
      arcs.push(topo.arcs[j]);
    }
    return i < 0 ? ~k : k;
  };
  const walk = (a: unknown): unknown => (typeof a === "number" ? remap(a) : (a as unknown[]).map(walk));
  const all = topo.objects[object]!;
  const geometries = all.geometries
    .filter((g) => keep(String(g.id)))
    .map((g) => (g.arcs === undefined ? g : { ...g, arcs: walk(g.arcs) }));
  return { ...topo, arcs, objects: { [object]: { ...all, geometries } } };
}

const read = (file: string) => JSON.parse(readFileSync(resolve(DIR, file), "utf8"));

const SPLITS: Record<string, () => Pieces> = {
  "map.json": () => {
    const { races, ...base } = read("map.json");
    return {
      map: { ...base, races: {}, raceKeys: Object.keys(races) },
      ...Object.fromEntries(Object.entries(races).map(([k, v]) => [`map-race/${k}`, v])),
    };
  },
  "capitals.json": () => {
    const { capitals, brazil, topology } = read("capitals.json") as {
      capitals: { code: string; areas: unknown[]; units?: unknown }[];
      brazil?: unknown;
      topology: Topo;
    };
    // The list carries no areas nor São Paulo's districts: those come with each capital.
    const out: Pieces = {
      capitals: {
        capitals: capitals.map(({ areas: _, units: __, ...c }) => c),
        ...(brazil ? { brazil } : {}),
      },
    };
    for (const c of capitals)
      out[`capital/${c.code}`] = {
        areas: c.areas,
        topology: subTopology(topology, "areas", (id) => id.startsWith(c.code)),
        ...(c.units ? { units: c.units } : {}),
      };
    return out;
  },
  "profiles.json": () => {
    const data = read("profiles.json") as {
      people: { id: string; uf: string; news?: unknown; declaredSocials?: unknown }[];
    };
    const news: Record<string, Record<string, unknown>> = {};
    // `declaredSocials` is the pipeline's input to `socials`: not published twice.
    const people = data.people.map(({ news: n, declaredSocials: _, ...p }) => {
      if (n !== undefined) (news[p.uf] ??= {})[p.id] = n;
      return p;
    });
    return {
      profiles: { ...data, people, newsStates: Object.keys(news).sort() },
      ...Object.fromEntries(Object.entries(news).map(([uf, n]) => [`profiles-news/${uf}`, n])),
    };
  },
  "census-vote.json": () => {
    // The runoffs come apart: downloaded only when someone picks the 2nd round.
    const { runoffs, ...first } = read("census-vote.json") as { runoffs?: { year: number }[] };
    return {
      "census-vote": { ...first, runoffYears: (runoffs ?? []).map((r) => r.year) },
      "census-runoffs": runoffs ?? [],
    };
  },
  "mandate.json": () => ({ mandate: read("mandate.json") }),
  "ideology.json": () => ({ ideology: read("ideology.json") }),
  "watch.json": () => ({ watch: read("watch.json") }),
  "programs.json": () => ({ programs: read("programs.json") }),
  "congress.json": () => ({ congress: read("congress.json") }),
  "governismo.json": () => ({ governismo: read("governismo.json") }),
  "apuracao-cidades.json": () => ({ "apuracao-cidades": read("apuracao-cidades.json") }),
  "americas.json": () => ({ americas: read("americas.json") }),
  "americas.topo.json": () => ({ "americas-topo": read("americas.topo.json") }),
  "americas-indicators.json": () => ({ "americas-indicators": read("americas-indicators.json") }),
};

/** Pieces of every file, recomputed when a file changes. */
const cache = new Map<string, { mtime: number; pieces: Pieces }>();

function pieces(): Map<string, { file: string; value: unknown }> {
  const out = new Map<string, { file: string; value: unknown }>();
  for (const [file, split] of Object.entries(SPLITS)) {
    const mtime = statSync(resolve(DIR, file)).mtimeMs;
    let hit = cache.get(file);
    if (!hit || hit.mtime !== mtime) {
      hit = { mtime, pieces: split() };
      cache.set(file, hit);
    }
    for (const [name, value] of Object.entries(hit.pieces)) out.set(name, { file, value });
  }
  return out;
}

/** JSON as a JS string literal: JSON.parse of a string is faster than an object literal. */
const literal = (value: unknown) => `'${JSON.stringify(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export function siteData(): Plugin {
  return {
    name: "site-data",
    resolveId(id) {
      if (id === ID || id.startsWith(`${ID}/`)) return `\0${id}`;
      return null;
    },
    load(id) {
      if (!id.startsWith(`\0${ID}`)) return null;
      const all = pieces();
      for (const file of Object.keys(SPLITS)) this.addWatchFile(resolve(DIR, file));
      if (id === `\0${ID}`) {
        const entries = [...all.keys()].map((n) => `${JSON.stringify(n)}: () => import("${ID}/${n}")`);
        return `export default {\n${entries.join(",\n")}\n};\n`;
      }
      const piece = all.get(id.slice(ID.length + 2));
      if (!piece) throw new Error(`no data piece named ${id.slice(ID.length + 2)}`);
      return `export default JSON.parse(${literal(piece.value)});\n`;
    },
  };
}
