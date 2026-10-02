import { describe, expect, it } from "vitest";

import { MapData, NONE, margin, parseKey, raceKey, shade, winsByGroup } from "../../src/model/map-data";
import type { MunicipalMap } from "../../src/types";
import { normalizeMapState } from "../../src/ui/map-view";

const b64 = (arr: ArrayBufferView) => btoa(String.fromCharCode(...new Uint8Array(arr.buffer)));

const map = {
  municipalities: { names: ["A", "B", "C", "D"], uf: ["SP", "SP", "RJ", "RJ"] },
  lineages: { UNIÃO: { color: "cyan" }, PT: { color: "red" } },
  topology: {} as MunicipalMap["topology"],
  races: {
    "mayor-2000": {
      labels: ["PFL", "PT", "PSOL"],
      lineages: ["UNIÃO", "PT", "others"],
      winner: b64(new Uint8Array([0, 1, 2, NONE])),
      winnerShare: b64(new Uint16Array([510, 700, 600, 0])),
      second: b64(new Uint8Array([1, 0, NONE, NONE])),
      secondShare: b64(new Uint16Array([490, 300, 0, 0])),
      votes: b64(new Uint32Array([100, 200, 300, 0])),
      mayors: "Ana\nBia\nCaio\n",
    },
    "president-1994-r1": {
      labels: ["FHC", "Lula"],
      colors: { FHC: "blue", Lula: "red" },
      winner: b64(new Uint8Array([0, 0, 1, 0])),
      winnerShare: b64(new Uint16Array([600, 500, 450, 700])),
      second: b64(new Uint8Array([1, 1, 0, 1])),
      secondShare: b64(new Uint16Array([300, 450, 400, 200])),
      votes: b64(new Uint32Array([1, 2, 3, 4])),
    },
    "president-2002-r1": {} as never,
    "president-2002-r2": {} as never,
  },
} as unknown as MunicipalMap;

describe("map data", () => {
  const data = new MapData(map);

  it("lists elections per office", () => {
    expect(data.years("president")).toEqual([1994, 2002]);
    expect(data.years("mayor")).toEqual([2000]);
    expect(data.rounds(2002)).toEqual(["r1", "r2"]);
    expect(raceKey("mayor", 2000, "r2")).toBe("mayor-2000");
    expect(parseKey("president-2002-r2")).toEqual({ office: "president", year: 2002, round: "r2" });
  });

  it("decodes typed arrays", () => {
    const race = data.race("mayor-2000")!;
    expect([...race.winnerShare]).toEqual([510, 700, 600, 0]);
    expect([...race.votes]).toEqual([100, 200, 300, 0]);
    expect(race.mayors).toEqual(["Ana", "Bia", "Caio", ""]);
    expect(race.groupColors["UNIÃO"]).toBe("cyan");
    expect(margin(race, 0)).toBe(2);
  });

  it("counts wins per color group, others last", () => {
    expect(winsByGroup(data.race("mayor-2000")!)).toEqual([
      { group: "UNIÃO", label: "PFL", wins: 1 },
      { group: "PT", label: "PT", wins: 1 },
      { group: "others", label: "PSOL", wins: 1 },
    ]);
    expect(winsByGroup(data.race("president-1994-r1")!)[0]).toEqual({ group: "FHC", label: "FHC", wins: 3 });
  });

  it("shades by margin steps", () => {
    expect([0, 4.9, 5, 14.9, 15, 29.9, 30, 80].map(shade)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it("moves to the nearest election when switching office", () => {
    const s = normalizeMapState(data, { office: "president", year: 2000, round: "r2", focus: null });
    expect(s.year).toBe(2002);
    expect(s.round).toBe("r2");
    expect(normalizeMapState(data, { ...s, year: 1994 }).round).toBe("r1"); // no runoff in 1994
  });
});
