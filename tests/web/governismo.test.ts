import { describe, expect, it } from "vitest";

import raw from "../../data/generated/governismo.json";
import { pattern, stance, stances, type GovernismoData } from "../../src/model/governismo";

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
});
