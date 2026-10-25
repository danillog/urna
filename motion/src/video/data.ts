/**
 * The numbers the video shows, from motion/scripts/erro_pesquisas.py
 * (motion/data/erro-pesquisas.json). Rules: valid votes; each pollster's last poll in the
 * 10 days before the election; error = poll − ballot, in points.
 */
import json from "../../data/erro-pesquisas.json";

export interface PresidentRound {
  year: number;
  round: "r1" | "r2";
  pt: string;
  rival: string;
  result: Record<string, number>;
  polls: number;
  ptError: number | null;
  rivalError: number | null;
  /** (PT's error) − (rival's error): positive, the polls had the PT's candidate better placed. */
  marginError: number | null;
  absError: number | null;
  pollsters: { p: string; d: number; e: Record<string, number>; abs: number }[];
}

export interface ErroPesquisas {
  rules: { window: number };
  counts: { polls: number; president: number; states: number; pollsters: number; withMethod: number };
  president: PresidentRound[];
  statesBySide: Record<string, { n: number; mean: number | null }>;
  states: { uf: string; office: string; p: string; cand: string; party: string; side: string; e: number; abs: number }[];
  ranking: { p: string; races: number; presRounds: number; absError: number; method: string | null }[];
  rankingPresident: { p: string; rounds: number; absError: number; method: string | null }[];
  byMethod: Record<string, { n: number; mean: number | null; abs: number | null }>;
}

export const DATA = json as unknown as ErroPesquisas;
