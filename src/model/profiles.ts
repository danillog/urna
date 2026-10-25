/**
 * The people elected in 2026 and where they came from. Data from pipeline/profiles.py.
 */

export type ProfileOffice = "governador" | "senador" | "deputado-federal";
export const PROFILE_OFFICES: ProfileOffice[] = ["governador", "senador", "deputado-federal"];

/**
 * Returning to the same office; elected before to another; never elected but held an
 * appointed public office (minister, secretary…); ran and never won; or none of these.
 */
export type Kind = "returning" | "other-office" | "appointed" | "tried" | "new";
export const KINDS: Kind[] = ["new", "tried", "appointed", "other-office", "returning"];

export interface Candidacy {
  year: number;
  /** "vereador", "prefeito", "deputado-estadual", "suplente-senador"… */
  office: string;
  /** Municipality (local offices) or state. */
  place: string;
  uf: string;
  party: string;
  result: "elected" | "runoff" | "substitute" | "lost" | "unfit";
}

export interface Contact {
  house: "camara" | "senado";
  page: string;
  photo: string | null;
  email: string | null;
  phone: string | null;
  office: string | null;
  site: string | null;
  socials: { network: string; url: string }[];
  /** Still in office in the current term (some deputies are on leave). */
  inOffice: boolean;
}

export interface Person {
  id: string;
  /** Ballot name, as known; full name as registered. */
  name: string;
  fullName: string;
  office: ProfileOffice;
  uf: string;
  party: string;
  number: string;
  /** Elected; going to the runoff; deputies projected until the TSE names them; senators of 2022 staying. */
  status: "elected" | "runoff" | "projected" | "staying";
  votes: number | null;
  share: number | null;
  age: number | null;
  birthplace: string | null;
  education: string | null;
  occupation: string | null;
  kind: Kind;
  /** Candidacies before 2026, oldest first. */
  history: Candidacy[];
  contact: Contact | null;
  /** Public offices held, from Wikidata (appointed ones included), most recent first. */
  positions?: { title: string; from: number | null; to: number | null }[];
  wikipedia?: string | null;
  wikidata?: string | null;
  /** The Congress's list of accounts, completed by Wikidata's. */
  socials?: { network: string; url: string }[];
  site?: string | null;
  /** Latest headlines from an automatic search, newest first. */
  news?: { title: string; source: string; date: string; id: string }[];
  /** The TSE's declared gender is female: offices are written in the feminine. */
  feminine?: boolean;
  /** Criminal cases, checked by hand on the court's page (data/legal.yaml); newest first. */
  legal?: LegalCase[];
}

export type LegalGrade =
  "investigado" | "reu" | "condenado-recorrivel" | "condenado-definitivo" | "arquivado" | "absolvido";

export interface LegalCase {
  grade: LegalGrade;
  crime: string;
  court: string;
  case: string;
  /** When the grade began (yyyy-mm-dd). */
  since: string;
  url: string;
  /** The last time someone looked at the case page (yyyy-mm-dd). */
  checked: string;
  /** Not looked at again for six months: may be out of date. */
  stale: boolean;
  note?: string;
}

/** Most serious first; closed inquiries and acquittals are history, not a mark. */
const SEVERITY: LegalGrade[] = ["condenado-definitivo", "condenado-recorrivel", "reu", "investigado"];

/** The mark on the card: the most serious open grade, or null. */
export function legalMark(p: Person): LegalGrade | null {
  const open = new Set((p.legal ?? []).map((c) => c.grade));
  return SEVERITY.find((g) => open.has(g)) ?? null;
}

export interface ProfilesData {
  officialDeputies: boolean;
  historySince: number;
  /** When the headlines were fetched (yyyy-mm-dd). */
  newsUpdated?: string;
  people: Person[];
  /** Last time a criminal case was checked (yyyy-mm-dd), if any. */
  legalChecked?: string | null;
  /** Deputies and senators in office now who ran in 2026 and were not elected. */
  defeated?: Defeated[];
  /** States whose news come apart, downloaded when one of their profiles opens. */
  newsStates?: string[];
}

