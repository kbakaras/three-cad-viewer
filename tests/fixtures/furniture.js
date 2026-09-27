import * as THREE from "three";

function cadShape(geometry) {
  const edges = new THREE.EdgesGeometry(geometry);
  const triangles =
    geometry.index?.array ??
    Uint32Array.from(
      { length: geometry.attributes.position.count },
      (_, i) => i,
    );
  const result = {
    vertices: new Float32Array(geometry.attributes.position.array),
    normals: new Float32Array(geometry.attributes.normal.array),
    triangles: new Uint32Array(triangles),
    edges: new Float32Array(edges.attributes.position.array),
    obj_vertices: new Float32Array(geometry.attributes.position.array),
    face_types: new Uint32Array([0]),
    edge_types: new Uint32Array(edges.attributes.position.count / 2),
    triangles_per_face: new Uint32Array([triangles.length / 3]),
    segments_per_edge: new Uint32Array(
      edges.attributes.position.count / 2,
    ).fill(1),
  };
  edges.dispose();
  geometry.dispose();
  return result;
}

function encode(shape) {
  return Object.fromEntries(
    Object.entries(shape).map(([key, data]) => [
      key,
      {
        shape: [data.length],
        dtype: data instanceof Float32Array ? "float32" : "uint32",
        codec: "b64",
        buffer: btoa(String.fromCharCode(...new Uint8Array(data.buffer))),
      },
    ]),
  );
}

export function makeFurniture(
  count = 100,
  { encoded = false, extras = false } = {},
) {
  const geometries = [
    cadShape(new THREE.CylinderGeometry(2.5, 2.5, 8, 12)),
    cadShape(new THREE.TorusGeometry(3, 0.7, 6, 16)),
    cadShape(new THREE.BoxGeometry(6, 3, 2)),
    cadShape(new THREE.BoxGeometry(12 * Math.ceil(Math.sqrt(count)), 18, 12)),
  ];
  const columns = Math.ceil(Math.sqrt(count));
  const parts = Array.from({ length: count }, (_, i) => ({
    id: `/Furniture/Hardware/Fastener${i}`,
    name: `Fastener${i}`,
    type: "shapes",
    subtype: "solid",
    shape: encoded ? { ref: i % 3 } : geometries[i % 3],
    color: i % 2 ? "#a0a4a8" : "#c5b258",
    alpha: 1,
    state: [1, 1],
    loc: [
      [(i % columns) * 12, Math.floor(i / columns) * 12, 15],
      [0, 0, Math.sin((i % 5) / 8), Math.cos((i % 5) / 8)],
    ],
  }));
  if (extras) {
    parts[0].state = [0, 0];
    parts[1].alpha = 0.5;
  }
  const shapes = {
    version: 3,
    id: "/Furniture",
    name: "Furniture",
    loc: [
      [0, 0, 0],
      [0, 0, 0, 1],
    ],
    parts: [
      {
        version: 3,
        id: "/Furniture/Hardware",
        name: "Hardware",
        loc: [
          [5, 10, 0],
          [0, 0, Math.sin(0.08), Math.cos(0.08)],
        ],
        parts,
      },
      {
        id: "/Furniture/Panel",
        name: "Panel",
        type: "shapes",
        subtype: "solid",
        shape: encoded ? { ref: 3 } : geometries[3],
        color: "#82a3ad",
        alpha: 1,
        state: [1, 1],
        loc: [
          [columns * 6, -18, 0],
          [0, 0, 0, 1],
        ],
      },
    ],
  };
  return encoded ? { instances: geometries.map(encode), shapes } : shapes;
}
