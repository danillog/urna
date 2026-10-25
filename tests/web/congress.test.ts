import { describe, expect, it } from "vitest";

import congress from "../../data/generated/congress.json";
import {
  focusSeats,
  hemicycle,
  history,
  inFocus,
  seatsByGroup,
  type CongressData,
  selectedSeats,
  type CongressParty,
  type CongressElection,
} from "../../src/model/congress";

const data = congress as unknown as CongressData;

describe("hemicycle", () => {
  it("draws every seat without overlaps, parties as wedges from left to right", () => {
    for (const parts of [[513], [81], [503], [3], [300, 213], [40, 41]]) {
      const { seats, radius } = hemicycle(parts);
      expect(seats.length).toBe(parts.reduce((a, b) => a + b, 0));
      let closest = Infinity;
      for (let i = 0; i < seats.length; i++)
        for (let j = i + 1; j < seats.length; j++)
          closest = Math.min(closest, Math.hypot(seats[i]!.x - seats[j]!.x, seats[i]!.y - seats[j]!.y));
      if (seats.length > 1) expect(closest).toBeGreaterThan(2 * radius);
      // Every seat of the first party lies left of every seat of the second.
      if (parts.length === 2) {
        const angle = (s: { x: number; y: number }) => Math.atan2(s.y, s.x);
        const first = seats.filter((s) => s.party === 0).map(angle);
        const second = seats.filter((s) => s.party === 1).map(angle);
        expect(Math.min(...first)).toBeGreaterThanOrEqual(Math.max(...second));
      }
    }
  });

  it("is empty for an empty house", () => {
    expect(hemicycle([]).seats).toEqual([]);
  });
});

describe("congress data", () => {
  it("fills each house in every election", () => {
    for (const e of data.houses.chamber) expect(e.total).toBe(e.year === 1990 ? 503 : 513);
    for (const e of data.houses.senate) expect(e.total).toBe(81);
    const e = data.houses.chamber.at(-1)!;
    const groups = seatsByGroup(e);
    expect(Object.values(groups).reduce((a, b) => a + b, 0)).toBe(e.total);
  });

  it("follows a party through renames", () => {
    const line = history(data.houses.chamber, "DEM").map((p) => p?.party ?? null);
    expect(line.slice(0, 5)).toEqual(["PFL", "PFL", "PFL", "PFL", "PFL"]);
    expect(line[5]).toBe("DEM");
  });
});

describe("legend selection", () => {
  const e2022 = data.houses.chamber.find((e) => e.year === 2022)!;

  it("joins the groups selected, counting each party once", () => {
    const groups = seatsByGroup(e2022);
    expect(focusSeats(e2022, [])).toBe(0);
    expect(focusSeats(e2022, ["left", "right"])).toBe(groups.left + groups.right);
    // The Centrão overlaps the right: selecting both does not count PP twice.
    const centrao = focusSeats(e2022, ["centrao"]);
    const overlap = e2022.parties
      .filter((p) => p.centrao && p.group === "right")
      .reduce((n, p) => n + p.seats, 0);
    expect(focusSeats(e2022, ["right", "centrao"])).toBe(groups.right + centrao - overlap);
  });

  it("matches a party by its group or its Centrão mark", () => {
    const pp = e2022.parties.find((p) => p.party === "PP")!;
    const pt = e2022.parties.find((p) => p.party === "PT")!;
    expect(inFocus(pp, ["centrao"])).toBe(true);
    expect(inFocus(pt, ["centrao"])).toBe(false);
    expect(inFocus(pt, ["left"])).toBe(true);
  });
});

describe("newcomers", () => {
  const party = (seats: number, newcomers: number, group: CongressParty["group"]) =>
    ({ party: "X", lineage: "X", seats, newcomers, group, centrao: false }) as CongressParty;

  it("selects a party's newcomers as seats, and the whole party when its group is on", () => {
    const left = party(10, 4, "left");
    const right = party(20, 7, "right");
    expect(selectedSeats(left, ["newcomers"])).toBe(4);
    expect(selectedSeats(left, ["left", "newcomers"])).toBe(10); // the whole party, once
    const e = { year: 2026, total: 30, parties: [left, right] } as CongressElection;
    expect(focusSeats(e, ["newcomers"])).toBe(11);
    expect(focusSeats(e, ["right", "newcomers"])).toBe(24);
  });
});

describe("the address", () => {
  it("opens the legislature in office for today's benches, not the one just elected", async () => {
    const { congressFromSearch, congressToSearch } = await import("../../src/ui/congress-view");
    const s = congressFromSearch(data, new URLSearchParams("bancada=hoje"));
    expect(s.moment).toBe("now");
    expect(s.year).toBe(2022);
    // Without "hoje", the latest election; with a year asked, that year.
    expect(congressFromSearch(data, new URLSearchParams()).year).toBe(2026);
    expect(congressFromSearch(data, new URLSearchParams("bancada=hoje&ano=2018")).year).toBe(2018);
    const back = new URLSearchParams();
    congressToSearch(s, data, back);
    expect(back.toString()).toBe("ano=2022&bancada=hoje");
  });
});
