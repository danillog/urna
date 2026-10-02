import type { Dataset, Race } from "../../src/types";

export function race(overrides: Partial<Race> = {}): Race {
  return {
    date: "2026-10-04",
    electionDay: 276,
    series: ["Lula", "Flávio", "undecided"],
    colors: { Lula: "red", Flávio: "blue", undecided: "gray" },
    parties: { Lula: "PT", Flávio: "PL" },
    dashed: [],
    polls: [],
    result: null,
    winner: null,
    accuracy: [],
    validVotesOnly: false,
    notes: [],
    ...overrides,
  };
}

export function dataset(): Dataset {
  return {
    methods: { Datafolha: "in_person", Nexus: "phone" },
    presidential: {
      "2022": {
        year: 2022,
        context: "",
        events: [],
        rounds: {
          r1: race({
            date: "2022-10-02",
            result: { Lula: 48.43 },
            accuracy: [
              { p: "Datafolha", d: 273, meanError: 2, marginError: 4, shares: {} },
              { p: "Nexus", d: 273, meanError: 4, marginError: 1, shares: {} },
            ],
          }),
          r2: race({
            date: "2022-10-30",
            accuracy: [{ p: "Datafolha", d: 300, meanError: 1, marginError: 2, shares: {} }],
          }),
        },
      },
      "2026": {
        year: 2026,
        context: "",
        events: [],
        rounds: { r1: race(), r2: race({ date: "2026-10-25" }) },
      },
    },
    states: {
      SP: {
        uf: "SP",
        name: "São Paulo",
        note: "",
        governor: { r1: race(), r2: race() },
        senate: { r1: race() },
      },
      RR: { uf: "RR", name: "Roraima", note: "", governor: { r1: race() }, senate: { r1: race() } },
    },
  };
}
