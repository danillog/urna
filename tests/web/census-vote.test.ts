import { describe, expect, it } from "vitest";

import raw from "../../data/generated/census-vote.json";
import {
  composition,
  decodeCensusVote,
  gap,
  groupOf,
  pooledShare,
  populationBreaks,
  quadrants,
  valueAt,
  type CensusVote,
  type EncodedCensusVote,
} from "../../src/model/census-vote";

const data = decodeCensusVote(raw as unknown as EncodedCensusVote);
const all = () => true;
const election = (year: number) => data.elections.find((e) => e.year === year)!;

/** Four towns: incomes 100–400, alternating Evangelical shares; the PT's share falls with income. */
function toy(population = [10, 10, 10, 70]): CensusVote {
  const u16 = (xs: number[]) => Uint16Array.from(xs);
  const census = {
    income: u16([100, 200, 300, 400]),
    evangelical: u16([100, 400, 100, 400]), // 10% 40% 10% 40%
    catholic: u16([0, 0, 0, 0]),
    noReligion: u16([0, 0, 0, 0]),
    degree: u16([0, 0, 0, 0]),
    eduBasic: u16([0, 0, 0, 0]),
    eduFund: u16([0, 0, 0, 0]),
    eduMid: u16([0, 0, 0, 0]),
    illiterate: u16([0, 0, 0, 0]),
    otherReligion: u16([0, 0, 0, 0]),
    urban: u16([0, 0, 0, 0]),
    population: Uint32Array.from(population),
  };
  return {
    censusYears: [2022],
    incomeTo2022: 1,
    census: { 2022: census },
    elections: [
      {
        year: 2026,
        census: 2022,
        pt: "A",
        rival: "B",
        rivalParty: "B",
        ptShare: u16([800, 600, 400, 200]),
        rivalShare: u16([200, 400, 600, 800]),
        valid: Uint32Array.from(population),
      },
    ],
  };
}

describe("census × vote model", () => {
  it("cuts by people, not by towns", () => {
    const d = toy();
    // Half the people live in the richest town alone.
    expect(populationBreaks(d, 2022, "income", [0, 1, 2, 3], 2)).toEqual([400]);
    expect(groupOf(250, [200, 300])).toBe(1);
  });

  it("pools votes so every vote counts once", () => {
    const e = toy().elections[0]!;
    // (80·10 + 20·70) / 80 = 27.5
    expect(pooledShare(e, "pt", [0, 3])).toBeCloseTo(27.5);
  });

  it("splits into four groups at the population medians", () => {
    // Equal towns: the medians fall between them, one town per group.
    const d = toy([25, 25, 25, 25]);
    const { cuts, groups: q } = quadrants(d, d.elections[0]!, "income", "evangelical", all);
    expect(cuts).toEqual([200, 10]);
    expect(q.map((x) => [x.high, x.places, x.pt])).toEqual([
      [[false, false], 1, 80],
      [[false, true], 1, 60],
      [[true, false], 1, 40],
      [[true, true], 1, 20],
    ]);
  });

  it("matches the IBGE's national religion shares", () => {
    const weighted = (year: number, v: "evangelical" | "catholic") => {
      let num = 0;
      let den = 0;
      for (let i = 0; i < data.census[year]!.population.length; i++) {
        const x = valueAt(data, year, v, i);
        const p = valueAt(data, year, "population", i);
        if (x !== null && p) {
          num += x * p;
          den += p;
        }
      }
      return num / den;
    };
    expect(weighted(2022, "evangelical")).toBeCloseTo(26.9, 0);
    expect(weighted(2022, "catholic")).toBeCloseTo(56.7, 0);
    expect(weighted(2010, "evangelical")).toBeCloseTo(22.2, 0);
  });

  it("splits each group of towns into whole distributions that add up to 100%", () => {
    const groups = composition(data, election(2026), "pt", all);
    expect(groups.map((g) => [g.from, g.to])).toEqual([
      [null, 30],
      [30, 45],
      [45, 55],
      [55, 70],
      [70, null],
    ]);
    for (const g of groups.filter((x) => x.places)) {
      const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
      expect(sum(g.religion!)).toBeCloseTo(100, 0);
      expect(sum(g.schooling!)).toBeCloseTo(100, 0);
    }
    // Every town with a vote falls in exactly one group.
    expect(groups.reduce((n, g) => n + g.places, 0)).toBe(
      [...election(2026).valid].filter((v, i) => v > 0 && election(2026).ptShare[i] !== 0xffff).length,
    );
  });

  it("shows the 2006 realignment: richer places stop voting more PT", () => {
    expect(gap(data, election(2002), "income", all)!).toBeGreaterThan(0);
    expect(gap(data, election(2006), "income", all)!).toBeLessThan(-20);
    expect(gap(data, election(2026), "evangelical", all)!).toBeLessThan(-10);
  });
});
