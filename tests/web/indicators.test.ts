import { describe, expect, it } from "vitest";

import { hdiTier, rank, step, valueAt, type IndicatorData } from "../../src/model/indicators";

const data: IndicatorData = {
  firstYear: 2000,
  indicators: {
    hdi: {
      source: "",
      url: "",
      lastYear: 2003,
      values: { AAA: [0.5, 0.6, null, 0.81], BBB: [0.7, 0.7, 0.7, 0.7] },
    },
    income: {
      source: "",
      url: "",
      lastYear: 2009,
      maxAge: 4,
      values: { AAA: [100, 900, null, null, null, null, null, null, null, null] },
    },
    democracy: { source: "", url: "", lastYear: 2000, values: {} },
  },
};

describe("indicators", () => {
  it("uses the latest value up to the year, never a later one", () => {
    expect(valueAt(data, "hdi", "AAA", 2002)).toEqual({ value: 0.6, year: 2001 }); // 2002 is missing
    expect(valueAt(data, "hdi", "AAA", 2010)).toEqual({ value: 0.81, year: 2003 }); // past the last year
    expect(valueAt(data, "income", "BBB", 2001)).toBeNull();
    expect(valueAt(data, "income", "AAA", 2005)).toEqual({ value: 900, year: 2001 });
    expect(valueAt(data, "income", "AAA", 2006)).toBeNull(); // more than 4 years old
  });

  it("puts values in ten steps with inclusive lower bounds", () => {
    expect([0.549, 0.55, 0.7, 0.8, 0.99].map((v) => step("hdi", v))).toEqual([0, 1, 4, 6, 9]);
    // Brazil's democracy index: 0.69 (2019–2022) and 0.79 (2023) are now different colors.
    expect(step("democracy", 0.69)).not.toBe(step("democracy", 0.79));
    expect(hdiTier(0.786)).toBe("high");
    expect(hdiTier(0.806)).toBe("veryHigh");
  });

  it("ranks countries with data that year", () => {
    expect(rank(data, "hdi", "AAA", 2003)).toEqual([1, 2]);
    expect(rank(data, "hdi", "AAA", 2000)).toEqual([2, 2]);
  });
});
