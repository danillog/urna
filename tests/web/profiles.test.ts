import { describe, expect, it } from "vitest";

import {
  byKind,
  feminineTitle,
  filterPeople,
  legalMark,
  newsUrl,
  partyPath,
  reelected,
  renewal,
  type LegalGrade,
  type Person,
  type ProfilesData,
} from "../../src/model/profiles";
import { allowanceMedian, type MandateData } from "../../src/model/mandate";
import { partyIn } from "../../src/ui/people-view";

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

describe("legalMark", () => {
  const withCases = (...grades: LegalGrade[]) =>
    ({ legal: grades.map((grade) => ({ grade })) }) as unknown as Person;

  it("marks the most serious open grade and never a closed one", () => {
    expect(legalMark(withCases())).toBeNull();
    expect(legalMark(withCases("arquivado", "absolvido"))).toBeNull();
    expect(legalMark(withCases("investigado", "reu"))).toBe("reu");
    expect(legalMark(withCases("arquivado", "condenado-recorrivel", "investigado"))).toBe(
      "condenado-recorrivel",
    );
  });
});

describe("allowanceMedian", () => {
  const data = {
    allowanceMedianByState: { SP: 30000, AC: 41000 },
    senateAllowanceMedian: 36000,
    uf: { a: "AC", b: "SP" },
    people: { a: { house: "camara" }, b: { house: "senado" } },
  } as unknown as MandateData;

  it("sets a deputy against their state and a senator against the Senate", () => {
    expect(allowanceMedian(data, "a")).toBe(41000);
    expect(allowanceMedian(data, "b")).toBe(36000);
    expect(allowanceMedian(data, "c")).toBeNull();
  });
});

describe("partyIn", () => {
  const data = { people: [person({ party: "REPUBLICANOS" }), person({ party: "PCDOB" })] } as ProfilesData;
  it("finds the TSE's spelling of a party written as Congress writes it", () => {
    expect(partyIn(data, "Republicanos")).toBe("REPUBLICANOS");
    expect(partyIn(data, "PCdoB")).toBe("PCDOB");
    expect(partyIn(data, "NOVO")).toBeNull();
    expect(partyIn(data, null)).toBeNull();
  });
});

describe("renewal", () => {
  const dep = (uf: string, wasIn2022: boolean): Person =>
    person({
      office: "deputado-federal",
      uf,
      status: "elected",
      history: wasIn2022
        ? [{ year: 2022, office: "deputado-federal", place: uf, uf, party: "X", result: "elected" }]
        : [{ year: 2022, office: "deputado-estadual", place: uf, uf, party: "X", result: "elected" }],
    });

  it("counts as re-elected only the same office, state and previous election", () => {
    expect(reelected(dep("SP", true))).toBe(true);
    expect(reelected(dep("SP", false))).toBe(false); // was a state deputy
    const moved = { ...dep("SP", true), uf: "RJ" };
    expect(reelected(moved)).toBe(false); // elected in another state
  });

  it("gives the share of seats that changed hands, by any key", () => {
    const rows = renewal([dep("SP", true), dep("SP", false), dep("SP", false), dep("RJ", true)], (p) => p.uf);
    expect(rows.map((r) => [r.key, r.elected, r.reelected])).toEqual([
      ["SP", 3, 1],
      ["RJ", 1, 1],
    ]);
    expect(rows[0]!.renewal).toBeCloseTo(66.67, 1);
    expect(rows[1]!.renewal).toBe(0);
  });
});

describe("feminineTitle", () => {
  it("writes whole office words in the feminine and leaves the rest", () => {
    expect(feminineTitle("ministro da Igualdade Racial")).toBe("ministra da Igualdade Racial");
    expect(feminineTitle("Secretário Municipal de Saúde")).toBe("Secretária Municipal de Saúde");
    expect(feminineTitle("presidente do Senado")).toBe("presidente do Senado");
    expect(feminineTitle("deputado estadual")).toBe("deputada estadual");
    expect(feminineTitle("Ministério da Saúde")).toBe("Ministério da Saúde"); // not a whole-word match
  });
});
