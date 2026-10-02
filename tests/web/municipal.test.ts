import { describe, expect, it } from "vitest";

import { margin, shade, winsByCandidate } from "../../src/model/municipal";
import type { MunicipalRace } from "../../src/types";

const race: MunicipalRace = {
  candidates: ["Lula", "Bolsonaro", "Ciro"],
  colors: { Lula: "red", Bolsonaro: "blue", Ciro: "gold" },
  winner: [0, 1, 1, 2, -1],
  winnerShare: [510, 700, 480, 600, 0],
  second: [1, 0, 0, 0, -1],
  secondShare: [490, 300, 420, 250, 0],
  votes: [100, 100, 100, 100, 0],
};

describe("municipal map model", () => {
  it("computes the margin in points", () => {
    expect(margin(race, 0)).toBe(2);
    expect(margin(race, 1)).toBe(40);
  });

  it("shades by margin steps", () => {
    expect([0, 4.9, 5, 14.9, 15, 29.9, 30, 80].map(shade)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it("counts wins and ignores municipalities without data", () => {
    expect(winsByCandidate(race)).toEqual([
      { candidate: "Bolsonaro", wins: 2 },
      { candidate: "Lula", wins: 1 },
      { candidate: "Ciro", wins: 1 },
    ]);
  });
});
