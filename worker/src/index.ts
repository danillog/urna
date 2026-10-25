/**
 * Apuração proxy: reads the TSE's live results files, boils them down to one
 * small JSON and serves it with CORS, which the TSE does not send.
 *
 *   GET /presidente/r1               country + 27 states (also /r1, /r2)
 *   GET /governador/r1               27 states (r2 for runoffs)
 *   GET /senador/r1                  27 states
 *   GET /deputado-federal/r1/sp      one state: party lists, seats, top names
 *   GET /deputado-estadual/r1/sp     one state (district deputies in the DF)
 *   GET /teste/<same path>           2024 data, real and finished, in the same
 *                                    format: capitals' mayors stand in for the
 *                                    majoritarian offices, the capital's council
 *                                    for deputies. Checks the chain any day.
 *
 * Every response is cached at the edge for CACHE_SECONDS, so however many
 * people have the page open, the TSE sees a few requests a minute. The TSE's
 * own CDN refreshes these files about once a minute anyway.
 */

import {
  OFFICES,
  UFS,
  isOffice,
  officeCode,
  parseTse,
  sumTallies,
  trimCandidates,
  type ApOffice,
  type Apuracao,
  type Tally,
} from "../../src/model/apuracao";

const TSE = "https://resultados.tse.jus.br/oficial";
const CACHE_SECONDS = 30;

/** TSE election codes for 2026: the federal one (president) and the state one. */
export type ElectionCodes = Record<"federal" | "state", Record<"r1" | "r2", string>>;

/**
 * Used until the TSE's configuration says otherwise: the 1st round's are confirmed; the
 * runoff's follow 2022's pattern (544/546 → 545/547) and are replaced by the listed ones.
 */
export const DEFAULT_ELECTIONS: ElectionCodes = {
  federal: { r1: "6257", r2: "6258" },
  state: { r1: "6259", r2: "6260" },
};

/** The 2026 codes in the TSE's configuration (comum/config/ele-c.json), over the defaults. */
export function electionCodes(config: unknown, year = 2026): ElectionCodes {
  const out: ElectionCodes = {
    federal: { ...DEFAULT_ELECTIONS.federal },
    state: { ...DEFAULT_ELECTIONS.state },
  };
  const pleitos = (config as { pl?: { dt?: string; e?: { cd?: string; t?: string; nm?: string }[] }[] })?.pl;
  for (const p of pleitos ?? []) {
    if (!String(p.dt ?? "").endsWith(String(year))) continue;
    for (const e of p.e ?? []) {
      const m = /^Eleição Ordinária (Federal|Estadual)\b/.exec(String(e.nm ?? ""));
      const round = e.t === "1" ? "r1" : e.t === "2" ? "r2" : null;
      if (m && round && e.cd) out[m[1] === "Federal" ? "federal" : "state"][round] = String(e.cd);
    }
  }
  return out;
}

let codes: { value: ElectionCodes; at: number } | null = null;

/** The codes, read from the TSE at most every 10 minutes; the defaults if it fails. */
async function currentCodes(now = Date.now()): Promise<ElectionCodes> {
  if (codes && now - codes.at < 600_000) return codes.value;
  try {
    const res = await fetch(`${TSE}/comum/config/ele-c.json`, { cf: { cacheTtl: 300 } } as RequestInit);
    codes = { value: res.ok ? electionCodes(await res.json()) : DEFAULT_ELECTIONS, at: now };
  } catch {
    codes = { value: DEFAULT_ELECTIONS, at: now };
  }
  return codes.value;
}

/** TSE codes of each state capital, for the 2024 test source. */
const CAPITALS_2024: Record<string, string> = {
  AC: "01392", AL: "27855", AM: "02550", AP: "06050", BA: "38490", CE: "13897", ES: "57053",
  GO: "93734", MA: "09210", MG: "41238", MS: "90514", MT: "90670", PA: "04278", PB: "20516",
  PE: "25313", PI: "12190", PR: "75353", RJ: "60011", RN: "17612", RO: "00035", RR: "03018",
  RS: "88013", SC: "81051", SE: "31054", SP: "71072", TO: "73440",
}; // prettier-ignore

/** One file to read: a place (country, state or municipality) and an office. */
interface File {
  uf: string;
  url: string;
}

/** What a request asks for, and the files that answer it. */
export interface Plan {
  office: ApOffice;
  round: Apuracao["round"];
  /** The national file, when there is one (president). */
  national: string | null;
  states: File[];
}

