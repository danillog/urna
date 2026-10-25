import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { apuracaoFromSearch, apuracaoToSearch, defaultRound } from "../../src/ui/apuracao-view";
import {
  OFFICES,
  UFS,
  candidateColors,
  displayName,
  holdsSeat,
  lead,
  noChoice,
  noChoiceShare,
  num,
  parseTse,
  partyColor,
  seatsOf,
  started,
  sumTallies,
  trimCandidates,
  type ApOffice,
} from "../../src/model/apuracao";
import { SIM_SECONDS, simulate } from "../../src/model/apuracao-sim";

const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(__dirname, "../fixtures/tse", name), "utf8")) as unknown;

// Real TSE files: São Paulo's 2024 mayor race, finished, and the 2026
// presidential file for the whole country the day before the vote (all zeros).
const sp2024 = parseTse(fixture("sp71072-c0011-e000619-u.json"));
const br2026 = parseTse(fixture("br-c0001-e006257-u.json"));
// São Paulo's 2024 city council: proportional, like the deputies, and finished.
const council = parseTse(fixture("sp71072-c0013-e000619-u.json"));

describe("TSE results file", () => {
  it("reads numbers written with a decimal comma", () => {
    expect(num("45,12")).toBe(45.12);
    expect(num("100")).toBe(100);
    expect(num("")).toBe(0);
    expect(num(undefined)).toBe(0);
  });

  it("reads a finished count", () => {
    expect(sp2024.counted).toBe(100);
    expect(sp2024.totalizedAt).toBe("03/12/2024 10:21:35");
    expect(sp2024.valid).toBe(6108218);
    expect(sp2024.candidates.map((c) => c.name).slice(0, 3)).toEqual([
      "RICARDO NUNES",
      "GUILHERME BOULOS",
      "PABLO MARÇAL",
    ]);
    const nunes = sp2024.candidates[0]!;
    expect(nunes).toMatchObject({ number: "15", party: "MDB", votes: 1801139, status: "2º turno" });
    expect(nunes.share).toBeCloseTo(29.49, 2);
    expect(lead(sp2024)!.margin).toBeCloseTo(29.49 - 29.08, 1);
  });

  it("reads the 2026 file before the count starts", () => {
    expect(started(br2026)).toBe(false);
    expect(br2026.totalizedAt).toBeNull();
    expect(lead(br2026)).toBeNull();
    expect(br2026.candidates.map((c) => c.number)).toContain("13");
    expect(br2026.candidates.length).toBe(12);
  });

  it("adds places up", () => {
    const sum = sumTallies([sp2024, sp2024]);
    expect(sum.valid).toBe(2 * sp2024.valid);
    expect(sum.counted).toBe(100);
    expect(sum.candidates[0]!.votes).toBe(2 * 1801139);
    expect(sum.candidates[0]!.share).toBeCloseTo(sp2024.candidates[0]!.share, 6);
    expect(sum.turnout).toBeCloseTo(sp2024.turnout, 6);
  });
});

describe("candidate colors and names", () => {
  it("keeps the poll chart's colors and hands out stable spares", () => {
    const colors = candidateColors(br2026.candidates, { Lula: "red", Flávio: "blue", Cury: "gold" });
    expect(colors.PT).toBe("red");
    expect(colors.PL).toBe("blue"); // FLAVIO BOLSONARO, no accent at the TSE
    expect(colors.AVANTE).toBe("gold"); // ESCRITOR AUGUSTO CURY
    const spares = Object.entries(colors).filter(([p]) => !["PT", "PL", "AVANTE"].includes(p));
    expect(new Set(spares.map(([, c]) => c)).has("red")).toBe(false);
    // Same input in another order: same colors.
    expect(candidateColors([...br2026.candidates].reverse(), { Lula: "red" })).toEqual(
      candidateColors(br2026.candidates, { Lula: "red" }),
    );
  });

  it("writes ballot names in title case", () => {
    expect(displayName("ESCRITOR AUGUSTO CURY")).toBe("Escritor Augusto Cury");
    expect(displayName("TARCÍSIO DE FREITAS")).toBe("Tarcísio de Freitas");
  });
});

describe("simulated count", () => {
  it("starts empty, counts every state and ends at 100%", () => {
    expect(started(simulate("presidente", "r1", 0).br)).toBe(false);
    const half = simulate("presidente", "r1", SIM_SECONDS / 2);
    expect(half.br.counted).toBeGreaterThan(10);
    expect(half.br.counted).toBeLessThan(100);
    const end = simulate("presidente", "r1", SIM_SECONDS * 2);
    expect(end.br.counted).toBeCloseTo(100, 6);
    expect(Object.keys(end.uf).sort()).toEqual([...UFS].sort());
    const shares = end.br.candidates.reduce((a, c) => a + c.share, 0);
    expect(shares).toBeCloseTo(100, 0);
  });

  it("never counts backwards", () => {
    let last = 0;
    for (let s = 0; s <= SIM_SECONDS * 1.5; s += 3) {
      const counted = simulate("presidente", "r1", s).br.counted;
      expect(counted).toBeGreaterThanOrEqual(last);
      last = counted;
    }
  });

  it("has two candidates in the runoff", () => {
    expect(simulate("presidente", "r2", SIM_SECONDS).br.candidates.length).toBe(2);
  });
});