export interface PeopleFilter {
  office: ProfileOffice | null;
  uf: string | null;
  party: string | null;
  kind: Kind | null;
  query: string;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** People matching every filter; the query looks in both names and the party. */
export function filterPeople(people: Person[], f: PeopleFilter): Person[] {
  const words = fold(f.query).split(/\s+/).filter(Boolean);
  return people.filter(
    (p) =>
      (!f.office || p.office === f.office) &&
      (!f.uf || p.uf === f.uf) &&
      (!f.party || p.party === f.party) &&
      (!f.kind || p.kind === f.kind) &&
      words.every((w) => fold(`${p.name} ${p.fullName} ${p.party}`).includes(w)),
  );
}

export interface Defeated {
  name: string;
  /** The house they sit in now. */
  house: "camara" | "senado";
  party: string;
  uf: string;
  /** What they ran for in 2026. */
  ranFor: string;
  votes: number;
  share: number | null;
  /** The TSE's word: "Não eleito", "Suplente"… */
  status: string;
}

/** The election before for each office: a deputy or governor of 2022, a senator of 2018. */
const PREVIOUS: Record<ProfileOffice, number> = { "deputado-federal": 2022, governador: 2022, senador: 2018 };

/** Re-elected: elected to the same office, in the same state, at the office's previous election. */
export function reelected(p: Person): boolean {
  const before = PREVIOUS[p.office];
  return p.history.some(
    (h) => h.year === before && h.office === p.office && h.uf === p.uf && h.result === "elected",
  );
}

export interface RenewalRow {
  key: string;
  elected: number;
  reelected: number;
  /** Percent of the seats that changed hands. */
  renewal: number;
}

/** Renewal among those elected in 2026 (runoffs and the senators of 2022 left out), by a key. */
export function renewal(people: Person[], key: (p: Person) => string): RenewalRow[] {
  const by = new Map<string, { elected: number; reelected: number }>();
  for (const p of people) {
    if (p.status !== "elected" && p.status !== "projected") continue;
    const k = key(p);
    const row = by.get(k) ?? { elected: 0, reelected: 0 };
    row.elected++;
    if (reelected(p)) row.reelected++;
    by.set(k, row);
  }
  return [...by]
    .map(([k, r]) => ({ key: k, ...r, renewal: r.elected ? (1 - r.reelected / r.elected) * 100 : 0 }))
    .sort((a, b) => b.elected - a.elected || a.key.localeCompare(b.key));
}

/** How many of each kind, for the renewal bar. */
export function byKind(people: Person[]): Record<Kind, number> {
  const out: Record<Kind, number> = { new: 0, tried: 0, appointed: 0, "other-office": 0, returning: 0 };
  for (const p of people) out[p.kind]++;
  return out;
}

/** The parties someone ran for, in order, each change counted once: PSL → UNIÃO → PL. */
export function partyPath(p: Person): string[] {
  const path: string[] = [];
  for (const party of [...p.history.map((c) => c.party), p.party])
    if (party && path.at(-1) !== party) path.push(party);
  return path;
}

/** A headline's link: Google News keeps the article behind its id. */
export const articleUrl = (id: string) => `https://news.google.com/rss/articles/${id}`;

/** A news search for the person: name, office and state, so namesakes stay out. */
export function newsUrl(p: Person, officeLabel: string): string {
  const q = `"${p.name}" ${officeLabel} ${p.uf}`;
  return `https://news.google.com/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

/** Office words Wikidata gives in the masculine → the feminine, whole words only. */
const FEMININE: Record<string, string> = {
  ministro: "ministra",
  secretário: "secretária",
  deputado: "deputada",
  senador: "senadora",
  governador: "governadora",
  prefeito: "prefeita",
  vereador: "vereadora",
  subprefeito: "subprefeita",
  diretor: "diretora",
  conselheiro: "conselheira",
  embaixador: "embaixadora",
  procurador: "procuradora",
  juiz: "juíza",
  desembargador: "desembargadora",
  administrador: "administradora",
  coordenador: "coordenadora",
  superintendente: "superintendente",
  líder: "líder",
};

/** A Wikidata office title as a woman holds it ("ministro da Igualdade Racial" → "ministra…"). */
export function feminineTitle(title: string): string {
  return title.replace(/[A-Za-zÀ-ÿ]+/g, (word) => {
    const f = FEMININE[word.toLowerCase()];
    if (!f) return word;
    return word[0] === word[0]!.toUpperCase() ? f[0]!.toUpperCase() + f.slice(1) : f;
  });
}
