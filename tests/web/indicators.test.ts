import { describe, expect, it } from "vitest";

import {
  colorStep,
  firstDataYear,
  hdiTier,
  officialAt,
  paintAt,
  rank,
  stateSeries,
  step,
  valueAt,
  type IndicatorData,
} from "../../src/model/indicators";

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
    poverty: { source: "", url: "", lastYear: 2000, values: { AAA: [40], BBB: [8] } },
    food: {
      source: "",
      url: "",
      lastYear: 2003,
      values: { AAA: [null, null, 12.5, 11], BBB: [null, null, null, 30] },
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

  it("uses a region's own series when there is one", () => {
    const withRegions: IndicatorData = {
      ...data,
      indicators: {
        ...data.indicators,
        hdi: { ...data.indicators.hdi, regions: { "AA-1": [0.9, null, null, null] } },
      },
    };
    expect(valueAt(withRegions, "hdi", "AAA", 2003, "AA-1")).toEqual({ value: 0.9, year: 2000 });
    expect(valueAt(withRegions, "hdi", "AAA", 2003, "AA-2")).toEqual({ value: 0.81, year: 2003 });
  });

  it("ranks countries with data that year", () => {
    expect(rank(data, "hdi", "AAA", 2003)).toEqual([1, 2]);
    expect(rank(data, "hdi", "AAA", 2000)).toEqual([2, 2]);
    // Less poverty ranks first.
    expect(rank(data, "poverty", "BBB", 2000)).toEqual([1, 2]);
  });

  it("runs the colors the other way where less is better", () => {
    expect(colorStep("hdi", step("hdi", 0.99))).toBe(9);
    expect(colorStep("poverty", step("poverty", 2))).toBe(9); // under 5%: the light end
    expect(colorStep("poverty", step("poverty", 70))).toBe(0);
  });

  it("paints a fallback survey, marked, only where the main series is blank and within its age", () => {
    const poverty: IndicatorData = {
      ...data,
      indicators: {
        ...data.indicators,
        poverty: {
          source: "",
          url: "",
          lastYear: 2010,
          maxAge: 4,
          values: { AAA: [40, null, null, null, null, null, null, null, null, null, null] },
          fallbackMaxAge: 10,
          fallback: {
            AAA: [{ year: 2000, value: 40, welfare: "income" }],
            JAM: [{ year: 2004, value: 30, welfare: "consumption" }],
          },
          officialByRegion: { "US-MS": [20, 19, null] },
        },
      },
    };
    expect(paintAt(poverty, "poverty", "AAA", 2003)).toEqual({ value: 40, year: 2000 }); // main
    expect(paintAt(poverty, "poverty", "AAA", 2006)).toEqual({ value: 40, year: 2000, fallback: "income" });
    expect(paintAt(poverty, "poverty", "JAM", 2003)).toBeNull(); // before its survey
    expect(paintAt(poverty, "poverty", "JAM", 2014)).toEqual({
      value: 30,
      year: 2004,
      fallback: "consumption",
    });
    expect(paintAt(poverty, "poverty", "JAM", 2015)).toBeNull(); // more than 10 years old
    // Rankings keep to the main series.
    expect(valueAt(poverty, "poverty", "JAM", 2010)).toBeNull();
    expect(officialAt(poverty, "poverty", "US-MS", 2026)).toEqual({ value: 19, year: 2001 });
    expect(officialAt(poverty, "poverty", "US-CA", 2026)).toBeNull();
  });

  it("food: starts late, ranks less insecurity first, and gives states on their own scale", () => {
    expect(firstDataYear(data, "food")).toBe(2002);
    expect(firstDataYear(data, "democracy")).toBeNull();
    expect(valueAt(data, "food", "AAA", 2001)).toBeNull(); // before FAO's first period
    expect(rank(data, "food", "AAA", 2003)).toEqual([1, 2]);
    expect(colorStep("food", step("food", 3))).toBe(9); // under 5%: the light end
    const states: IndicatorData = {
      ...data,
      indicators: {
        ...data.indicators,
        food: {
          ...data.indicators.food,
          usStates: {
            source: "",
            url: "",
            periods: ["2012–2014", "2019–2021", "2022–2024"],
            values: { "US-AR": [19.9, 15, 19.4] },
          },
          brStates: {
            source: "",
            url: "",
            years: [2004, 2023, 2024],
            values: { "BR-PA": [null, 20.4, 17.1] },
          },
        },
      },
    };
    expect(stateSeries(states, "food", "US-AR").at(-1)).toEqual({ period: "2022–2024", value: 19.4 });
    expect(stateSeries(states, "food", "BR-PA")).toEqual([
      { period: "2023", value: 20.4 },
      { period: "2024", value: 17.1 },
    ]);
    expect(stateSeries(states, "food", "MX-JAL")).toEqual([]);
  });
});
