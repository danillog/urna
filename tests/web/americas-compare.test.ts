import { describe, expect, it } from "vitest";

import type { AmericasData } from "../../src/model/americas";
import {
  MAX_COMPARED,
  addCompared,
  clampYear,
  comparedReadings,
  nearestYear,
  parseCompared,
  toggleCompared,
  yearSpan,
} from "../../src/model/americas-compare";
import type { IndicatorData } from "../../src/model/indicators";
import { americasFromSearch, americasToSearch } from "../../src/ui/americas-view";

const ISOS = ["BRA", "USA", "MEX", "ARG", "CHL", "PER", "COL"];
const data: AmericasData = {
  families: ["left", "centre-left", "centre-right", "right"],
  countries: Object.fromEntries(
    ISOS.map((iso) => [
      iso,
      {
        name: iso,
        system: "presidential" as const,
        elections: [{ date: "2026-10-04", article: iso, winner: "X", family: "left" as const }],
      },
    ]),
  ),
  territories: {},
};

/** 2000 → 2026; food starts in 2015 (FAO's first 3-year average, 2014–2016). */
const years = (from: number, values: (number | null)[]) => [
  ...Array.from({ length: from - 2000 }, () => null),
  ...values,
];
const indicators: IndicatorData = {
  firstYear: 2000,
  indicators: {
    hdi: {
      source: "",
      url: "",
      lastYear: 2001,
      values: { BRA: [0.7, 0.75], USA: [0.9, 0.92], MEX: [0.75, null] },
    },
    income: { source: "", url: "", lastYear: 2000, values: {} },
    poverty: { source: "", url: "", lastYear: 2000, values: { BRA: [20], USA: [2], MEX: [21] } },
    food: {
      source: "",
      url: "",
      lastYear: 2016,
      values: { BRA: years(2015, [13, 12]), USA: years(2015, [10, 11]), MEX: years(2015, [25, 22]) },
    },
    democracy: { source: "", url: "", lastYear: 2000, values: {} },
  },
};

describe("americas timeline span", () => {
  it("starts each layer where its data start, and ends with the tab", () => {
    expect(yearSpan(data, indicators, "politics")).toEqual([2000, 2026]);
    expect(yearSpan(data, indicators, "food")).toEqual([2015, 2026]);
    expect(yearSpan(data, indicators, "hdi")).toEqual([2000, 2026]);
  });

  it("clamps a year to the nearest one in the span", () => {
    expect(clampYear(2010, [2015, 2026])).toBe(2015);
    expect(clampYear(2020, [2015, 2026])).toBe(2020);
    expect(clampYear(2030, [2015, 2026])).toBe(2026);
  });
});

describe("americas comparison", () => {
  it("toggles countries, up to six", () => {
    let list: string[] = [];
    for (const iso of ISOS) list = toggleCompared(list, iso);
    expect(list).toHaveLength(MAX_COMPARED);
    expect(list).not.toContain("COL");
    const full = list;
    expect(toggleCompared(full, "COL")).toBe(full); // unchanged when full
    expect(toggleCompared(list, "USA")).not.toContain("USA");
    expect(addCompared(["BRA"], "BRA")).toEqual(["BRA"]);
  });

  it("reads ?comparar, dropping unknown and repeated codes", () => {
    expect(parseCompared(data, "bra,USA,XXX,BRA")).toEqual(["BRA", "USA"]);
    expect(parseCompared(data, null)).toEqual([]);
  });

  it("round-trips through the address", () => {
    const params = new URLSearchParams("view=americas&layer=food&comparar=BRA,USA,MEX&year=2020");
    const state = americasFromSearch(data, params);
    expect(state.compare).toEqual(["BRA", "USA", "MEX"]);
    const out = new URLSearchParams();
    americasToSearch(state, out);
    expect(out.get("comparar")).toBe("BRA,USA,MEX");
    expect(out.get("layer")).toBe("food");
  });

  it("puts the better end first: less food insecurity and poverty, more HDI; no data last", () => {
    const order = (layer: "food" | "poverty" | "hdi", year: number, list = ["BRA", "USA", "MEX"]) =>
      comparedReadings(indicators, layer, list, year).map((r) => r.iso);
    expect(order("food", 2016)).toEqual(["USA", "BRA", "MEX"]);
    expect(order("poverty", 2000)).toEqual(["USA", "BRA", "MEX"]);
    expect(order("hdi", 2000)).toEqual(["USA", "MEX", "BRA"]);
    expect(order("food", 2016, ["ARG", "MEX", "BRA"])).toEqual(["BRA", "MEX", "ARG"]);
    // A value older than the year shown is kept and dated.
    const mex = comparedReadings(indicators, "hdi", ["MEX"], 2001)[0]!;
    expect(mex).toMatchObject({ value: 0.75, year: 2000 });
  });
});

describe("nearestYear", () => {
  it("snaps to the closest year with data, the earlier one on a tie", () => {
    expect(nearestYear([2015, 2018, 2024], 2017.2)).toBe(2018);
    expect(nearestYear([2015, 2018, 2024], 2016.5)).toBe(2015);
    expect(nearestYear([2015, 2018, 2024], 2030)).toBe(2024);
    expect(nearestYear([], 2020)).toBeNull();
  });
});
