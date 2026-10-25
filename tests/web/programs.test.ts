import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { agreement, closer, deck, result, type Answer, type ProgramsData } from "../../src/model/programs";

const data = JSON.parse(readFileSync("data/generated/programs.json", "utf-8")) as ProgramsData;
const ids = data.candidates.map((c) => c.id);

describe("the programs' cards", () => {
  it("give each candidate as many cards as the other in every theme", () => {
    for (const theme of data.themes) {
      const [a, b] = ids.map(
        (id) => data.cards.filter((c) => c.theme === theme.id && c.candidate === id).length,
      );
      expect(a, theme.id).toBe(b);
      expect(a, theme.id).toBeGreaterThan(0);
    }
  });

  it("cite pages that exist in each candidate's PDF", () => {
    for (const card of data.cards) {
      const c = data.candidates.find((x) => x.id === card.candidate)!;
      for (const s of card.sources) expect(s.page).toBeLessThanOrEqual(c.pages);
    }
  });
});

describe("deck", () => {
  it("has every card once, the same order for the same seed", () => {
    const one = deck(data, 7);
    expect(new Set(one.map((c) => c.id)).size).toBe(data.cards.length);
    expect(deck(data, 7).map((c) => c.id)).toEqual(one.map((c) => c.id));
    expect(deck(data, 8).map((c) => c.id)).not.toEqual(one.map((c) => c.id));
  });

  it("takes turns between the candidates, so no run gives the author away", () => {
    for (const seed of [1, 2, 3, 42]) {
      const order = deck(data, seed).map((c) => c.candidate);
      for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
    }
  });
});

describe("result", () => {
  const answers = (pick: (candidate: string) => Answer) =>
    new Map(data.cards.map((c) => [c.id, pick(c.candidate)] as const));

  it("is the share of each candidate's proposals agreed with, among those answered", () => {
    const r = result(
      data,
      answers((c) => (c === ids[0] ? "agree" : "disagree")),
    );
    expect(agreement(r.overall[0]!)).toBe(1);
    expect(agreement(r.overall[1]!)).toBe(0);
    expect(closer(r.overall)).toBe(ids[0]);
    expect(r.byTheme.every((th) => closer(th.scores) === ids[0])).toBe(true);
  });

  it("calls a tie a tie, and skipped cards do not count", () => {
    const r = result(
      data,
      answers(() => "agree"),
    );
    expect(closer(r.overall)).toBeNull();
    const skipped = result(
      data,
      answers(() => "skip"),
    );
    expect(skipped.answered).toBe(0);
    expect(agreement(skipped.overall[0]!)).toBeNull();
    expect(closer(skipped.overall)).toBeNull();
  });
});
