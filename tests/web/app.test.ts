// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

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
        if (year !== "2026") expect($("acc").querySelectorAll("tbody tr").length).toBeGreaterThan(0);
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
    // After the last census only state values exist; each municipality takes its state's.
    const idhmYears = [...$("map-years").querySelectorAll("button")];
    (idhmYears.at(-1) as HTMLButtonElement).click();
    expect($("map-title").textContent).toMatch(/IDH dos estados em 20\d\d/);
    expect(idhmYears.map((b) => b.textContent)).toEqual(expect.arrayContaining(["1991", "2010", "2021"]));

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
});
