import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildView, errorScenarios, finalAverage, partyKey, pastError } from "../../src/model/view";
import { defaultState } from "../../src/state";
import type { Dataset } from "../../src/types";

const data = JSON.parse(readFileSync("data/generated/elections.json", "utf-8")) as Dataset;

describe("finalAverage", () => {
  it("gives each finalist's final average in valid votes, by party", () => {
    const base = defaultState(data);
    const r2 = finalAverage(data, data.presidential["2026"]!.rounds.r2!, { ...base, round: "r2" })!;
    expect(Object.keys(r2.byParty).sort()).toEqual(["PL", "PT"]);
    // Two candidates in valid votes add up to about 100 (each line is smoothed on its own).
    expect(r2.byParty.PL! + r2.byParty.PT!).toBeGreaterThan(98);
    expect(r2.byParty.PL! + r2.byParty.PT!).toBeLessThan(102);
  });

  it("stops on the eve of a race with a result, as the comparison table does", () => {
    const race = data.presidential["2026"]!.rounds.r1!;
    const r1 = finalAverage(data, race, defaultState(data))!;
    expect(r1.day).toBe(race.electionDay - 1);
    expect(r1.byParty.PL).toBeCloseTo(43.7, 0);
    expect(r1.byParty.PT).toBeCloseTo(45.0, 0);
  });

  it("matches the TSE's spelling of a party", () => {
    expect(partyKey("Republicanos")).toBe(partyKey("REPUBLICANOS"));
    expect(partyKey("União")).toBe("UNIAO");
  });
});

describe("errorScenarios", () => {
  const runoff = { ...defaultState(data), round: "r2" as const };

  it("measures each past miss on the margin between the top two, in valid votes", () => {
    // 2022 runoff: the average had Lula about 4 points ahead; he won by 1.8.
    const e2022 = pastError(data, "2022", "r2", runoff)!;
    expect(e2022.underestimated).toBe("Bolsonaro");
    expect(e2022.size).toBeGreaterThan(1);
    expect(e2022.size).toBeLessThan(4);
    expect(pastError(data, "2026", "r2", runoff)).toBeNull(); // no result yet
  });

  it("puts today's runoff against earlier runoffs and this year's 1st round", () => {
    const race = data.presidential["2026"]!.rounds.r2!;
    const scenarios = errorScenarios(data, buildView(data, race, runoff), runoff)!;
    expect(new Set([scenarios.leader, scenarios.runnerUp])).toEqual(new Set(["Lula", "Flávio"]));
    expect(scenarios.margin).toBeGreaterThanOrEqual(0);
    const rounds = scenarios.errors.map((e) => `${e.year}-${e.round}`);
    expect(rounds).toContain("2022-r2");
    expect(rounds).toContain("2026-r1");
    expect(rounds).not.toContain("2022-r1");
    expect(rounds.every((r) => r.endsWith("r2") || r === "2026-r1")).toBe(true);
  });

  it("is only for presidential races still waiting for their result", () => {
    const past = { ...defaultState(data), year: "2022", round: "r2" as const };
    const race = data.presidential["2022"]!.rounds.r2!;
    expect(errorScenarios(data, buildView(data, race, past), past)).toBeNull();
  });
});
