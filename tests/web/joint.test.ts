import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { decodeCensusVote, type EncodedCensusVote } from "../../src/model/census-vote";
import { jointFit, solve, wls } from "../../src/model/joint";
import type { MunicipalMap } from "../../src/types";

describe("joint fit", () => {
  it("solves a small system", () => {
    const x = solve(
      [
        [2, 1],
        [1, 3],
      ],
      [3, 5],
    )!;
    expect(x[0]).toBeCloseTo(0.8);
    expect(x[1]).toBeCloseTo(1.4);
    expect(solve([[0]], [1])).toBeNull();
  });

  it("recovers known coefficients, and weights count", () => {
    // y = 10 + 2·a − 3·b exactly: the fit finds it, R² 1.
    const rows = [];
    for (let a = 0; a < 5; a++)
      for (let b = 0; b < 4; b++) rows.push({ x: [a, b], y: 10 + 2 * a - 3 * b, w: 1 + a });
    const fit = wls(rows)!;
    expect(fit.beta[0]).toBeCloseTo(10);
    expect(fit.beta[1]).toBeCloseTo(2);
    expect(fit.beta[2]).toBeCloseTo(-3);
    expect(fit.r2).toBeCloseTo(1);
    // Two points far apart in weight pull a one-variable fit toward the heavy one.
    const pulled = wls([
      { x: [0], y: 0, w: 1 },
      { x: [1], y: 1, w: 1 },
      { x: [1], y: 3, w: 100 },
    ])!;
    expect(pulled.beta[1]).toBeGreaterThan(2.5);
  });

  it("separates a variable from what comes with it", () => {
    // The vote follows b only; a goes with b. Alone, a looks strong; with b held, it is nothing.
    const rows = [];
    for (let i = 0; i < 50; i++) {
      const b = i % 10;
      const a = b + (i % 3);
      rows.push({ x: [a, b], y: 5 * b, w: 1 });
    }
    const joint = wls(rows)!;
    const alone = wls(rows.map((r) => ({ x: [r.x[0]!], y: r.y, w: 1 })))!;
    expect(alone.beta[1]).toBeGreaterThan(3);
    expect(joint.beta[1]).toBeCloseTo(0);
    expect(joint.beta[2]).toBeCloseTo(5);
  });

  it("fits the real 2022 election, region by region", () => {
    const read = (f: string) =>
      JSON.parse(readFileSync(resolve(__dirname, "../../data/generated", f), "utf8"));
    const data = decodeCensusVote(read("census-vote.json") as EncodedCensusVote);
    const map = read("map.json") as MunicipalMap;
    const e = data.elections.find((x) => x.year === 2022)!;
    const fit = jointFit(data, e, "pt", (i) => map.municipalities.uf[i]!)!;
    expect(fit.places).toBeGreaterThan(5000);
    expect(fit.r2).toBeGreaterThan(0.5);
    // Lula did better in the Northeast than in the Southeast, other things equal.
    expect(fit.regions.find((r) => r.region === "NE")!.joint).toBeGreaterThan(5);
    for (const r of fit.terms) expect(Number.isFinite(r.joint) && Number.isFinite(r.alone)).toBe(true);
  });
});
