// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import dataset from "../../data/generated/elections.json";
import type { Dataset } from "../../src/types";

const data = dataset as unknown as Dataset;
const $ = (id: string) => document.getElementById(id)!;
const click = (id: string) => ($(id) as HTMLButtonElement).click();

beforeAll(async () => {
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  // Reduced motion: camera moves apply at once instead of animating.
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduced-motion"),
    addEventListener() {},
  })) as unknown as typeof window.matchMedia;
  await import("../../src/main");
});

describe("app", () => {
  it("renders the latest presidential race on load", () => {
    expect($("chart-title").textContent).toContain("2026 · 1º turno");
    expect($("chart").querySelector("svg")).not.toBeNull();
    expect($("polls-table").querySelectorAll("tbody tr").length).toBe(
      data.presidential["2026"]!.rounds.r1!.polls.length,
    );
  });

  it("renders every presidential race and ranks pollsters for past ones", () => {
    for (const year of Object.keys(data.presidential)) {
      for (const round of ["r1", "r2"]) {
        click(`year-${year}`);
        click(`round-${round}`);
        expect($("chart").querySelectorAll("circle").length).toBeGreaterThan(0);
        // Every finished round ranks pollsters, 2026's 1st round included; its runoff is still ahead.
        if (data.presidential[year]!.rounds[round as "r1" | "r2"]?.result) {
          expect($("acc-title").textContent).toBe("Quem chegou mais perto");
          expect($("acc").querySelectorAll("tbody tr").length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("renders every state race and keeps the URL in sync", () => {
    const select = $("uf-select") as HTMLSelectElement;
    for (const office of ["governor", "senate"]) {
      click(`office-${office}`);
      for (const uf of Object.keys(data.states)) {
        select.value = uf;
        select.dispatchEvent(new Event("change"));
        expect(window.location.search).toContain(`office=${office}&uf=${uf}`);
        expect($("chart-title").textContent).toContain(data.states[uf]!.name);
      }
    }
    expect(($("round-r2") as HTMLButtonElement).disabled).toBe(true); // no Senate runoff
  });

  it("excludes a pollster and highlights another", () => {
    click("office-president");
    click("year-2022");
    click("round-r1");
    click("chip-Datafolha");
    expect(window.location.search).toContain("exclude=Datafolha");
    expect($("polls-table").textContent).not.toContain("Datafolha");
    ($("acc").querySelector("tbody tr") as HTMLElement).click();
    expect($("hl-bar").hidden).toBe(false);
    click("hl-clear");
    expect($("hl-bar").hidden).toBe(true);
  });
  it("opens the map tab and steps through elections", () => {
    click("tab-map");
    expect($("map-view").hidden).toBe(false);
    expect($("polls-view").hidden).toBe(true);
    expect(window.location.search).toContain("view=map");
    expect($("map").querySelectorAll(".areas path").length).toBeGreaterThan(5500);

    click("map-office-mayor");
    expect($("map-title").textContent).toMatch(/Prefeitos eleitos em \d{4}/);
    expect($("map-round-group").hidden).toBe(true);
    const years = [...$("map-years").querySelectorAll("button")].map((b) => b.textContent);
    expect(years[0]).toBe("1996");

    ($("map-years").querySelector("button") as HTMLButtonElement).click();
    expect($("map-title").textContent).toBe("Prefeitos eleitos em 1996");
    ($("map-legend").querySelector("button") as HTMLButtonElement).click();
    expect($("map").classList.contains("focusing")).toBe(true);
    // The highlight is a layer of copies; the count matches the legend.
    const pressed = $("map-legend").querySelector('[aria-pressed="true"] .n')!.textContent!;
    expect($("map").querySelectorAll(".focus-layer path").length).toBe(Number(pressed.replace(/\./g, "")));
    expect(window.location.search).toContain("focus=");

    click("map-office-president"); // 1994 and 1998 are equally near 1996: the later one wins
    expect($("map-title").textContent).toBe("Presidente · 1998 · 1º turno");
    expect(($("map-round-r2") as HTMLButtonElement).disabled).toBe(true);

    click("map-office-idhm");
    expect($("map-title").textContent).toMatch(/IDH dos municípios no Censo de (1991|2000|2010)/);
    expect($("map").querySelectorAll(".areas path[class^='q']").length).toBeGreaterThan(5000);
    expect($("map-legend").querySelectorAll(".map-chip").length).toBe(10);

    click("tab-polls");
    expect($("polls-view").hidden).toBe(false);
  });

  it("opens the Americas tab and moves through the years", () => {
    click("tab-americas");
    expect($("americas-view").hidden).toBe(false);
    expect(window.location.search).toContain("view=americas");
    expect($("am-map").querySelectorAll(".areas path").length).toBeGreaterThan(600);
    expect($("am-legend").querySelectorAll(".map-chip").length).toBe(4);

    const slider = $("am-slider") as HTMLInputElement;
    slider.value = "6";
    slider.dispatchEvent(new Event("input"));
    expect($("am-title").textContent).toBe("Quem governava as Américas em 2006");
    expect(window.location.search).toContain("year=2006");

    ($("am-legend").querySelector(".map-chip") as HTMLButtonElement).click();
    expect(window.location.search).toContain("focus=left");

    ($("am-layers").querySelector('[data-layer="hdi"]') as HTMLButtonElement).click();
    expect($("am-title").textContent).toBe("Índice de Desenvolvimento Humano em 2006");
    expect(window.location.search).toContain("layer=hdi");
    expect($("am-legend").querySelectorAll(".map-chip").length).toBe(10);
    expect($("am-map").querySelectorAll(".areas path[class^='q']").length).toBeGreaterThan(400);
    ($("am-layers").querySelector('[data-layer="income"]') as HTMLButtonElement).click();
    expect($("am-title").textContent).toBe("Poder de compra: renda mediana por pessoa em 2006");
    ($("am-layers").querySelector('[data-layer="politics"]') as HTMLButtonElement).click();
    ($("am-legend").querySelector(".map-chip") as HTMLButtonElement).click();
    expect($("am-map").querySelectorAll(".focus-layer path").length).toBeGreaterThan(0);
    click("tab-polls");
  });

  it("zooms the map to a state and back", () => {
    click("tab-map");
    const viewport = () => $("map").querySelector("svg > g")!.getAttribute("transform") ?? "";
    const scale = () => Number(viewport().match(/scale\(([\d.]+)\)/)?.[1] ?? 1);

    const select = $("map-uf") as HTMLSelectElement;
    select.value = "SP";
    select.dispatchEvent(new Event("change"));
    expect(scale()).toBeGreaterThan(2);
    expect(window.location.search).toContain("uf=SP");
    expect($("map").classList.contains("zoomed")).toBe(true);

    const framed = scale();
    click("map-zoom-in");
    expect(scale()).toBeCloseTo(framed * 2);
    click("map-zoom-out");
    expect(scale()).toBeCloseTo(framed);

    // The camera stays put while the timeline moves.
    ($("map-years").querySelector("button") as HTMLButtonElement).click();
    expect(scale()).toBeCloseTo(framed);

    click("map-zoom-reset");
    expect(scale()).toBe(1);
    expect(select.value).toBe("");
    expect(window.location.search).not.toContain("uf=");
  });

  it("opens the Congress tab and moves through houses and years", () => {
    click("tab-congress");
    expect($("congress-view").hidden).toBe(false);
    expect(window.location.search).toBe("?view=congress");
    const dots = () => $("cg-chart").querySelectorAll("circle").length;
    expect(dots()).toBe(513);
    expect($("cg-title").textContent).toContain("2026");

    ($("cg-years").querySelector('[data-year="1990"]') as HTMLButtonElement).click();
    expect(dots()).toBe(503);
    expect(window.location.search).toBe("?view=congress&ano=1990");
    // The PSDB started on the centre-left.
    const psdb = [...$("cg-table").querySelectorAll("tbody tr")].find((r) =>
      r.textContent!.startsWith("PSDB"),
    )!;
    expect(psdb.textContent).toContain("Centro-esquerda");

    // Every study is linked, not only named.
    const links = [...$("cg-sources").querySelectorAll("a")].map((l) => l.getAttribute("href"));
    expect(links).toContain("https://doi.org/10.1017/lap.2023.24");
    expect(links).toContain("https://doi.org/10.1590/dados.2023.66.2.303");
    expect(links).toContain("https://en.wikipedia.org/wiki/1990_Brazilian_legislative_election");
    // The legend selects: left-wing seats stand out, the table lists only those parties.
    const chip = (key: string) => $("cg-legend").querySelector(`[data-focus="${key}"]`) as HTMLButtonElement;
    const selected = () => $("cg-chart").querySelectorAll("circle.sel").length;
    expect(chip("centrao")).toBeNull(); // no Centrão before its source's year
    chip("left").click();
    expect(window.location.search).toBe("?view=congress&ano=1990&destaque=esquerda");
    expect(chip("left").getAttribute("aria-pressed")).toBe("true");
    const left = Number(chip("left").querySelector(".n")!.textContent);
    expect(selected()).toBe(left);
    expect(
      [...$("cg-table").querySelectorAll("tbody tr")].every((r) => r.textContent!.includes("Esquerda")),
    ).toBe(true);
    // Several at once, summed against the majority.
    chip("centre-left").click();
    expect(decodeURIComponent(window.location.search)).toBe(
      "?view=congress&ano=1990&destaque=esquerda,centro-esquerda",
    );
    const both = left + Number(chip("centre-left").querySelector(".n")!.textContent);
    expect(selected()).toBe(both);
    expect($("cg-legend").textContent).toContain(`Selecionados: ${both} de 503 cadeiras`);
    chip("clear").click();
    expect(selected()).toBe(0);
    expect(window.location.search).toBe("?view=congress&ano=1990");

    // The Centrão from 2022: PP, Republicanos, PL, União, PSD, Avante and Solidariedade, 99+47+42+40+59+7+4.
    ($("cg-years").querySelector('[data-year="2022"]') as HTMLButtonElement).click();
    chip("centrao").click();
    expect(window.location.search).toBe("?view=congress&ano=2022&destaque=centrao");
    expect($("cg-chart").querySelector("svg")!.classList.contains("cz-on")).toBe(true);
    expect(selected()).toBe(298);
    expect($("cg-legend").textContent).toContain("têm maioria absoluta");
    expect($("cg-table").querySelectorAll("tbody tr").length).toBe(7);
    chip("centrao").click();
    ($("cg-years").querySelector('[data-year="1990"]') as HTMLButtonElement).click();

    // The Senate starts in 2002: the closest year is kept.
    ($("cg-houses").querySelector('[data-house="senate"]') as HTMLButtonElement).click();
    expect(dots()).toBe(81);
    expect($("cg-title").textContent).toBe("Senado Federal após a eleição de 2002");
    expect(window.location.search).toBe("?view=congress&casa=senado&ano=2002");
    expect([...$("cg-sources").querySelectorAll("a")].map((l) => l.textContent)).toContain(
      "Cadeiras em 2002: Wikipédia (números do TSE)",
    );
    click("tab-polls");
  });

  it("opens the apuração tab and draws the count by state", async () => {
    // The Worker's answer, built from real TSE files: São Paulo's 2024 mayor race
    // standing in for the state of São Paulo.
    const { parseTse } = await import("../../src/model/apuracao");
    const sp = parseTse(
      JSON.parse(readFileSync(resolve(__dirname, "../fixtures/tse/sp71072-c0011-e000619-u.json"), "utf8")),
    );
    const answer = {
      office: "presidente",
      round: "r1",
      fetchedAt: "2026-10-04T21:00:00Z",
      br: sp,
      uf: { SP: sp },
    };
    const asked: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify(answer));
    }) as typeof fetch;
    try {
      click("tab-apuracao");
      expect($("apuracao-view").hidden).toBe(false);
      expect(window.location.search).toBe("?view=apuracao");
      await vi.waitFor(() =>
        expect($("ap-results").querySelectorAll("li").length).toBe(sp.candidates.length),
      );
      expect(asked[0]).toBe("http://localhost:8787/presidente/r1");
      expect($("ap-title").textContent).toBe("Presidente · 1º turno · Brasil");
      expect($("ap-badge").dataset.status).toBe("done");
      expect($("ap-counted").textContent).toBe("100% das urnas apuradas");
      expect($("ap-results").querySelector(".ap-num b")!.textContent).toBe("29,5%");
      // By default the map shows the build's snapshot by municipality: nearly all are painted.
      const painted = () => $("ap-map").querySelectorAll(".areas path[class^='c-']").length;
      expect(painted()).toBeGreaterThan(5000);
      expect($("ap-note").textContent).toContain("mapa por cidade");
      // By state, only São Paulo has numbers: its municipalities are colored, the rest wait.
      ($("ap-levels").querySelector('[data-level="uf"]') as HTMLButtonElement).click();
      expect(window.location.search).toContain("mapa=estados");
      expect(painted()).toBeGreaterThan(600);
      expect(painted()).toBeLessThan(700);

      const select = $("ap-uf") as HTMLSelectElement;
      select.value = "SP";
      select.dispatchEvent(new Event("change"));
      expect($("ap-title").textContent).toBe("Presidente · 1º turno · São Paulo (SP)");
      expect(window.location.search).toContain("uf=SP");
      select.value = "RJ";
      select.dispatchEvent(new Event("change"));
      expect($("ap-results").children.length).toBe(0); // no numbers for Rio in this answer

      // Deputies: one state at a time, seats per party list.
      const council = parseTse(
        JSON.parse(readFileSync(resolve(__dirname, "../fixtures/tse/sp71072-c0013-e000619-u.json"), "utf8")),
      );
      const deputies = { ...answer, office: "deputado-federal", br: council, uf: { SP: council } };
      globalThis.fetch = (async (url: string) => {
        asked.push(url);
        return new Response(JSON.stringify(deputies));
      }) as typeof fetch;
      select.value = "SP";
      select.dispatchEvent(new Event("change"));
      ($("ap-offices").querySelector('[data-office="deputado-federal"]') as HTMLButtonElement).click();
      await vi.waitFor(() => expect($("ap-results").textContent).toContain("distribuição do TSE"));
      expect(asked.at(-1)).toBe("http://localhost:8787/deputado-federal/r1/sp");
      expect(window.location.search).toContain("cargo=deputado-federal");
      expect(($("ap-rounds").querySelector('[data-round="r2"]') as HTMLButtonElement).disabled).toBe(true);
      expect($("ap-title").textContent).toBe("Deputado federal · São Paulo (SP)");
      // Everyone in a seat, under their list; those who rode in on the list's votes are marked.
      expect($("ap-results").querySelectorAll(".ap-groups .ap-row").length).toBe(council.seats);
      expect($("ap-results").textContent).toContain("Mais votados que ficaram de fora");
      const tags = [...$("ap-results").querySelectorAll(".ap-groups .ap-tag")].map((e) => e.textContent!);
      expect(tags.filter((x) => x.split(" · ").includes("Puxado")).length).toBe(17);
      expect($("ap-results").querySelector(".ap-summary")!.textContent).toContain(
        "17 eleitos tiveram menos votos que Carlos Bezerra Jr (PSD, 37.571 votos)",
      );

      click("tab-polls");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
