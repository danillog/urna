import { describe, expect, it } from "vitest";

import { tilesFor } from "../../src/ui/map";

describe("street map tiles", () => {
  // A Mercator projection whose world is 256 map units wide, centred at (128, 128): at one
  // screen pixel per unit, the whole world is the single zoom-0 tile.
  const scale = 256 / (2 * Math.PI);

  it("covers the world with one tile at its own size", () => {
    const tiles = tilesFor(
      scale,
      [128, 128],
      [
        [0, 0],
        [256, 256],
      ],
      1,
    );
    expect(tiles).toEqual([{ z: 0, x: 0, y: 0, at: [0, 0], size: 256 }]);
  });

  it("takes the zoom whose tiles are about their size on screen, only those in view", () => {
    // Four screen pixels per unit: zoom 2, tiles of 64 units; the box holds the top-left quarter.
    const tiles = tilesFor(
      scale,
      [128, 128],
      [
        [0, 0],
        [127, 127],
      ],
      4,
    );
    expect(tiles.map((t) => [t.z, t.x, t.y])).toEqual([
      [2, 0, 0],
      [2, 1, 0],
      [2, 0, 1],
      [2, 1, 1],
    ]);
    expect(tiles[3]).toMatchObject({ at: [64, 64], size: 64 });
  });
});
