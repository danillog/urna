import { describe, expect, it } from "vitest";

import {
  buildView,
  finalPoint,
  orderSeries,
  recordWeights,
  trackRecord,
  zoomStart,
} from "../../src/model/view";
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

  it("fits a runoff's campaign apart from the hypothetical polls before the 1st round", () => {
    const at = (d: number, flavio: number): Poll => ({
      p: d % 2 ? "Datafolha" : "Nexus",
      d,
      v: { Lula: 45, Flávio: flavio, undecided: 10 },
    });
    const before = Array.from({ length: 30 }, (_, i) => at(100 + i * 6, 40));
    const after = Array.from({ length: 8 }, (_, i) => at(279 + i * 2, 48 - i * 0.25));
    const s = { ...defaultState(data), round: "r2" as const };
    const view = buildView(data, race({ date: "2026-10-25", polls: [...before, ...after] }), s);
    expect(view.breakDay).toBe(277); // the 1st round is day 276
    const flavio = view.trends["Flávio"]!;
    expect(flavio.find((p) => p.d === 270)?.y).toBeCloseTo(40);
    // One line through both would bend upward at the jump and keep rising to the end.
    expect(finalPoint(view, "Flávio")!.y).toBeLessThan(47);
    expect(flavio.find((p) => p.d === 277)!.y).toBeGreaterThan(47); // no ramp up from 40
  });

  it("zooms to the last days only when the race is longer than that", () => {
    // Polls from day 200 to 255: the axis ends on day 256.
    expect(zoomStart(race({ polls }), 30)).toBe(226);
    expect(zoomStart(race({ polls }), 90)).toBeNull();
    expect(zoomStart(race({ polls }), null)).toBeNull();
    const s = { ...defaultState(data), zoomDays: 30 };
    const view = buildView(data, race({ polls }), s);
    expect(view.zoomFrom).toBe(226);
    // The average still uses every poll: the same line as without the zoom.
    const full = buildView(data, race({ polls }), defaultState(data));
    expect(view.trends).toEqual(full.trends);
  });

  it("applies pollster and method filters", () => {
    const s = { ...defaultState(data), excludedMethods: new Set(["phone" as const]) };
    const view = buildView(data, race({ polls }), s);
    expect(new Set(view.polls.map((p) => p.p))).toEqual(new Set(["Datafolha"]));
  });
});

describe("recordWeights", () => {
  it("uses only the rounds before the race, pulled toward everyone's average error", () => {
    // Before the 2026 runoff: Datafolha missed the margin by 4 and 2, Nexus by 1; everyone, 7/3.
    const runoff = recordWeights(data, race({ date: "2026-10-25" }));
    expect(runoff.get("Datafolha")).toBeCloseTo(7 / 3 / ((6 + (2 * 7) / 3) / 4));
    expect(runoff.get("Nexus")).toBeCloseTo(7 / 3 / ((1 + (2 * 7) / 3) / 3));
    expect(runoff.has("Gerp")).toBe(false); // no record: weight 1
    // Before the 2022 runoff only its 1st round counts; before the 2022 1st round, nothing.
    expect(recordWeights(data, race({ date: "2022-10-30" })).get("Datafolha")).toBeCloseTo(2.5 / 3);
    expect(recordWeights(data, race({ date: "2022-10-02" })).size).toBe(0);
  });

  it("moves the average toward the pollsters with the better record only when asked", () => {
    const split: Poll[] = Array.from({ length: 12 }, (_, i) => ({
      p: i % 2 ? "Datafolha" : "Nexus",
      d: 200 + i * 5,
      v: { Lula: i % 2 ? 40 : 50, Flávio: 40, undecided: 10 },
    }));
    const r = race({ date: "2026-10-25", polls: split });
    const mean = (weighByRecord: boolean) => {
      const line = buildView(data, r, { ...defaultState(data), weighByRecord }).trends["Lula"]!;
      return line.reduce((sum, pt) => sum + pt.y, 0) / line.length;
    };
    expect(mean(false)).toBeCloseTo(45, 0);
    expect(mean(true)).toBeGreaterThan(mean(false) + 0.5); // Nexus (50) has the better record
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
