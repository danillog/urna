import { describe, expect, it } from "vitest";

import { defaultState, fromSearch, normalize, toSearch, withRace } from "../../src/state";
import { dataset } from "./fixtures";

const data = dataset();

describe("URL state", () => {
  it("defaults to the latest presidential first round", () => {
    expect(fromSearch(data, "")).toEqual(defaultState(data));
    expect(toSearch(data, defaultState(data))).toBe("");
  });

  it("round-trips a state race with excluded pollsters", () => {
    const s = fromSearch(data, "?office=governor&uf=sp&round=r2&exclude=Gerp,Palver");
    expect(s).toMatchObject({ office: "governor", uf: "SP", round: "r2" });
    expect([...s.excludedPollsters]).toEqual(["Gerp", "Palver"]);
    expect(toSearch(data, s)).toBe("?office=governor&uf=SP&round=r2&exclude=Gerp,Palver");
  });

  it("keeps the year only for past presidential elections", () => {
    expect(toSearch(data, fromSearch(data, "?year=2022&round=r2"))).toBe("?year=2022&round=r2");
  });

  it("round-trips the chart's zoom and keeps it across races", () => {
    const s = fromSearch(data, "?dias=30");
    expect(s.zoomDays).toBe(30);
    expect(toSearch(data, s)).toBe("?dias=30");
    expect(withRace(data, s, { round: "r2" }).zoomDays).toBe(30);
  });

  it("round-trips the record-weighted average and keeps it across races", () => {
    const s = fromSearch(data, "?peso=historico");
    expect(s.weighByRecord).toBe(true);
    expect(toSearch(data, s)).toBe("?peso=historico");
    expect(withRace(data, s, { round: "r2" }).weighByRecord).toBe(true);
    expect(fromSearch(data, "?peso=qualquer").weighByRecord).toBe(false);
  });

  it("ignores invalid values", () => {
    expect(fromSearch(data, "?office=mayor&year=1989&uf=XX&round=r9&dias=7")).toEqual(defaultState(data));
  });

  it("falls back to the first round when the runoff does not exist", () => {
    expect(fromSearch(data, "?office=senate&uf=SP&round=r2").round).toBe("r1");
    expect(fromSearch(data, "?office=governor&uf=RR&round=r2").round).toBe("r1");
  });
});

describe("withRace", () => {
  it("resets filters when the race changes", () => {
    const s = { ...defaultState(data), excludedPollsters: new Set(["Gerp"]), highlight: "Gerp" };
    const next = withRace(data, s, { year: "2022" });
    expect(next.year).toBe("2022");
    expect(next.excludedPollsters.size).toBe(0);
    expect(next.highlight).toBeNull();
  });

  it("state races always use the latest year", () => {
    const s = normalize(data, { ...defaultState(data), office: "governor", year: "2022" });
    expect(s.year).toBe("2026");
  });
});
