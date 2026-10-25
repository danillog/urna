// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import congress from "../../data/generated/congress.json";
import governismo from "../../data/generated/governismo.json";
import type { CongressData } from "../../src/model/congress";
import type { GovernismoData } from "../../src/model/governismo";
import { partyModalHtml } from "../../src/ui/party-modal";
import { SHARES, shortUrl, shownSvg, standalone } from "../../src/ui/share";

const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");

describe("share", () => {
  it("has a card spec for every button, and every part it names exists", () => {
    const buttons = [...html.matchAll(/data-share="([^"]+)"/g)].map((m) => m[1]!);
    const inPage = Object.entries(SHARES).filter(([, s]) => !s.dynamic);
    expect(new Set(buttons)).toEqual(new Set(inPage.map(([k]) => k)));
    // The party modal's parts, drawn by script: checked against what it draws.
    const modal = partyModalHtml(congress as CongressData, governismo as GovernismoData, "PT");
    for (const id of [SHARES.party!.meta, SHARES.party!.sources, ...SHARES.party!.figures])
      expect(modal, id).toContain(`id="${id}"`);
    expect(modal).toContain('data-share="party"');
    // The profile card reads the profile drawn on screen (checked in the app test).
    expect(SHARES.profile!.dynamic).toBe(true);
    for (const [, spec] of inPage) {
      for (const id of [spec.title, spec.meta, spec.sources, ...spec.figures, ...spec.legends].filter(
        Boolean,
      ))
        expect(html, id).toContain(`id="${id}"`);
    }
  });

  it("writes computed styles into a copy of the SVG", () => {
    document.head.innerHTML = "<style>.dot { fill: rgb(1, 2, 3); stroke-width: 4px; }</style>";
    document.body.innerHTML = '<svg viewBox="0 0 10 10"><circle class="dot" r="2"/></svg>';
    const copy = standalone(document.querySelector("svg")!);
    const circle = copy.querySelector("circle")!;
    expect(circle.getAttribute("class")).toBeNull();
    expect(circle.getAttribute("style")).toContain("fill:rgb(1, 2, 3)");
    expect(copy.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
  });

  it("picks the map that is shown, not the hidden ones", () => {
    document.body.innerHTML =
      '<div id="box"><div hidden><svg id="a"></svg></div><div><svg id="b"></svg></div><div class="tooltip"><svg id="c"></svg></div></div>';
    expect(shownSvg(document.getElementById("box")!)!.id).toBe("b");
  });

  it("shows the address without the scheme", () => {
    expect(shortUrl("https://danillogomes.com/urna/?view=census")).toBe("danillogomes.com/urna/?view=census");
  });
});
