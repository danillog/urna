import { describe, expect, it } from "vitest";

import { areaDeciles, areaLine, areaValue, type Area } from "../../src/model/capitals";

const area = (id: string, income: number, population: number, pt: number, valid: number): Area => ({
  id,
  bairros: [id],
  population,
  income,
  degree: null,
  evangelical: null,
  catholic: null,
  noReligion: null,
  valid,
  pt,
  rival: 100 - pt,
  coverage: 100,
});

describe("capital areas", () => {
  const areas = Array.from({ length: 10 }, (_, k) => area(`a${k}`, 1000 * (k + 1), 100, 80 - 5 * k, 50));

  it("ranks areas in tenths of the population", () => {
    const decile = areaDeciles(areas, "income");
    expect(areas.map(decile)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // No sample data (no one lives there): no value, no decile.
    expect(areaValue({ ...areas[0]!, population: 0 }, "income")).toBeNull();
    expect(areaValue(areas[0]!, "urban")).toBeNull();
  });

  it("draws the vote by tenth, every vote counting once", () => {
    const line = areaLine(areas, "income", "pt");
    expect(line).toHaveLength(10);
    expect(line[0]).toEqual({ x: 1000, y: 80 });
    expect(line.at(-1)).toEqual({ x: 10000, y: 35 });
  });
});
