/** The runoff candidates' programs as cards (data/programs.yaml, checked by pipeline.programs). */

export interface ProgramSource {
  /** Page of the PDF, first page 1. */
  page: number;
  /** Word for word from that page. */
  quote: string;
}

export interface ProgramCandidate {
  id: string;
  number: number;
  name: string;
  fullName: string;
  party: string;
  coalition: string;
  vice: string;
  /** The program as registered with the TSE, served next to the page. */
  pdf: string;
  pages: number;
  /** Network → the candidate's own profile, as declared to the TSE. */
  channels: Record<string, string>;
}

export interface ProgramCard {
  id: string;
  theme: string;
  candidate: string;
  text: string;
  sources: ProgramSource[];
}

export interface ProgramAgreement {
  id: string;
  text: string;
  sources: Record<string, ProgramSource[]>;
}

/** A promise made in a TV debate: shown apart from the programs, never in the quiz. */
export interface DebatePromise {
  id: string;
  debate: string;
  theme: string;
  candidate: string;
  /** "1:13:18", and the same in seconds for the video link. */
  time: string;
  seconds: number;
  text: string;
  /** The words as said (YouTube's transcript, checked against the video). */
  quote: string;
}

export interface Debate {
  id: string;
  name: string;
  date: string;
  channel: string;
  video: string;
}

export interface ProgramsData {
  source: { label: string; url: string; fetched: string; candidates: string; socials: string };
  /** In ballot-number order. */
  candidates: ProgramCandidate[];
  themes: { id: string; name: string }[];
  cards: ProgramCard[];
  agree: ProgramAgreement[];
  debates: Debate[];
  debateThemes: { id: string; name: string }[];
  promises: DebatePromise[];
}

export type Answer = "agree" | "disagree" | "skip";

export interface Score {
  candidate: string;
  agreed: number;
  disagreed: number;
}

/** Share of the candidate's cards answered with "agree", among those answered; null with none. */
export const agreement = (s: Score): number | null =>
  s.agreed + s.disagreed ? s.agreed / (s.agreed + s.disagreed) : null;

/** A small seeded generator (mulberry32): the same seed gives the same deck. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The cards in a random order, taking turns between the candidates so that neither one's
 * proposals come in a run: a run would let the reader guess the author.
 */
export function deck(data: ProgramsData, seed: number): ProgramCard[] {
  const next = random(seed);
  const shuffle = <T>(xs: T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  const piles = shuffle(
    data.candidates.map((c) => shuffle(data.cards.filter((card) => card.candidate === c.id))),
  );
  const out: ProgramCard[] = [];
  for (let i = 0; out.length < data.cards.length; i++) {
    for (const pile of piles) if (pile[i]) out.push(pile[i]!);
  }
  return out;
}

const tally = (data: ProgramsData, cards: ProgramCard[], answers: ReadonlyMap<string, Answer>): Score[] =>
  data.candidates.map((c) => {
    const mine = cards.filter((card) => card.candidate === c.id);
    return {
      candidate: c.id,
      agreed: mine.filter((card) => answers.get(card.id) === "agree").length,
      disagreed: mine.filter((card) => answers.get(card.id) === "disagree").length,
    };
  });

export interface Result {
  overall: Score[];
  byTheme: { theme: string; scores: Score[] }[];
  answered: number;
}

/** How many of each candidate's proposals the reader agreed with, overall and per theme. */
export function result(data: ProgramsData, answers: ReadonlyMap<string, Answer>): Result {
  return {
    overall: tally(data, data.cards, answers),
    byTheme: data.themes.map((theme) => ({
      theme: theme.id,
      scores: tally(
        data,
        data.cards.filter((card) => card.theme === theme.id),
        answers,
      ),
    })),
    answered: data.cards.filter((card) => {
      const a = answers.get(card.id);
      return a === "agree" || a === "disagree";
    }).length,
  };
}

/** The candidate whose proposals the reader agreed with more, by share; null on a tie or no answer. */
export function closer(scores: Score[]): string | null {
  const shares = scores.map((s) => ({ id: s.candidate, share: agreement(s) }));
  if (shares.some((s) => s.share === null)) return null;
  const [a, b] = shares as { id: string; share: number }[];
  if (!a || !b || Math.abs(a.share - b.share) < 1e-9) return null;
  return a.share > b.share ? a.id : b.id;
}

/** Link to a page of a candidate's program. */
export const pageLink = (c: ProgramCandidate, page: number) => `${c.pdf}#page=${page}`;

/** Link to the moment of the official video where a promise was made. */
export const momentLink = (debate: Debate, promise: DebatePromise) => `${debate.video}&t=${promise.seconds}s`;
