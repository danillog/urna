import { describe, expect, it } from "vitest";

import profiles from "../../data/generated/profiles.json";
import raw from "../../data/generated/watch.json";
import {
  houseMedians,
  median,
  memberKey,
  search,
  top,
  type WatchData,
  type WatchMember,
} from "../../src/model/watch";
import { watchFromSearch } from "../../src/ui/watch-view";

const data = raw as WatchData;

const member = (name: string, perMonth: number | null, pct: number | null, capPct?: number): WatchMember => ({
  name,
  party: "X",
  uf: "SP",
  url: "",
  spend:
    perMonth === null
      ? null
      : { total: perMonth * 10, months: 10, perMonth, ...(capPct === undefined ? {} : { capPct }) },
  presence: pct === null ? null : { attended: pct, held: 100, pct, of: "sessões" },
});

describe("watch", () => {
  it("ranks by share of the state's ceiling where known, and leaves out who has no number", () => {
    const ms = [member("Ana", 40000, 90, 95), member("Bia", 45000, 50, 80), member("Caio", null, null)];
    expect(top(ms, "spendMost").map((m) => m.name)).toEqual(["Ana", "Bia"]);
    expect(top(ms, "spendLeast").map((m) => m.name)).toEqual(["Bia", "Ana"]);
    expect(top(ms, "presentLeast").map((m) => m.name)).toEqual(["Bia", "Ana"]);
    expect(top(ms, "presentMost", 1).map((m) => m.name)).toEqual(["Ana"]);
  });

  it("reads medians and finds people by name without accents", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    const ms = [member("José Antônio", 10, 80), member("Maria", 20, 90)];
    expect(houseMedians(ms)).toEqual({ perMonth: 15, capPct: null, presence: 85 });
    expect(search(ms, "jose antonio").map((m) => m.name)).toEqual(["José Antônio"]);
    expect(memberKey(ms[0]!)).toBe("jose-antonio");
  });

  it("covers the four houses, with keys that identify one member each", () => {
    expect(Object.keys(data.houses).sort()).toEqual(["alesp", "camara", "cmsp", "senado"]);
    expect(data.houses.camara!.members).toHaveLength(513);
    expect(data.houses.senado!.members.length).toBeGreaterThanOrEqual(81);
    for (const h of Object.values(data.houses)) {
      expect(top(h.members, "spendMost")).toHaveLength(10);
      expect(top(h.members, "presentLeast")).toHaveLength(10);
      const keys = h.members.map(memberKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("links both ways with the Eleitos 2026 tab", () => {
    const ids = new Set((profiles as { people: { id: string }[] }).people.map((p) => p.id));
    const linked = Object.values(data.houses).flatMap((h) => h.members.filter((m) => m.profile));
    expect(linked.length).toBeGreaterThan(300);
    for (const m of linked) expect(ids.has(m.profile!)).toBe(true);
    // A profile's link carries the member's code in the house.
    const senator = data.houses.senado!.members.find((m) => m.id)!;
    const s = watchFromSearch(data, new URLSearchParams({ casa: "senado", id: senator.id! }));
    expect(s).toEqual({ house: "senado", uf: null, person: memberKey(senator) });
  });
});
