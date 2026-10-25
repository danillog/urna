// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import americasJson from "../../data/generated/americas.json";
import topo from "../../data/generated/americas.topo.json";
import dataset from "../../data/generated/elections.json";
import { idle, peek } from "../../src/data";
import { lastYear, type AmericasData } from "../../src/model/americas";
import type { ProfilesData } from "../../src/model/profiles";
import type { Dataset } from "../../src/types";

const data = dataset as unknown as Dataset;
const americasTopo = topo as unknown as {
  objects: { americas: { geometries: { properties: { country: string } }[] } };
};
const lastAmericasYear = lastYear(americasJson as unknown as AmericasData);
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
  it("opens on the home page, whose cards open each tab", async () => {
    expect($("home-view").hidden).toBe(false);
    expect($("polls-view").hidden).toBe(true);
    expect(window.location.search).toBe("");
    // A question for every tab but the home page's own.
    const targets = [...$("home-view").querySelectorAll<HTMLAnchorElement>("a[data-go]")].map((a) =>
      new URLSearchParams(a.search).get("view"),
    );
    for (const v of [
      "polls",
      "programs",
      "apuracao",
      "people",
      "watch",
      "congress",
      "map",
      "census",
      "where",
      "americas",
    ])
      expect(targets).toContain(v);
    ($("home-view").querySelector('a[href="?view=polls"]') as HTMLAnchorElement).click();
    await idle();
    expect($("home-view").hidden).toBe(true);
    expect($("polls-view").hidden).toBe(false);
    expect(window.location.search).toBe("?view=polls");
  });

  it("renders the latest presidential race", () => {
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
    // Every year and round in turn: slow on a busy machine.
  }, 15_000);

  it("cycles the theme between automatic, light and dark and remembers it", () => {
    const toggle = $("theme-toggle");
    const root = document.documentElement;
    expect(root.dataset.theme).toBeUndefined();
    expect(toggle.textContent).toBe("Automático");
    click("theme-toggle");
    expect(root.dataset.theme).toBe("light");
    expect(localStorage.getItem("urna-theme")).toBe("light");
    click("theme-toggle");
    expect(root.dataset.theme).toBe("dark");
    expect(toggle.getAttribute("aria-label")).toBe("Tema: escuro. Clique para automático.");
    click("theme-toggle");
    expect(root.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("urna-theme")).toBeNull();
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
    // Every state for two offices: slow on a busy machine.
  }, 15_000);

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
  it("zooms the polls chart to the last 30 days, the table still listing every poll", () => {
    click("office-president");
    click("year-2026");
    click("round-r1");
    const dots = () => $("chart").querySelectorAll("circle").length;
    const all = dots();
    click("zoom-30");
    expect(window.location.search).toContain("dias=30");
    expect($("zoom-30").getAttribute("aria-pressed")).toBe("true");
    expect(dots()).toBeLessThan(all);
    expect($("polls-table").querySelectorAll("tbody tr").length).toBe(
      data.presidential["2026"]!.rounds.r1!.polls.length,
    );
    click("zoom-all");
    expect(dots()).toBe(all);
    expect(window.location.search).not.toContain("dias");
  });

  it("weighs the average by the pollsters' record and shows each one's weight", () => {
    click("office-president");
    click("year-2026");
    click("round-r2");
    const columns = () => $("acc").querySelectorAll("thead th").length;
    const plain = columns();
    click("weigh-record");
    expect(window.location.search).toContain("peso=historico");
    expect($("weigh-record").getAttribute("aria-pressed")).toBe("true");
    expect(columns()).toBe(plain + 1);
    expect($("acc").textContent).toContain("×");
    click("weigh-default");
    expect(columns()).toBe(plain);
    expect(window.location.search).not.toContain("peso");
  });

  it("applies the polls' past misses to the margin only while the race has no result", () => {
    click("office-president");
    click("year-2026");
    click("round-r2");
    expect($("errors-card").hidden).toBe(false);
    expect($("errors").textContent).toContain("2º turno de 2022");
    expect($("errors").textContent).toContain("1º turno de 2026");
    click("year-2022");
    expect($("errors-card").hidden).toBe(true);
  });

  it("runs the programs quiz: cards without author, then the result and every source", async () => {
    click("tab-programs");
    await idle();
    expect($("programs-view").hidden).toBe(false);
    expect(window.location.search).toBe("?view=programs");
    expect($("pg-all-card").hidden).toBe(true); // the authors stay hidden until the end
    expect($("pg-who").querySelectorAll(".pg-person")).toHaveLength(2);
    click("pg-start");
    const total = Number($("pg-stage").querySelector(".pg-progress span")!.textContent!.split(" de ")[1]);
    expect(total).toBeGreaterThan(10);
    // The card says nothing about who proposed it.
    for (const name of ["Lula", "Flávio", "Bolsonaro", "PT", "PL"])
      expect($("pg-card").textContent).not.toContain(name);
    for (let i = 0; i < total; i++)
      click(i % 3 === 2 ? "pg-answer-skip" : i % 3 === 1 ? "pg-answer-disagree" : "pg-answer-agree");
    expect($("pg-stage").querySelector(".pg-headline")!.textContent).toMatch(/programa de|Empate/);
    expect($("pg-stage").querySelectorAll(".pg-tile")).toHaveLength(2);
    expect($("pg-all-card").hidden).toBe(false);
    const pages = [...$("pg-all").querySelectorAll<HTMLAnchorElement>("a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(pages.length).toBeGreaterThanOrEqual(total);
    expect(pages.every((h) => /^programas\/(lula-13|flavio-22)\.pdf#page=\d+$/.test(h!))).toBe(true);
    // Debate promises: apart from the quiz, each with the minute of the official video.
    const moments = [...$("pg-debates").querySelectorAll<HTMLAnchorElement>("a.pg-src")].map((a) => a.href);
    expect(moments.length).toBeGreaterThan(0);
    expect(moments.every((h) => /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}&t=\d+s$/.test(h))).toBe(
      true,
    );
    // The result as a share card, drawn from the result: both candidates and every theme.
    expect($("pg-stage").querySelector('[data-share="programs"]')).not.toBeNull();
    const { SHARES } = await import("../../src/ui/share");
    expect(SHARES.programs!.render).toBeTypeOf("function");
    expect(SHARES.programs!.text!()).toContain("?view=programs");
    click("pg-again");
    expect($("pg-card")).toBeTruthy();
  });

  it("shows only the tabs of the section in view, and a section reopens its last tab", async () => {
    click("tab-programs");
    await idle();
    expect($("sec-2026").getAttribute("aria-current")).toBe("true");
    expect($("tab-polls").hidden).toBe(false);
    expect($("tab-congress").hidden).toBe(true);
    click("sec-politicos");
    await idle();
    expect($("watch-view").hidden).toBe(false);
    expect($("tab-congress").hidden).toBe(false);
    expect($("tab-polls").hidden).toBe(true);
    click("sec-2026");
    await idle();
    expect($("programs-view").hidden).toBe(false);
    click("sec-home");
    expect($("home-view").hidden).toBe(false);
    expect($("tabs").hidden).toBe(true);
  });

  it("answers a card from the keyboard", async () => {
    click("tab-programs");
    await idle();
    const progress = () => $("pg-stage").querySelector(".pg-progress span")!.textContent;
    const before = progress();
    $("pg-card").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(progress()).not.toBe(before);
  });

  it("opens the map tab and steps through elections", async () => {
    click("tab-map");
    await idle();
    expect($("map-view").hidden).toBe(false);
    expect($("polls-view").hidden).toBe(true);
    expect(window.location.search).toContain("view=map");
    expect($("map").querySelectorAll(".areas path").length).toBeGreaterThan(5500);

    click("map-office-mayor");
    await idle();
    expect($("map-title").textContent).toMatch(/Prefeitos eleitos em \d{4}/);
    expect($("map-round-group").hidden).toBe(true);
    const years = [...$("map-years").querySelectorAll("button")].map((b) => b.textContent);
    expect(years[0]).toBe("1996");

    ($("map-years").querySelector("button") as HTMLButtonElement).click();
    await idle();
    expect($("map-title").textContent).toBe("Prefeitos eleitos em 1996");
    ($("map-legend").querySelector("button") as HTMLButtonElement).click();
    await idle();
    expect($("map").classList.contains("focusing")).toBe(true);
    // The highlight is a layer of copies; the count matches the legend.
    const pressed = $("map-legend").querySelector('[aria-pressed="true"] .n')!.textContent!;
    expect($("map").querySelectorAll(".focus-layer path").length).toBe(Number(pressed.replace(/\./g, "")));
    expect(window.location.search).toContain("focus=");

    click("map-office-president"); // 1994 and 1998 are equally near 1996: the later one wins
    await idle();
    expect($("map-title").textContent).toBe("Presidente · 1998 · 1º turno");
    expect(($("map-round-r2") as HTMLButtonElement).disabled).toBe(true);

    click("map-office-idhm");
    await idle();
    expect($("map-title").textContent).toMatch(/IDH dos municípios no Censo de (1991|2000|2010)/);
    expect($("map").querySelectorAll(".areas path[class^='q']").length).toBeGreaterThan(5000);
    expect($("map-legend").querySelectorAll(".map-chip").length).toBe(10);

    click("tab-polls");
    expect($("polls-view").hidden).toBe(false);
  });

  it("opens the Americas tab and moves through the years", async () => {
    click("tab-americas");
    await idle();
    expect($("americas-view").hidden).toBe(false);
    expect(window.location.search).toContain("view=americas");
    expect($("am-map").querySelectorAll(".areas path").length).toBeGreaterThan(600);
    expect($("am-legend").querySelectorAll(".map-chip").length).toBe(4);
    expect($("am-sources").querySelectorAll("a").length).toBeGreaterThanOrEqual(2);

    const slider = $("am-slider") as HTMLInputElement;
    slider.value = "6";
    slider.dispatchEvent(new Event("input"));
    await idle();
    expect($("am-title").textContent).toBe("Quem governava as Américas em 2006");
    expect(window.location.search).toContain("year=2006");

    ($("am-legend").querySelector(".map-chip") as HTMLButtonElement).click();
    await idle();
    expect(window.location.search).toContain("focus=left");

    ($("am-layers").querySelector('[data-layer="hdi"]') as HTMLButtonElement).click();
    await idle();
    expect($("am-title").textContent).toBe("Índice de Desenvolvimento Humano em 2006");
    expect(window.location.search).toContain("layer=hdi");
    expect($("am-legend").querySelectorAll(".map-chip").length).toBe(10);
    expect($("am-map").querySelectorAll(".areas path[class^='q']").length).toBeGreaterThan(400);
    ($("am-layers").querySelector('[data-layer="income"]') as HTMLButtonElement).click();
    await idle();
    expect($("am-title").textContent).toBe("Poder de compra: renda mediana por pessoa em 2006");
    ($("am-layers").querySelector('[data-layer="poverty"]') as HTMLButtonElement).click();
    await idle();
    expect($("am-title").textContent).toBe("Pobreza em 2006: pessoas com menos de US$ 8,30 por dia");
    expect(window.location.search).toContain("layer=poverty");
    // Less poverty is the light end: the first chip (under 5%) takes the last color.
    expect($("am-legend").querySelector(".map-chip .map-key")!.className).toContain("q9");
    // Food insecurity starts in 2015 (FAO, 2014–2016): the timeline moves there and says why.
    ($("am-layers").querySelector('[data-layer="food"]') as HTMLButtonElement).click();
    await idle();
    expect($("am-title").textContent).toBe("Insegurança alimentar moderada ou grave em 2015");
    expect(($("am-slider") as HTMLInputElement).max).toBe(String(lastAmericasYear - 2015));
    expect($("am-span-note").hidden).toBe(false);
    expect($("am-years").querySelector("button")!.textContent).toBe("2015");

    // A click on Brazil and the menu's USA put both in the comparison, the lower value first.
    expect($("am-compare-bars").hidden).toBe(true);
    const brazil = americasTopo.objects.americas.geometries.findIndex((g) => g.properties.country === "BRA");
    ($("am-map").querySelector(`.areas path[data-i="${brazil}"]`) as SVGPathElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await idle();
    const country = $("am-country") as HTMLSelectElement;
    country.value = "USA";
    country.dispatchEvent(new Event("change"));
    await idle();
    expect(window.location.search).toContain("comparar=BRA%2CUSA");
    const rows = [...$("am-compare-bars").querySelectorAll<HTMLElement>(".am-bar-row")];
    expect(rows).toHaveLength(2);
    expect($("am-compare-lines").querySelectorAll("path")).toHaveLength(2);
    expect($("am-compare-year").textContent).toBe("2015");

    // The reading bar: every compared country, in the bars' order (less insecurity first).
    const readout = () => $("am-compare-lines").querySelector<HTMLElement>(".am-readout")!;
    const readNames = () =>
      [...readout().querySelectorAll(".am-readout-row")].map((r) => r.textContent!.split(" ")[0]);
    const barNames = rows.map((r) => r.querySelector(".am-bar-name")!.textContent);
    expect(readout().dataset.year).toBe("2015");
    expect(readNames()).toEqual(barNames.map((n) => n!.split(" ")[0]));
    // Arrow keys move it a year at a time; a pointer snaps it to the nearest measured year.
    const chart = $("am-compare-lines").querySelector("svg")!;
    chart.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(readout().dataset.year).toBe("2016");
    // jsdom has no layout: the chart is 640 wide, the plot runs from x = 52 to 626.
    const at2020 = 52 + ((2020 - 2015) / (lastAmericasYear - 2015)) * (626 - 52);
    chart.dispatchEvent(new MouseEvent("pointerdown", { clientX: at2020 + 3, bubbles: true }));
    expect(readout().dataset.year).toBe("2020");

    // Politics: a strip of who governed per country, every year from 2000.
    ($("am-layers").querySelector('[data-layer="politics"]') as HTMLButtonElement).click();
    await idle();
    expect($("am-compare-bars").hidden).toBe(true);
    expect($("am-compare-strips").querySelectorAll(".am-strip-row")).toHaveLength(2);
    expect($("am-compare-strips").querySelectorAll(".am-strip span.now")).toHaveLength(2);
    click("am-compare-clear");
    await idle();
    expect($("am-compare-strips").hidden).toBe(true);
    expect(window.location.search).not.toContain("comparar");

    ($("am-legend").querySelector(".map-chip") as HTMLButtonElement).click();
    await idle();
    expect($("am-map").querySelectorAll(".focus-layer path").length).toBeGreaterThan(0);
    click("tab-polls");
  });

  it("zooms the map to a state and back", async () => {
    click("tab-map");
    await idle();
    const viewport = () => $("map").querySelector("svg > g")!.getAttribute("transform") ?? "";
    const scale = () => Number(viewport().match(/scale\(([\d.]+)\)/)?.[1] ?? 1);

    const select = $("map-uf") as HTMLSelectElement;
    select.value = "SP";
    select.dispatchEvent(new Event("change"));
    await idle();
    expect(scale()).toBeGreaterThan(2);
    expect(window.location.search).toContain("uf=SP");
    // The map as a table: hidden for the HDI, São Paulo's 645 municipalities for an election.
    expect($("map-table-box").hidden).toBe(true);
    click("map-office-president");
    await idle();
    expect($("map-table").querySelectorAll("tbody tr").length).toBe(645);
    click("map-office-idhm");
    await idle();
    expect($("map").classList.contains("zoomed")).toBe(true);

    const framed = scale();
    click("map-zoom-in");
    await idle();
    expect(scale()).toBeCloseTo(framed * 2);
    click("map-zoom-out");
    await idle();
    expect(scale()).toBeCloseTo(framed);
    // The same from the keyboard: + zooms, an arrow pans, − zooms back out.
    const svg = $("map").querySelector("svg")!;
    const key = (k: string) => svg.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    key("+");
    expect(scale()).toBeCloseTo(framed * 2);
    const before = viewport();
    key("ArrowLeft");
    expect(viewport()).not.toBe(before);
    key("-");
    expect(scale()).toBeCloseTo(framed);
    expect(svg.getAttribute("tabindex")).toBe("0");

    // The camera stays put while the timeline moves.
    ($("map-years").querySelector("button") as HTMLButtonElement).click();
    await idle();
    expect(scale()).toBeCloseTo(framed);

    click("map-zoom-reset");
    await idle();
    expect(scale()).toBe(1);
    expect(select.value).toBe("");
    expect(window.location.search).not.toContain("uf=");
  });

  it("opens the Congress tab and moves through houses and years", async () => {
    click("tab-congress");
    await idle();
    expect($("congress-view").hidden).toBe(false);
    expect(window.location.search).toBe("?view=congress");
    const dots = () => $("cg-chart").querySelectorAll("circle").length;
    expect(dots()).toBe(513);
    expect($("cg-title").textContent).toContain("2026");
    // 2026: the seats of those never elected before, party by party.
    const newcomers = $("cg-legend").querySelector('[data-focus="newcomers"]') as HTMLButtonElement;
    const nNew = Number(newcomers.querySelector(".n")!.textContent);
    expect(nNew).toBeGreaterThan(20);
    newcomers.click();
    await idle();
    expect($("cg-chart").querySelectorAll("circle.sel").length).toBe(nNew);
    expect(window.location.search).toContain("destaque=novatos");
    ($("cg-legend").querySelector('[data-focus="newcomers"]') as HTMLButtonElement).click();
    await idle();

    ($("cg-years").querySelector('[data-year="1990"]') as HTMLButtonElement).click();
    await idle();
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
    await idle();
    expect(window.location.search).toBe("?view=congress&ano=1990&destaque=esquerda");
    expect(chip("left").getAttribute("aria-pressed")).toBe("true");
    const left = Number(chip("left").querySelector(".n")!.textContent);
    expect(selected()).toBe(left);
    expect(
      [...$("cg-table").querySelectorAll("tbody tr")].every((r) => r.textContent!.includes("Esquerda")),
    ).toBe(true);
    // Several at once, summed against the majority.
    chip("centre-left").click();
    await idle();
    expect(decodeURIComponent(window.location.search)).toBe(
      "?view=congress&ano=1990&destaque=esquerda,centro-esquerda",
    );
    const both = left + Number(chip("centre-left").querySelector(".n")!.textContent);
    expect(selected()).toBe(both);
    expect($("cg-legend").textContent).toContain(`Selecionados: ${both} de 503 cadeiras`);
    chip("clear").click();
    await idle();
    expect(selected()).toBe(0);
    expect(window.location.search).toBe("?view=congress&ano=1990");

    // The Centrão from 2022: PP, Republicanos, PL, União, PSD, Avante and Solidariedade, 99+47+42+40+59+7+4.
    ($("cg-years").querySelector('[data-year="2022"]') as HTMLButtonElement).click();
    await idle();
    chip("centrao").click();
    await idle();
    expect(window.location.search).toBe("?view=congress&ano=2022&destaque=centrao");
    expect($("cg-chart").querySelector("svg")!.classList.contains("cz-on")).toBe(true);
    expect(selected()).toBe(298);
    expect($("cg-legend").textContent).toContain("têm maioria absoluta");
    expect($("cg-table").querySelectorAll("tbody tr").length).toBe(7);
    chip("centrao").click();
    await idle();
    // The legislature in office, by the party each has today, and who changed party.
    expect($("cg-moment-group").hidden).toBe(false);
    ($("cg-moment").querySelector('[data-moment="now"]') as HTMLButtonElement).click();
    await idle();
    expect($("cg-title").textContent).toContain("hoje");
    expect(window.location.search).toContain("bancada=hoje");
    expect($("cg-switches").hidden).toBe(false);
    expect($("cg-switches").querySelectorAll("tbody tr").length).toBeGreaterThan(50);
    // Every member placed by their votes, party by party.
    expect($("cg-ideo").hidden).toBe(false);
    expect($("cg-ideo").querySelectorAll("circle").length).toBeGreaterThan(500);
    expect($("cg-ideo").textContent).toContain("Zucco & Power");
    ($("cg-moment").querySelector('[data-moment="elected"]') as HTMLButtonElement).click();
    await idle();
    // The Centrão measured by votes, beside the cited list.
    chip("centraoMeasured").click();
    await idle();
    expect(window.location.search).toContain("centrao-medido");
    expect(selected()).toBe(Number(chip("centraoMeasured").querySelector(".n")!.textContent));
    chip("centraoMeasured").click();
    await idle();
    // Beside the cited Centrão, the base measured by votes in the term that followed (Lula 3).
    chip("base").click();
    await idle();
    expect(window.location.search).toBe("?view=congress&ano=2022&destaque=base-medida");
    expect(selected()).toBe(Number(chip("base").querySelector(".n")!.textContent));
    expect(chip("base").title).toContain("Lula 3");
    chip("base").click();
    await idle();
    ($("cg-years").querySelector('[data-year="1990"]') as HTMLButtonElement).click();
    await idle();

    // A party's history opens from its name in the table, and the address keeps it.
    ($("cg-table").querySelector("[data-open]") as HTMLButtonElement).click();
    await idle();
    const modal = $("cg-modal") as HTMLDialogElement;
    expect(modal.hasAttribute("open")).toBe(true);
    expect(window.location.search).toContain("partido=");
    expect(modal.querySelector("#cg-modal-title")!.textContent).not.toBe("");
    (modal.querySelector("[data-close-modal]") as HTMLButtonElement).click();
    await idle();
    expect(modal.hasAttribute("open")).toBe(false);
    expect(window.location.search).not.toContain("partido=");

    // São Paulo's state assembly and city council, by party after each election.
    ($("cg-houses").querySelector('[data-house="alesp"]') as HTMLButtonElement).click();
    await idle();
    expect(dots()).toBe(94);
    expect($("cg-title").textContent).toContain("Assembleia Legislativa de São Paulo");
    expect(window.location.search).toContain("casa=alesp");
    ($("cg-houses").querySelector('[data-house="cmsp"]') as HTMLButtonElement).click();
    await idle();
    expect(dots()).toBe(55);
    expect($("cg-note").textContent).toContain("nota nacional");
    ($("cg-houses").querySelector('[data-house="chamber"]') as HTMLButtonElement).click();
    await idle();
    ($("cg-years").querySelector('[data-year="1990"]') as HTMLButtonElement).click();
    await idle();
    // The Senate starts in 2002: the closest year is kept.
    ($("cg-houses").querySelector('[data-house="senate"]') as HTMLButtonElement).click();
    await idle();
    expect(dots()).toBe(81);
    expect($("cg-title").textContent).toBe("Senado Federal após a eleição de 2002");
    expect(window.location.search).toBe("?view=congress&casa=senado&ano=2002");
    expect([...$("cg-sources").querySelectorAll("a")].map((l) => l.textContent)).toContain(
      "Cadeiras em 2002: Wikipédia (números do TSE)",
    );
    click("tab-polls");
  });

  it("opens De olho: four top-10 boards per house, a search and one member", async () => {
    click("tab-watch");
    await idle();
    expect($("watch-view").hidden).toBe(false);
    const boards = () => [...$("wt-boards").querySelectorAll(".wt-board")];
    expect(boards().map((b) => b.querySelector("h3")!.textContent)).toEqual([
      "Quem mais gastou",
      "Quem menos gastou",
      "Quem menos compareceu",
      "Quem mais compareceu",
    ]);
    expect(boards()[0]!.querySelectorAll("li")).toHaveLength(10);
    // Never the label "não trabalha": what is measured is named as it is.
    expect($("watch-view").textContent).not.toMatch(/não trabalha/i);

    // One state: everyone listed is from it.
    const uf = $("wt-uf") as HTMLSelectElement;
    uf.value = "AC";
    uf.dispatchEvent(new Event("change"));
    await idle();
    expect(window.location.search).toBe("?view=watch&uf=AC");
    expect(boards()[0]!.querySelectorAll("li")).toHaveLength(8);

    // A member, from a board.
    (boards()[2]!.querySelector(".wt-row") as HTMLButtonElement).click();
    await idle();
    expect($("wt-person").hidden).toBe(false);
    expect($("wt-person").querySelector(".wt-big")).not.toBeNull();
    expect(window.location.search).toContain("&p=");

    // The São Paulo houses: no state filter, the method says what is counted.
    ($("wt-houses").querySelector('[data-house="alesp"]') as HTMLButtonElement).click();
    await idle();
    expect(window.location.search).toBe("?view=watch&casa=alesp");
    expect($("wt-uf-group").hidden).toBe(true);
    expect($("wt-method").textContent).toContain("comissões");
    ($("wt-houses").querySelector('[data-house="cmsp"]') as HTMLButtonElement).click();
    await idle();
    expect(boards()[3]!.querySelectorAll("li")).toHaveLength(10);

    const q = $("wt-search") as HTMLInputElement;
    q.value = boards()[0]!.querySelector(".wt-name")!.firstChild!.textContent!.trim();
    q.dispatchEvent(new Event("input"));
    expect($("wt-results").hidden).toBe(false);
    ($("wt-results").querySelector("button") as HTMLButtonElement).click();
    await idle();
    expect($("wt-person").hidden).toBe(false);
    expect($("wt-results").hidden).toBe(true);
    click("tab-polls");
  });

  it("opens the Eleitos 2026 tab, filters and opens a profile", async () => {
    const profiles = JSON.parse(
      readFileSync(resolve(__dirname, "../../data/generated/profiles.json"), "utf8"),
    );
    click("tab-people");
    await idle();
    expect($("people-view").hidden).toBe(false);
    expect($("pp-title").textContent).toBe(`${profiles.people.length} eleitos`);
    // The renewal bar adds up to everyone.
    const counts = [...$("pp-kinds").querySelectorAll(".n")].map((n) => Number(n.textContent!.split(" ")[0]));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(profiles.people.length);
    // Renewal by office, and those in Congress now who ran and lost, all listed.
    expect($("pp-renew").querySelectorAll("table").length).toBe(3);
    expect($("pp-defeated").querySelectorAll("tbody tr").length).toBe(profiles.defeated.length);

    ($("pp-offices").querySelector('[data-office="governador"]') as HTMLButtonElement).click();
    await idle();
    expect(window.location.search).toBe("?view=people&cargo=governador");
    const governors = profiles.people.filter((p: { office: string }) => p.office === "governador");
    expect($("pp-list").querySelectorAll(".pp-card").length).toBe(Math.min(60, governors.length));

    // A profile: the trajectory, a news search, and never the CPF or the voter registration.
    ($("pp-list").querySelector(".pp-card") as HTMLButtonElement).click();
    await idle();
    expect($("pp-profile").hidden).toBe(false);
    expect($("pp-profile").querySelector(".pp-news")!.getAttribute("href")).toContain("news.google.com");
    expect(window.location.search).toContain("&p=");
    expect(JSON.stringify(profiles)).not.toMatch(/NR_CPF|NR_TITULO|"cpf"|titulo/i);
    // A case checked by hand (made up here): its grade, the court's link and, short of a
    // final conviction, the presumption of innocence.
    const shown = peek<ProfilesData>("profiles")!.people.find((x) => window.location.search.includes(x.id))!;
    shown.legal = [
      {
        grade: "reu",
        crime: "peculato",
        court: "STF",
        case: "AP 9999",
        since: "2025-03-01",
        url: "https://portal.stf.jus.br/processos/detalhe.asp?incidente=1",
        checked: "2026-10-01",
        stale: false,
      },
    ];
    ($("pp-list").querySelector(".pp-card.on") as HTMLButtonElement).click();
    await idle();
    expect($("pp-profile").querySelector(".pp-legal-list")!.textContent).toContain("Réu");
    expect($("pp-profile").textContent).toContain("Ninguém é considerado culpado");
    expect($("pp-profile").querySelector(".pp-legal-list a")!.getAttribute("href")).toContain("stf.jus.br");
    delete shown.legal;
    ($("pp-profile").querySelector("[data-close]") as HTMLButtonElement).click();
    await idle();
    expect($("pp-profile").hidden).toBe(true);

    // Someone in Congress now: the current term, with what to read it against.
    const mandate = JSON.parse(readFileSync(resolve(__dirname, "../../data/generated/mandate.json"), "utf8"));
    ($("pp-offices").querySelector('[data-office="deputado-federal"]') as HTMLButtonElement).click();
    await idle();
    const sitting = [...$("pp-list").querySelectorAll<HTMLButtonElement>(".pp-card")].find(
      (b) => mandate.people[b.dataset.person!],
    )!;
    sitting.click();
    await idle();
    const term = $("pp-profile").querySelector(".pp-mandate")!;
    expect(term.textContent).toContain("votações nominais do plenário");
    expect(term.textContent).toContain("como primeiro autor");
    expect(term.textContent).toContain("Posição pelos votos");
    expect(term.textContent).toContain("Comissões hoje");
    // Its share card: name, office and the term's lines, no figure.
    expect($("pp-profile").querySelector('[data-share="profile"]')).not.toBeNull();
    const { SHARES } = await import("../../src/ui/share");
    const lines = SHARES.profile!.lines!();
    expect(lines.some((l) => l.startsWith("Votou em"))).toBe(true);
    expect($("pp-name").textContent).not.toBe("");
    expect($("pp-profile").querySelector(".pp-key tbody tr")).not.toBeNull();
    expect($("pp-profile").textContent).toContain("Não existe registro oficial de horas");
    click("tab-polls");
  });

  it("opens the Voto e Censo tab and crosses census and vote", async () => {
    click("tab-census");
    await idle();
    expect($("census-view").hidden).toBe(false);
    expect(window.location.search).toBe("?view=census");
    expect($("cv-title").textContent).toBe("Lula × Flávio, 2026 · 1º turno · Brasil");
    expect($("cv-scatter").querySelectorAll("circle").length).toBe(5570);
    expect($("cv-quads").querySelectorAll(".cv-quad").length).toBe(4);
    // The chosen variables and the landmarks: income, Catholics, Evangelicals, the schooling ends.
    expect($("cv-gap").querySelectorAll(".cv-series").length).toBe(5);
    // Religion and schooling as whole distributions, five groups of towns by vote.
    const rows = $("cv-comp").querySelectorAll(".cv-comp-row");
    expect(rows.length).toBe(5);
    const widths = [...rows[0]!.querySelectorAll(".cv-stack")[1]!.querySelectorAll("span")].map((x) =>
      parseFloat((x as HTMLElement).style.width),
    );
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
    // Quadrants name their cut in numbers, not "the median".
    expect($("cv-quads").textContent).toMatch(/Renda média até R\$ [\d.]+/);

    // Another variable, a region, an older election.
    const variable = $("cv-var") as HTMLSelectElement;
    variable.value = "noReligion";
    variable.dispatchEvent(new Event("change"));
    await idle();
    const region = $("cv-region") as HTMLSelectElement;
    region.value = "NE";
    region.dispatchEvent(new Event("change"));
    await idle();
    ($("cv-years").querySelector('[data-year="2002"]') as HTMLButtonElement).click();
    await idle();
    expect(window.location.search).toBe("?view=census&ano=2002&var=sem-religiao&regiao=ne");
    expect($("cv-title").textContent).toBe("Lula × Serra, 2002 · 1º turno · Nordeste");
    // The runoff of the same year; 1998 had none, so its button turns off there.
    ($("cv-rounds").querySelector('[data-round="r2"]') as HTMLButtonElement).click();
    await idle();
    expect($("cv-title").textContent).toBe("Lula × Serra, 2002 · 2º turno · Nordeste");
    expect(window.location.search).toContain("turno=2");
    ($("cv-years").querySelector('[data-year="1998"]') as HTMLButtonElement).click();
    await idle();
    expect($("cv-title").textContent).toContain("1998 · 1º turno");
    expect(($("cv-rounds").querySelector('[data-round="r2"]') as HTMLButtonElement).disabled).toBe(true);
    ($("cv-years").querySelector('[data-year="2002"]') as HTMLButtonElement).click();
    ($("cv-rounds").querySelector('[data-round="r1"]') as HTMLButtonElement).click();
    await idle();
    expect($("cv-meta").textContent).toContain("Censo 2000");
    // The 27 capitals alone, then the rest of the country.
    region.value = "CAP";
    region.dispatchEvent(new Event("change"));
    await idle();
    expect($("cv-scatter").querySelectorAll("circle").length).toBe(27);
    region.value = "NE";
    region.dispatchEvent(new Event("change"));
    await idle();
    // Only the Northeast is drawn in the scatter (1,794 municipalities).
    expect($("cv-scatter").querySelectorAll("circle").length).toBeLessThan(1800);
    // Inside the capitals: one dot per area with votes, one shape per area on the map.
    const capitals = JSON.parse(
      readFileSync(resolve(__dirname, "../../data/generated/capitals.json"), "utf8"),
    );
    const shown = capitals.capitals.find((c: { name: string }) =>
      $("cp-title").textContent!.startsWith(c.name),
    );
    expect(shown).toBeDefined();
    expect($("cp-scatter").querySelectorAll("circle").length).toBe(
      shown.areas.filter((a: { valid: number; income: number | null }) => a.valid && a.income !== null)
        .length,
    );
    ($("cp-paint").querySelector('[data-paint="census"]') as HTMLButtonElement).click();
    await idle();
    expect(window.location.search).toContain("pintar=censo");
    expect($("cp-sources").querySelectorAll("a").length).toBe(5);
    // No runoff read yet: no round switch.
    expect($("cp-round-group").hidden).toBe(true);
    // São Paulo: its own variable (colour or race) and its 96 districts and 32 subprefeituras.
    const capitalSelect = $("cp-capital") as HTMLSelectElement;
    capitalSelect.value = "3550308";
    capitalSelect.dispatchEvent(new Event("change"));
    await idle();
    expect($("cp-level-group").hidden).toBe(false);
    const capVar = $("cp-var") as HTMLSelectElement;
    capVar.value = "negro";
    capVar.dispatchEvent(new Event("change"));
    await idle();
    expect(window.location.search).toContain("var-capital=negros");
    expect($("cp-note").textContent).toContain("pretos e pardos somados");
    ($("cp-level").querySelector('[data-level="districts"]') as HTMLButtonElement).click();
    await idle();
    expect($("cp-meta").textContent).toContain("96 distritos");
    expect(window.location.search).toContain("nivel=distritos");
    ($("cp-level").querySelector('[data-level="subprefeituras"]') as HTMLButtonElement).click();
    await idle();
    expect($("cp-meta").textContent).toContain("32 subprefeituras");
    capVar.value = "sameSex";
    capVar.dispatchEvent(new Event("change"));
    await idle();
    expect($("cp-note").textContent).toContain("não medem a população LGBT+");
    // Recife by its 94 neighbourhoods (the IBGE's).
    capitalSelect.value = "2611606";
    capitalSelect.dispatchEvent(new Event("change"));
    await idle();
    ($("cp-level").querySelector('[data-level="bairros"]') as HTMLButtonElement).click();
    await idle();
    expect($("cp-meta").textContent).toMatch(/^\d+ bairros/);
    expect(($("cp-level").querySelector('[data-level="districts"]') as HTMLButtonElement).hidden).toBe(true);
    capitalSelect.value = "3550308";
    capitalSelect.dispatchEvent(new Event("change"));
    await idle();
    // Back to the areas, following the tab's variable.
    ($("cp-level").querySelector('[data-level="areas"]') as HTMLButtonElement).click();
    capVar.value = "";
    capVar.dispatchEvent(new Event("change"));
    await idle();
    // No urban share in the 2022 census: the option turns off from 2018 on.
    const urban = variable.querySelector('option[value="urban"]') as HTMLOptionElement;
    expect(urban.disabled).toBe(false);
    ($("cv-years").querySelector('[data-year="2022"]') as HTMLButtonElement).click();
    await idle();
    expect(urban.disabled).toBe(true);
    expect((variable.querySelector('option[value="gini"]') as HTMLOptionElement).disabled).toBe(true);
    click("tab-polls");
    // Every municipality in the scatter, several times over: slow on a busy machine.
  }, 15_000);

  it("opens the Quem mora onde tab: one variable inside a capital, ranked", async () => {
    click("tab-where");
    await idle();
    await idle();
    expect($("where-view").hidden).toBe(false);
    expect(window.location.search).toBe("?view=where");
    // São Paulo by its districts, the elderly first.
    expect($("wh-title").textContent).toContain("São Paulo");
    expect($("wh-meta").textContent).toContain("96 distritos");
    expect($("wh-rank").querySelectorAll(".wh-row").length).toBe(20);
    ($("wh-vars").querySelector('[data-v="negro"]') as HTMLButtonElement).click();
    await idle();
    expect(window.location.search).toBe("?view=where&var=negros");
    expect($("wh-note").textContent).toContain("pretos e pardos somados");
    // A place's card, from the list.
    ($("wh-rank").querySelector(".wh-row") as HTMLButtonElement).click();
    await idle();
    expect($("wh-card").hidden).toBe(false);
    expect(window.location.search).toMatch(/lugar=\d+/);
    expect($("wh-card").querySelectorAll("tbody tr").length).toBeGreaterThan(15);
    ($("wh-card").querySelector("[data-close]") as HTMLButtonElement).click();
    await idle();
    expect($("wh-card").hidden).toBe(true);
    // The median income has no whole-city figure: no city row.
    ($("wh-vars").querySelector('[data-v="incomeMedian"]') as HTMLButtonElement).click();
    await idle();
    expect($("wh-rank").querySelector(".wh-city")).toBeNull();
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
      await idle();
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
      // Who chose no one: in people beside the bars, and as a map.
      expect($("ap-totals").textContent).toContain("Quem não escolheu ninguém");
      expect($("ap-totals").textContent).toContain("423.635");
      ($("ap-paint").querySelector('[data-paint="nulls"]') as HTMLButtonElement).click();
      expect(window.location.search).toContain("pintar=nulos");
      expect($("ap-map").querySelectorAll(".areas path[class^='q']").length).toBeGreaterThan(600);
      expect($("ap-legend").textContent).toContain("Votos nulos");
      // The legend filters the map, as in the Mapa tab: a step brings its places forward.
      const step = $("ap-legend").querySelector<HTMLButtonElement>("[data-group]")!;
      step.click();
      expect(window.location.search).toContain(`focus=${step.dataset.group}`);
      // The legend is drawn again: the chip picked is the new one with the same step.
      const picked = $("ap-legend").querySelector(`[data-group="${step.dataset.group}"]`)!;
      expect(picked.getAttribute("aria-pressed")).toBe("true");
      expect($("ap-map").querySelectorAll(".focus-layer path").length).toBeGreaterThan(600);
      ($("ap-paint").querySelector('[data-paint="lead"]') as HTMLButtonElement).click();
      // Another paint drops the highlight; a candidate's chip brings forward where they lead.
      expect(window.location.search).not.toContain("focus=");
      expect($("ap-map").querySelectorAll(".focus-layer path").length).toBe(0);
      $("ap-legend").querySelector<HTMLButtonElement>("[data-group]")!.click();
      expect($("ap-map").querySelectorAll(".focus-layer path").length).toBeGreaterThan(600);
      $("ap-legend").querySelector<HTMLButtonElement>("[data-group]")!.click();
      expect($("ap-map").querySelectorAll(".focus-layer path").length).toBe(0);

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
