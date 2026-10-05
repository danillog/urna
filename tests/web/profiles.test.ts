import { describe, expect, it } from "vitest";

import { byKind, filterPeople, newsUrl, partyPath, type Person } from "../../src/model/profiles";

const person = (over: Partial<Person>): Person => ({
  id: "x",
  name: "Fulano",
  fullName: "Fulano de Tal",
  office: "deputado-federal",
  uf: "SP",
  party: "PL",
  number: "2222",
  status: "elected",
  votes: 100,
  share: 1,
  age: 40,
  birthplace: "São Paulo (SP)",
  education: "Superior completo",
  occupation: "Advogado",
  kind: "new",
  history: [],
  contact: null,
  ...over,
});

describe("profiles", () => {
  const people = [
    person({ id: "a", name: "José Antônio", uf: "SP", kind: "returning" }),
    person({ id: "b", name: "Maria", uf: "RJ", party: "PT", office: "senador" }),
    person({ id: "c", name: "Ana", uf: "SP", party: "PSD", office: "governador", kind: "other-office" }),
  ];
  const none = { office: null, uf: null, party: null, kind: null, query: "" };

  it("filters by office, state, party, kind and a query without accents", () => {
    expect(filterPeople(people, { ...none, uf: "SP" }).map((p) => p.id)).toEqual(["a", "c"]);
    expect(filterPeople(people, { ...none, office: "senador" }).map((p) => p.id)).toEqual(["b"]);
    expect(filterPeople(people, { ...none, query: "jose antonio" }).map((p) => p.id)).toEqual(["a"]);
    expect(filterPeople(people, { ...none, query: "pt" }).map((p) => p.id)).toEqual(["b"]);
    expect(byKind(people)).toEqual({ new: 1, tried: 0, appointed: 0, "other-office": 1, returning: 1 });
  });

  it("lists party changes once each, in order", () => {
    const h = (year: number, party: string) => ({
      year,
      office: "vereador",
      place: "X",
      uf: "SP",
      party,
      result: "lost" as const,
    });
    expect(
      partyPath(person({ party: "PL", history: [h(2016, "PSL"), h(2018, "PSL"), h(2022, "UNIÃO")] })),
    ).toEqual(["PSL", "UNIÃO", "PL"]);
  });

  it("searches news by name, office and state", () => {
    const url = newsUrl(person({ name: "Ana Paula", uf: "BA" }), "Senador");
    expect(decodeURIComponent(url)).toContain('q="Ana Paula" Senador BA');
  });
});
