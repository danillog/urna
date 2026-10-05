// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Apuracao } from "../../src/model/apuracao";
import worker, { plan } from "../../worker/src/index";

const fixture = (name: string) => readFileSync(resolve(__dirname, "../fixtures/tse", name), "utf8");

/** A fake TSE that serves only the files given, 404 for the rest. */
function fakeTse(files: Record<string, string>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const name = Object.keys(files).find((f) => url.endsWith(`/${f}`));
    return name ? new Response(files[name]) : new Response("<Error/>", { status: 404 });
  });
  return calls;
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const get = (path: string, method = "GET") =>
  worker.fetch(new Request(`https://apuracao.example${path}`, { method }), {}, ctx);

afterEach(() => vi.unstubAllGlobals());

const TSE = "https://resultados.tse.jus.br/oficial";

describe("apuração worker routes", () => {
  it("reads the right TSE files for each office", () => {
    const president = plan("/presidente/r1")!;
    expect(president.national).toBe(`${TSE}/ele2026/6257/dados/br/br-c0001-e006257-u.json`);
    expect(president.states.length).toBe(27);
    expect(plan("/r2")!.national).toBe(`${TSE}/ele2026/6258/dados/br/br-c0001-e006258-u.json`);

    const governor = plan("/governador/r2")!;
    expect(governor.national).toBeNull();
    expect(governor.states.find((f) => f.uf === "SP")!.url).toBe(
      `${TSE}/ele2026/6260/dados/sp/sp-c0003-e006260-u.json`,
    );
    expect(plan("/senador/r1")!.states[0]!.url).toContain("-c0005-e006259-u.json");

    expect(plan("/deputado-federal/r1/sp")!.states).toEqual([
      { uf: "SP", url: `${TSE}/ele2026/6259/dados/sp/sp-c0006-e006259-u.json` },
    ]);
    // The DF elects district deputies, office 8.
    expect(plan("/deputado-estadual/r1/df")!.states[0]!.url).toContain("df-c0008-e006259-u.json");
  });

  it("maps test paths to 2024: capitals' mayors and the capital's council", () => {
    expect(plan("/teste")!.states.find((f) => f.uf === "SP")!.url).toBe(
      `${TSE}/ele2024/619/dados/sp/sp71072-c0011-e000619-u.json`,
    );
    expect(plan("/teste/governador/r1")!.states.length).toBe(26); // the DF elects no mayor
    expect(plan("/teste/deputado-federal/r1/sp")!.states[0]!.url).toBe(
      `${TSE}/ele2024/619/dados/sp/sp71072-c0013-e000619-u.json`,
    );
  });

  it("refuses what does not exist", () => {
    expect(plan("/senador/r2")).toBeNull(); // no Senate runoff
    expect(plan("/deputado-federal/r1")).toBeNull(); // deputies need a state
    expect(plan("/deputado-federal/r1/xx")).toBeNull();
    expect(plan("/governador/r1/sp")).toBeNull();
    expect(plan("/prefeito/r1")).toBeNull();
  });
});

describe("apuração worker", () => {
  it("serves the country and every state it could read, with CORS", async () => {
    const calls = fakeTse({ "br-c0001-e006257-u.json": fixture("br-c0001-e006257-u.json") });
    const res = await get("/r1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=30");
    const body = (await res.json()) as Apuracao;
    expect(body).toMatchObject({ office: "presidente", round: "r1" });
    expect(body.br.candidates.length).toBe(12);
    expect(body.uf).toEqual({}); // every state file was a 404
    expect(calls.length).toBe(28); // the country plus 27 states
  });

  it("keeps only the progress in the total for offices that differ by state", async () => {
    fakeTse({ "sp71072-c0011-e000619-u.json": fixture("sp71072-c0011-e000619-u.json") });
    const body = (await (await get("/teste/governador/r1")).json()) as Apuracao;
    expect(Object.keys(body.uf)).toEqual(["SP"]);
    expect(body.br.candidates).toEqual([]);
    expect(body.br.counted).toBe(100);
  });

  it("trims a delegation to who holds a seat and a few more", async () => {
    fakeTse({ "sp71072-c0013-e000619-u.json": fixture("sp71072-c0013-e000619-u.json") });
    const res = await get("/teste/deputado-federal/r1/sp");
    const body = (await res.json()) as Apuracao;
    const sp = body.uf.SP!;
    expect(sp.lists.length).toBeGreaterThan(20);
    expect(sp.candidates.length).toBeLessThan(80);
    expect(body.br.seats).toBe(55);
  });

  it("answers 502 when the TSE has nothing, and 404 off its routes", async () => {
    fakeTse({});
    const res = await get("/r2");
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=5");
    expect((await get("/elsewhere")).status).toBe(404);
    expect((await get("/r1", "POST")).status).toBe(405);
    expect((await get("/r1", "OPTIONS")).status).toBe(204);
  });

  it("survives the TSE dropping the connection", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network");
    });
    expect((await get("/r1")).status).toBe(502);
  });
});
