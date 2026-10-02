import { describe, expect, it } from "vitest";

import { countByFamily, electionAt, familyAt, lastYear, type AmericasData } from "../../src/model/americas";

const data: AmericasData = {
  families: ["left", "centre-left", "centre-right", "right"],
  countries: {
    AAA: {
      name: "A",
      system: "presidential",
      elections: [
        { date: "2002-05-01", article: "a1", winner: "X", family: "right" },
        { date: "2006-11-01", article: "a2", winner: "Y", family: "left" },
        { date: "2010-03-01", article: "a3", status: "annulled" },
      ],
    },
    BBB: { name: "B", system: "non-competitive", elections: [] },
  },
  territories: {},
};

describe("americas model", () => {
  it("shows the latest election held by the end of the year", () => {
    const a = data.countries.AAA!;
    expect(electionAt(a, 2001)).toBeNull();
    expect(electionAt(a, 2005)?.article).toBe("a1");
    expect(electionAt(a, 2006)?.article).toBe("a2");
    expect(familyAt(a, 2008)).toBe("left");
    expect(familyAt(a, 2010)).toBeNull(); // annulled
  });

  it("counts countries per family", () => {
    expect([...countByFamily(data, 2007)]).toEqual([
      ["left", 1],
      ["centre-left", 0],
      ["centre-right", 0],
      ["right", 0],
    ]);
    expect(lastYear(data)).toBe(2010);
  });
});
