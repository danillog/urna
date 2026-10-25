import { describe, expect, it } from "vitest";

import raw from "../../data/generated/governismo.json";
import {
  measuredBase,
  measuredCentrao,
  pattern,
  stance,
  stances,
  termAfter,
  type GovernismoData,
} from "../../src/model/governismo";

const data = raw as GovernismoData;

describe("governismo", () => {
  it("reads shares against the thresholds", () => {
    const t = { base: 70, opposition: 40 };
    expect([stance(85, t), stance(55, t), stance(20, t)]).toEqual(["base", "independent", "opposition"]);
  });

  it("finds the Centrão's mark and the side-switchers in the real data", () => {
    // PP: with every government, left and right.
    expect(pattern(stances(data, "PP"))).toBe("always-base");
    // PT: base of its own governments, opposition to Temer and Bolsonaro.
    expect(pattern(stances(data, "PT"))).toBe("switches");
    expect(stances(data, "PT").find((r) => r.term.key === "bolsonaro")!.stance).toBe("opposition");
  });

  it("reads the Senate apart, from 2019 on", () => {
    const pl = stances(data, "PL", "senate");
    expect(pl.map((r) => r.term.key)).toEqual(["bolsonaro", "lula3"]);
    expect(pl[0]!.stance).toBe("base");
    expect(pl[1]!.stance).toBe("opposition");
    expect(stances(data, "PT", "senate").find((r) => r.term.key === "lula3")!.stance).toBe("base");
  });

  it("measures the base of the term that followed an election", () => {
    expect(termAfter(data, 2022)!.key).toBe("lula3");
    expect(termAfter(data, 2018)!.key).toBe("bolsonaro");
    expect(termAfter(data, 2026)).toBeNull(); // not begun
    const lula3 = measuredBase(data, 2022, "chamber")!;
    expect(lula3.lineages.has("PT")).toBe(true);
    expect(lula3.lineages.has("PL")).toBe(false);
    expect(measuredBase(data, 2018, "senate")!.lineages.has("PL")).toBe(true);
    expect(measuredBase(data, 2026, "chamber")).toBeNull();
  });

  it("measures the Centrão: with PT and non-PT governments alike", () => {
    const centrao = measuredCentrao(data);
    expect(centrao.has("PP")).toBe(true);
    expect(centrao.has("PT")).toBe(false); // with its own governments only
    expect(centrao.has("PSOL")).toBe(false);
  });
});
