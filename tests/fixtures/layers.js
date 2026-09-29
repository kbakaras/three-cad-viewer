import { makeFurniture } from "./furniture.js";

export function makeLayeredFurniture() {
  const shape = makeFurniture(1).parts[1].shape;
  const solid = (id, x = 0, color = "#82a3ad") => ({
    id,
    name: id.split("/").pop(),
    type: "shapes",
    subtype: "solid",
    shape,
    color,
    alpha: 1,
    state: [1, 1],
    loc: [
      [x, 0, 0],
      [0, 0, 0, 1],
    ],
  });
  const panel = (id, x, layer) => ({
    id,
    name: id.split("/").pop(),
    layer,
    parts: [
      solid(`${id}/Body`, x),
      {
        id: `${id}/Name`,
        name: "Название",
        layer: "labels",
        visible_if_any: [id],
        parts: [solid(`${id}/Name/Text`, x + 2, "#303030")],
      },
    ],
  });
  const model = {
    version: 3,
    id: "/Model",
    name: "Model",
    layers: {
      labels: "Названия панелей",
      facades: "Фасады",
      hardware: "Фурнитура",
      walls: "Стены",
    },
    parts: [
      {
        id: "/Model/Product",
        name: "Изделие",
        parts: [
          {
            id: "/Model/Product/A",
            name: "Module A",
            parts: [panel("/Model/Product/A/P1", -20)],
          },
          {
            id: "/Model/Product/B",
            name: "Module B",
            parts: [panel("/Model/Product/B/P2", 20, "facades")],
          },
        ],
      },
      {
        id: "/Model/Hardware",
        name: "Фурнитура",
        layer: "hardware",
        parts: [
          {
            id: "/Model/Hardware/Bolts",
            name: "Конфирматы",
            tree_leaf: true,
            parts: [
              {
                id: "/Model/Hardware/Bolts/Bolt",
                name: "Bolt",
                visible_if_any: ["/Model/Product/A/P1", "/Model/Product/B/P2"],
                visibility_owner: "/Model/Product/A",
                parts: [solid("/Model/Hardware/Bolts/Bolt/Body", 0, "#ddaa55")],
              },
              {
                id: "/Model/Hardware/Bolts/BoltB",
                name: "Bolt B",
                visible_if_any: ["/Model/Product/B/P2"],
                visibility_owner: "/Model/Product/B",
                parts: [
                  solid("/Model/Hardware/Bolts/BoltB/Body", 30, "#ddaa55"),
                ],
              },
            ],
          },
          {
            id: "/Model/Hardware/Dowels",
            name: "Шканты",
            tree_leaf: true,
            parts: [
              {
                id: "/Model/Hardware/Dowels/Dowel",
                name: "Dowel",
                visible_if_any: ["/Model/Product/A/P1"],
                visibility_owner: "/Model/Product/A",
                parts: [
                  solid("/Model/Hardware/Dowels/Dowel/Body", -10, "#ba9060"),
                ],
              },
            ],
          },
        ],
      },
      {
        id: "/Model/Walls",
        name: "Стены",
        layer: "walls",
        parts: [solid("/Model/Walls/Body", 50, "#eed888")],
      },
    ],
  };
  const versioned = (node) => {
    node.version = 3;
    node.parts?.forEach(versioned);
  };
  versioned(model);
  return model;
}
