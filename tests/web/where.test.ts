import { describe, expect, it } from "vitest";

import type { CapitalsData } from "../../src/model/capitals";
import { bandOf, fromCensusLink, whereFromSearch, whereToSearch } from "../../src/ui/where-view";

const data = { capitals: [{ code: "3550308" }, { code: "3304557" }] } as unknown as CapitalsData;

describe("the Quem mora onde address", () => {
  it("reads and writes its options, leaving the defaults out", () => {
    const s = whereFromSearch(data, new URLSearchParams("capital=3304557&nivel=bairros&var=negros&lugar=1"));
    expect(s).toEqual({ capital: "3304557", level: "bairros", v: "negro", filter: null, pick: "1" });
    const back = new URLSearchParams();
    whereToSearch(s, back);
    expect(back.toString()).toBe("capital=3304557&nivel=bairros&var=negros&lugar=1");
    // Nothing asked: São Paulo, its most familiar names, the elderly.
    expect(whereFromSearch(data, new URLSearchParams("capital=0000000"))).toEqual({
      capital: "3550308",
      level: null,
      v: "elderly",
      filter: null,
      pick: null,
    });
  });

  it("keeps a filter: a part of the city along another variable", () => {
    const s = whereFromSearch(data, new URLSearchParams("var=evangelicos&filtro=renda&faixa=metade-menos"));
    expect(s.filter).toEqual({ v: "income", band: "low" });
    expect(bandOf(s.filter)).toEqual({ v: "income", from: 0, to: 4 });
    const back = new URLSearchParams();
    whereToSearch(s, back);
    expect(back.toString()).toBe("var=evangelicos&filtro=renda&faixa=metade-menos");
    // A band without its variable, or the other way round, is no filter.
    expect(whereFromSearch(data, new URLSearchParams("faixa=quinto-mais")).filter).toBeNull();
    expect(whereFromSearch(data, new URLSearchParams("filtro=desemprego")).filter).toBeNull();
    expect(whereFromSearch(data, new URLSearchParams("var=media-mediana")).v).toBe("incomeRatio");
  });

  it("sends the old Voto e Censo links here", () => {
    expect(fromCensusLink(new URLSearchParams("view=census&onde-var=negros&onde=3304557"))?.toString()).toBe(
      "view=where&capital=3304557&var=negros",
    );
    expect(fromCensusLink(new URLSearchParams("view=census&var=renda"))).toBeNull();
  });
});