describe("proportional races", () => {
  it("reads party lists and seats", () => {
    expect(council.seats).toBe(55);
    expect(council.lists.reduce((n, l) => n + l.seats, 0)).toBe(55);
    const federation = council.lists.find((l) => l.name.includes("PT"))!;
    expect(federation.seats).toBe(9);
    // Nominal plus party-label votes: 717,280 + 135,013.
    expect(federation.votes).toBe(852293);
    expect(council.candidates.every((c) => c.list)).toBe(true);
  });

  it("projects the same seats and the same people as the official result", () => {
    for (const l of council.lists) expect([l.name, l.projected]).toEqual([l.name, l.seats]);
    const official = council.candidates.filter((c) => /^Eleito/.test(c.status)).map((c) => c.number);
    const projected = council.candidates.filter((c) => c.projected).map((c) => c.number);
    expect(projected.sort()).toEqual(official.sort());
    expect(official.length).toBe(55);
  });

  it("uses the TSE's seats once published, the projection before", () => {
    expect(seatsOf(council).official).toBe(true);
    const counting = { ...council, lists: council.lists.map((l) => ({ ...l, seats: 0 })) };
    expect(seatsOf(counting).official).toBe(false);
    const elected = council.candidates.find((c) => c.status === "Eleito por média")!;
    expect(holdsSeat(council, elected)).toBe(true);
    expect(holdsSeat(counting, elected)).toBe(true); // projected too
  });

  it("sends only who holds a seat and a few more", () => {
    const trimmed = trimCandidates(council);
    expect(trimmed.candidates.length).toBeLessThan(80);
    expect(trimmed.candidates.filter((c) => /^Eleito/.test(c.status)).length).toBe(55);
  });

  it("colors parties and federations by the party map", () => {
    const lineages = { PT: { color: "red" as const }, PL: { color: "blue" as const } };
    expect(partyColor("PL", lineages)).toBe("blue");
    expect(partyColor("PC do B / PT / PV", lineages)).toBe("red");
    expect(partyColor("NOVO", lineages)).toBe("gray");
  });
});

describe("simulated count, every office", () => {
  for (const office of Object.keys(OFFICES) as ApOffice[]) {
    it(office, () => {
      const end = simulate(office, "r1", SIM_SECONDS * 2, "MG");
      expect(end.br.counted).toBeCloseTo(100, 6);
      if (OFFICES[office].proportional) {
        expect(Object.keys(end.uf)).toEqual(["MG"]);
        const seats = end.br.lists.reduce((n, l) => n + l.projected, 0);
        expect(seats).toBe(office === "deputado-federal" ? 53 : 77);
      } else {
        expect(Object.keys(end.uf).length).toBe(27);
        expect(end.uf.MG!.seats).toBe(office === "senador" ? 2 : 1);
      }
    });
  }
});

describe("who chose no one", () => {
  it("counts null and blank votes and abstention, as the TSE does", () => {
    // São Paulo, mayor, 2024: 6,773,587 voted of 9,322,444; 241,734 blank, 422,802 null and 833
    // for annulled candidates.
    const n = noChoice(sp2024);
    expect(n).toEqual({ cast: 6773587, blank: 241734, nulls: 423635, absent: 2548857, electorate: 9322444 });
    expect(noChoiceShare(n, "nulls")).toBeCloseTo(6.254, 3);
    expect(noChoiceShare(n, "absent")).toBeCloseTo(27.34, 2);
    // A Worker answer without the abstention count: worked out from the turnout.
    const old = noChoice({ ...sp2024, absent: undefined });
    expect(Math.abs(old.absent - 2548857)).toBeLessThan(500);
    // Before the count starts there is nothing to share.
    expect(noChoiceShare(noChoice(br2026), "nulls")).toBeNull();
  });
});

describe("the round the tab opens on", () => {
  it("is the runoff from the day after the 1st round, by Brasília's calendar", () => {
    // 4 Oct, 23:30 in Brasília is already 5 Oct in UTC: still the 1st round's night.
    expect(defaultRound("2026-10-04", new Date("2026-10-05T02:30:00Z"))).toBe("r1");
    expect(defaultRound("2026-10-04", new Date("2026-10-05T03:30:00Z"))).toBe("r2");
    expect(defaultRound("2026-10-04", new Date("2026-09-30T12:00:00Z"))).toBe("r1");
    expect(defaultRound(undefined)).toBe("r1");
  });

  it("gives way to the round a link names, and always writes it back", () => {
    const named = apuracaoFromSearch(new URLSearchParams("round=r1"), "r2").state;
    expect(named.round).toBe("r1");
    expect(apuracaoFromSearch(new URLSearchParams(), "r2").state.round).toBe("r2");
    const params = new URLSearchParams();
    apuracaoToSearch(named, "live", params);
    expect(params.get("round")).toBe("r1");
    // Senators have no runoff: the round is neither read nor written.
    const senate = apuracaoFromSearch(new URLSearchParams("cargo=senador"), "r2").state;
    expect(senate.round).toBe("r1");
    const none = new URLSearchParams();
    apuracaoToSearch(senate, "live", none);
    expect(none.has("round")).toBe(false);
  });
});
