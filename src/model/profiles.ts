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
}

export interface ProfilesData {
  officialDeputies: boolean;
  historySince: number;
  /** When the headlines were fetched (yyyy-mm-dd). */
  newsUpdated?: string;
  people: Person[];
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
