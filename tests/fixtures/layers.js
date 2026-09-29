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
  return {
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
        id: "/Model/A",
        name: "Module A",
        parts: [
          panel("/Model/A/P1", -20),
          {
            id: "/Model/A/Hardware",
            name: "Крепёж",
            layer: "hardware",
            parts: [
              {
                id: "/Model/A/Hardware/Bolt",
                name: "Bolt",
                visible_if_any: ["/Model/A/P1", "/Model/B/P2"],
                parts: [solid("/Model/A/Hardware/Bolt/Body", 0, "#ddaa55")],
              },
            ],
          },
        ],
      },
      {
        id: "/Model/B",
        name: "Module B",
        parts: [panel("/Model/B/P2", 20, "facades")],
      },
      {
        id: "/Model/Walls",
        name: "Стены",
        layer: "walls",
        parts: [solid("/Model/Walls/Body", 50, "#eed888")],
      },
    ],
  };
}
