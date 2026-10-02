import { describe, expect, it } from "vitest";

import { buildView, finalPoint, orderSeries, trackRecord } from "../../src/model/view";
import { defaultState } from "../../src/state";
import type { Poll } from "../../src/types";
import { dataset, race } from "./fixtures";

const data = dataset();
const polls: Poll[] = Array.from({ length: 12 }, (_, i) => ({
  p: i % 2 ? "Datafolha" : "Nexus",
  d: 200 + i * 5,
  v: { Lula: 40, Flávio: 35 + i * 0.2, undecided: 10 },
}));

describe("buildView", () => {
  it("ends the axis the day after the last poll while there is no result", () => {
    const view = buildView(data, race({ polls }), defaultState(data));
    expect(view.endDay).toBe(256);
    expect(view.firstDay).toBe(200);
    expect(view.order).toEqual(["Lula", "Flávio", "undecided"]);
    expect(finalPoint(view, "Lula")?.y).toBeCloseTo(40);
  });

  it("ends the axis on election day once there is a result", () => {
    const view = buildView(data, race({ polls, result: { Lula: 50 } }), defaultState(data));
    expect(view.endDay).toBe(276);
    expect(finalPoint(view, "Lula")).toBeNull(); // the line stops 20 days before
  });

  it("applies pollster and method filters", () => {
    const s = { ...defaultState(data), excludedMethods: new Set(["phone" as const]) };
    const view = buildView(data, race({ polls }), s);
    expect(new Set(view.polls.map((p) => p.p))).toEqual(new Set(["Datafolha"]));
  });
});

describe("orderSeries", () => {
  it("puts undecided last whatever its value", () => {
    const pt = (y: number) => [{ d: 0, y, lo: y, hi: y }];
    expect(orderSeries({ undecided: pt(60), A: pt(10), B: pt(30) })).toEqual(["B", "A", "undecided"]);
  });
});

describe("trackRecord", () => {
  it("averages past errors and lists pollsters without history last", () => {
    const rows = trackRecord(data, ["Nexus", "Novo", "Datafolha"]);
    expect(rows.map((r) => r.pollster)).toEqual(["Datafolha", "Nexus", "Novo"]);
    expect(rows[0]).toMatchObject({ rounds: 2, meanError: 1.5, marginError: 3 });
    expect(rows[2]).toMatchObject({ rounds: 0, meanError: null });
  });
});
