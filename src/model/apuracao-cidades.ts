/**
 * The count per municipality: a snapshot of the TSE's files taken by
 * pipeline/apuracao_cidades.py and inlined in the build. The Worker cannot
 * read 5,570 files a minute, so this lags the live state map until the
 * script runs again.
 */

/** Shape of data/generated/apuracao-cidades.json, keyed "presidente-r1". */
export interface EncodedCityCount {
  /** Last TSE totalization among the files read, "dd/mm/aaaa hh:mm:ss". */
  totalizedAt: string | null;
  /** Candidates, as indexes into these two: ballot name and party. */
  names: string[];
  parties: string[];
  /** Base64 little-endian typed arrays, one entry per municipality in topology order. */
  winner: string; // Uint16 index, 65535 = no result
  winnerShare: string; // Uint16, tenths of a percent of valid votes
  second: string;
  secondShare: string;
  votes: string; // Uint32 valid votes
  counted: string; // Uint16, tenths of a percent of polling stations
}

export const NO_CITY_RESULT = 0xffff;

export interface CityCount {
  totalizedAt: string | null;
  names: string[];
  parties: string[];
  winner: Uint16Array;
  winnerShare: Uint16Array;
  second: Uint16Array;
  secondShare: Uint16Array;
  votes: Uint32Array;
  counted: Uint16Array;
}

function bytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function decodeCityCount(e: EncodedCityCount): CityCount {
  return {
    totalizedAt: e.totalizedAt,
    names: e.names,
    parties: e.parties,
    winner: new Uint16Array(bytes(e.winner)),
    winnerShare: new Uint16Array(bytes(e.winnerShare)),
    second: new Uint16Array(bytes(e.second)),
    secondShare: new Uint16Array(bytes(e.secondShare)),
    votes: new Uint32Array(bytes(e.votes)),
    counted: new Uint16Array(bytes(e.counted)),
  };
}
