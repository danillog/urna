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
  window.matchMedia = () => ({ matches: false, addEventListener() {} }) as unknown as MediaQueryList;
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
    expect($("map").querySelectorAll(".municipalities path").length).toBeGreaterThan(5500);

    click("map-office-mayor");
    expect($("map-title").textContent).toMatch(/Prefeitos eleitos em \d{4}/);
    expect($("map-round-group").hidden).toBe(true);
    const years = [...$("map-years").querySelectorAll("button")].map((b) => b.textContent);
    expect(years[0]).toBe("1996");

    ($("map-years").querySelector("button") as HTMLButtonElement).click();
    expect($("map-title").textContent).toBe("Prefeitos eleitos em 1996");
    ($("map-legend").querySelector("button") as HTMLButtonElement).click();
    expect($("map").classList.contains("focusing")).toBe(true);
    expect(window.location.search).toContain("focus=");

    click("map-office-president"); // 1994 and 1998 are equally near 1996: the later one wins
    expect($("map-title").textContent).toBe("Presidente · 1998 · 1º turno");
    expect(($("map-round-r2") as HTMLButtonElement).disabled).toBe(true);

    click("tab-polls");
    expect($("polls-view").hidden).toBe(false);
  });
});