export function fileUrl(ciclo: string, election: string, office: number, uf: string, place: string): string {
  const code = String(office).padStart(4, "0");
  const padded = election.padStart(6, "0");
  return `${TSE}/${ciclo}/${election}/dados/${uf}/${place}-c${code}-e${padded}-u.json`;
}

/** Reads a path into a plan; null when it names nothing. */
export function plan(pathname: string, elections: ElectionCodes = DEFAULT_ELECTIONS): Plan | null {
  let parts = pathname.split("/").filter(Boolean);
  const test = parts[0] === "teste";
  if (test) parts = parts.slice(1);
  // Short forms: /r1, /r2 and /teste mean president.
  if (!parts.length || parts[0] === "r1" || parts[0] === "r2") parts = ["presidente", ...parts];
  const [office, round = "r1", ufParam] = parts;
  if (!office || !isOffice(office) || (round !== "r1" && round !== "r2")) return null;
  const info = OFFICES[office];
  if (round === "r2" && !info.runoff) return null;
  const uf = ufParam?.toUpperCase();
  if (info.proportional ? !uf || !(UFS as readonly string[]).includes(uf) : ufParam !== undefined)
    return null;
  const states = info.proportional ? [uf!] : [...UFS];

  if (test) {
    // 2024 had one round of interest here and no national race: 11 mayor, 13 council.
    const code = info.proportional ? 13 : 11;
    return {
      office,
      round,
      national: null,
      states: states
        .filter((u) => CAPITALS_2024[u])
        .map((u) => ({
          uf: u,
          url: fileUrl("ele2024", "619", code, u.toLowerCase(), `${u.toLowerCase()}${CAPITALS_2024[u]}`),
        })),
    };
  }
  const election = elections[info.election][round];
  return {
    office,
    round,
    national: office === "presidente" ? fileUrl("ele2026", election, 1, "br", "br") : null,
    states: states.map((u) => ({
      uf: u,
      url: fileUrl("ele2026", election, officeCode(office, u), u.toLowerCase(), u.toLowerCase()),
    })),
  };
}

async function readTally(url: string): Promise<Tally | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "urna-apuracao (+https://danillogomes.com/urna/)" },
      // Ask Cloudflare to keep the TSE file briefly too, so a burst of misses on
      // our cache does not become a burst on theirs.
      cf: { cacheTtl: 10, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return null;
    return parseTse(await res.json());
  } catch {
    return null;
  }
}

export async function collect(p: Plan, now = new Date()): Promise<Apuracao | null> {
  const proportional = OFFICES[p.office].proportional;
  const [national, ...byState] = await Promise.all([
    p.national ? readTally(p.national) : Promise.resolve(null),
    ...p.states.map((f) => readTally(f.url)),
  ]);
  const uf: Apuracao["uf"] = {};
  p.states.forEach((f, i) => {
    const t = byState[i];
    // A delegation has a thousand candidates: send who is in a seat and a few more.
    if (t) uf[f.uf] = proportional ? trimCandidates(t) : t;
  });
  const tallies = Object.values(uf) as Tally[];
  if (!national && !tallies.length) return null;
  let br: Tally;
  if (national) br = national;
  else if (proportional) br = tallies[0]!;
  else if (p.office === "presidente")
    br = sumTallies(tallies); // test mode: no national file
  // Governors and senators differ by state: the total only carries the progress.
  else br = { ...sumTallies(tallies), candidates: [] };
  return { office: p.office, round: p.round, fetchedAt: now.toISOString(), br, uf };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status: number, maxAge: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  });
}

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET") return json({ error: "method" }, 405, 0);
    const url = new URL(request.url);
    const p = plan(url.pathname.toLowerCase(), await currentCodes());
    if (!p) return json({ error: "not found", offices: Object.keys(OFFICES) }, 404, 300);

    // One cache entry per path; query strings are ignored so they cannot bypass it.
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const key = new Request(`${url.origin}${url.pathname.toLowerCase()}`);
    const hit = await cache?.match(key);
    if (hit) return hit;

    const data = await collect(p);
    // The TSE not answering is short-lived on election night: let browsers retry soon.
    const res = data ? json(data, 200, CACHE_SECONDS) : json({ error: "tse unavailable" }, 502, 5);
    if (data && cache) ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  },
};
