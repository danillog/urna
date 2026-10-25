import { describe, expect, it } from "vitest";

import { subTopology } from "../../site-data";

describe("subTopology", () => {
  // Two squares sharing an edge (arc 1, walked backwards by the second as ~1).
  const topo = {
    type: "Topology",
    transform: { scale: [1, 1], translate: [0, 0] },
    arcs: [
      [
        [0, 0],
        [1, 0],
      ],
      [
        [1, 0],
        [0, 1],
      ],
      [
        [1, 1],
        [-1, 0],
        [0, -1],
      ],
      [
        [1, 0],
        [1, 0],
        [0, 1],
        [-1, 0],
      ],
    ],
    objects: {
      areas: {
        type: "GeometryCollection",
        geometries: [
          { type: "Polygon", id: "A1", arcs: [[0, 1, 2]] },
          { type: "Polygon", id: "B1", arcs: [[3, ~1]] },
        ],
      },
    },
  };

  it("keeps only the arcs the chosen geometries use, renumbered in first-use order", () => {
    const b = subTopology(topo, "areas", (id) => id.startsWith("B"));
    expect(b.objects.areas!.geometries).toEqual([{ type: "Polygon", id: "B1", arcs: [[0, ~1]] }]);
    expect(b.arcs).toEqual([topo.arcs[3], topo.arcs[1]]);
    expect(b.transform).toEqual(topo.transform);
  });

  it("keeps everything when every geometry is chosen", () => {
    const all = subTopology(topo, "areas", () => true);
    expect(all.arcs).toEqual(topo.arcs);
    expect(all.objects.areas!.geometries).toEqual(topo.objects.areas.geometries);
  });
});
