import { describe, expect, it } from "vitest";

import { band, rank, valueAt, type IndicatorData } from "../../src/model/indicators";

const data: IndicatorData = {
  firstYear: 2000,
  indicators: {
    hdi: {
      source: "",
      url: "",
      lastYear: 2003,
      values: { AAA: [0.5, 0.6, null, 0.81], BBB: [0.7, 0.7, 0.7, 0.7] },
    },
    gdp: { source: "", url: "", lastYear: 2001, values: { AAA: [4000, 12000] } },
    democracy: { source: "", url: "", lastYear: 2000, values: {} },
  },
};

describe("indicators", () => {
  it("uses the latest value up to the year, never a later one", () => {
    expect(valueAt(data, "hdi", "AAA", 2002)).toEqual({ value: 0.6, year: 2001 }); // 2002 is missing
    expect(valueAt(data, "hdi", "AAA", 2010)).toEqual({ value: 0.81, year: 2003 }); // past the last year
    expect(valueAt(data, "gdp", "BBB", 2001)).toBeNull();
  });

  it("puts values in bands with inclusive lower bounds", () => {
    expect([0.549, 0.55, 0.7, 0.8].map((v) => band("hdi", v))).toEqual([0, 1, 2, 3]);
    expect([4999, 5000, 40000].map((v) => band("gdp", v))).toEqual([0, 1, 4]);
  });

  it("ranks countries with data that year", () => {
    expect(rank(data, "hdi", "AAA", 2003)).toEqual([1, 2]);
    expect(rank(data, "hdi", "AAA", 2000)).toEqual([2, 2]);
  });
});
