import { describe, expect, it } from "vitest";

import {
  areaDeciles,
  areaLine,
  areaValue,
  capitalInRound,
  cityValue,
  fromSample,
  giniRank,
  inBand,
  isApprox,
  namedLevel,
  ranking,
  unitNames,
  type Area,
  type AreaVote,
  type Capital,
} from "../../src/model/capitals";

const area = (id: string, income: number, population: number, pt: number, valid: number): Area => ({
  id,
  bairros: [id],
  population,
  income,
  eduBasic: null,
  eduFund: null,
  eduMid: null,
  degree: null,
  evangelical: null,
  catholic: null,
  noReligion: null,
  otherReligion: null,
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

describe("capitalInRound", () => {
  const voted = (id: string, r2?: AreaVote) =>
    ({ id, bairros: [], population: 1, valid: 100, pt: 40, rival: 50, coverage: 100, r2 }) as unknown as Area;
  const capital = {
    code: "1",
    name: "X",
    uf: "XX",
    placed: 98,
    sections: 10,
    missing: 0,
    r2: { placed: 97, sections: 10, missing: 3 },
    areas: [voted("a", { valid: 90, pt: 45, rival: 55, coverage: 80 }), voted("b")],
    topology: {} as Capital["topology"],
  } satisfies Capital;

  it("swaps in the runoff's votes and reports, area by area", () => {
    const r2 = capitalInRound(capital, "r2");
    expect(r2.missing).toBe(3);
    expect(r2.areas[0]).toMatchObject({ valid: 90, pt: 45, rival: 55, coverage: 80 });
    // An area without a runoff report shows no vote rather than the 1st round's.
    expect(r2.areas[1]).toMatchObject({ valid: 0, pt: null, rival: null });
    expect(capitalInRound(capital, "r1")).toBe(capital);
  });
});

describe("who lives where", () => {
  const people = (id: string, elderly: number | null, population: number) =>
    ({ id, bairros: [id], population, elderly }) as unknown as Area;
  const areas = [people("b", 10, 300), people("a", 30, 100), people("c", 10, 100), people("d", null, 50)];

  it("ranks the places with a value, most first, ties sharing a place", () => {
    const r = ranking(areas, "elderly");
    expect(r.map((x) => [x.area.id, x.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 2],
    ]);
  });

  it("weights each place by its people for the whole city", () => {
    expect(cityValue(areas, "elderly")).toBe((10 * 300 + 30 * 100 + 10 * 100) / 500);
    expect(cityValue(areas, "population")).toBe(550);
    expect(cityValue([people("x", null, 10)], "elderly")).toBeNull();
    // A median is not the mean of medians: the city gets none, nor a ratio to it.
    expect(cityValue([{ ...people("x", 10, 10), incomeMedian: 900 } as Area], "incomeMedian")).toBeNull();
    expect(cityValue([{ ...people("x", 10, 10), incomeRatio: 1.5 } as Area], "incomeRatio")).toBeNull();
  });

  it("keeps the places in a band of the city's people along another variable", () => {
    const rich = Array.from({ length: 10 }, (_, k) => ({ ...area(`a${k}`, 1000 * (k + 1), 100, 50, 10) }));
    const poorHalf = inBand(rich, { v: "income", from: 0, to: 4 });
    expect(rich.filter(poorHalf).map((a) => a.id)).toEqual(["a0", "a1", "a2", "a3", "a4"]);
    const top = inBand(rich, { v: "income", from: 8, to: 9 });
    expect(rich.filter(top).map((a) => a.id)).toEqual(["a8", "a9"]);
    // No value along the band's variable: out. No band: everyone.
    expect(inBand(rich, { v: "elderly", from: 0, to: 9 })(rich[0]!)).toBe(false);
    expect(inBand(rich, null)(rich[0]!)).toBe(true);
  });

  it("tells the sample's variables, published by weighting area, from the tracts'", () => {
    expect(fromSample("income")).toBe(true);
    expect(fromSample("unemployed")).toBe(true);
    expect(fromSample("flat")).toBe(false); // counted tract by tract
    expect(fromSample("negro")).toBe(false);
    expect(fromSample("urban")).toBe(false); // not a capital's variable at all
  });

  it("places a capital among the others by inequality between its areas", () => {
    const meta = (code: string, giniAreas: number | null) => ({ code, giniAreas }) as unknown as Capital;
    const all = [meta("a", 0.41), meta("b", 0.43), meta("c", 0.16), meta("d", null)];
    expect(giniRank(all, "a")).toEqual({ gini: 0.41, rank: 2, of: 3 });
    expect(giniRank(all, "d")).toBeNull();
  });

  it("numbers the places that share a name, and names those without any", () => {
    const named = (id: string, bairros: string[]) => ({ id, bairros }) as unknown as Area;
    const names = unitNames(
      [named("1", ["Moema"]), named("2", ["Saúde"]), named("3", ["Moema"]), named("4", [])],
      (k) => `Área ${k}`,
      (name, k, n) => `${name}, área ${k} de ${n}`,
    );
    expect([...names.values()]).toEqual(["Moema, área 1 de 2", "Saúde", "Moema, área 2 de 2", "Área 4"]);
  });

  it("tells São Paulo's approximate neighbourhoods from the IBGE's", () => {
    const unit = { areas: [], topology: {} } as unknown as NonNullable<Capital["units"]>["bairros"];
    const c = (source?: "osm") => ({ units: { bairros: { ...unit!, source } } }) as unknown as Capital;
    expect(isApprox(c("osm"), "bairros")).toBe(true);
    expect(isApprox(c(), "bairros")).toBe(false);
    expect(isApprox(c("osm"), "areas")).toBe(false);
  });

  it("opens a capital at its most familiar names", () => {
    const base = { areas: [], topology: {} } as unknown as Capital;
    const unit = { areas: [], topology: {} } as unknown as NonNullable<Capital["units"]>["bairros"];
    expect(namedLevel(base)).toBe("areas");
    expect(namedLevel({ ...base, units: { bairros: unit } })).toBe("bairros");
    expect(namedLevel({ ...base, units: { regions: unit } })).toBe("regions"); // Brasília
    expect(namedLevel({ ...base, units: { regions: unit, bairros: unit } })).toBe("bairros");
    expect(namedLevel({ ...base, units: { districts: unit, subprefeituras: unit } })).toBe("districts");
  });
});
