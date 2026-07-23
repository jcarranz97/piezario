import { describe, expect, it } from "vitest";

import { buildTree, isUnder } from "../lib/tree";

interface Item {
  categories: string[];
  label: string;
}

const categoriesOf = (i: Item) => i.categories;
const labelOf = (i: Item) => i.label;

describe("buildTree", () => {
  it("nests items by their category path and totals counts up the tree", () => {
    const items: Item[] = [
      { categories: ["decor"], label: "Vase" },
      { categories: ["decor", "gaming"], label: "Controller" },
      { categories: ["keychains"], label: "Nametag" },
    ];
    const root = buildTree(items, categoriesOf, labelOf);

    expect(root.count).toBe(3);
    expect(root.children.map((c) => c.name)).toEqual(["decor", "keychains"]);

    const decor = root.children.find((c) => c.name === "decor")!;
    expect(decor.count).toBe(2); // its own item + the nested one
    expect(decor.items.map(labelOf)).toEqual(["Vase"]);
    expect(decor.children[0].name).toBe("gaming");
    expect(decor.children[0].path).toEqual(["decor", "gaming"]);
    expect(decor.children[0].key).toBe("decor/gaming");
  });

  it("sorts children by name and items by label", () => {
    const items: Item[] = [
      { categories: [], label: "Zebra" },
      { categories: [], label: "Apple" },
      { categories: ["zzz"], label: "x" },
      { categories: ["aaa"], label: "y" },
    ];
    const root = buildTree(items, categoriesOf, labelOf);
    expect(root.items.map(labelOf)).toEqual(["Apple", "Zebra"]);
    expect(root.children.map((c) => c.name)).toEqual(["aaa", "zzz"]);
  });
});

describe("isUnder", () => {
  it("matches a prefix of the category path", () => {
    expect(isUnder(["decor", "gaming"], ["decor"])).toBe(true);
    expect(isUnder(["decor", "gaming"], ["decor", "gaming"])).toBe(true);
    expect(isUnder(["decor"], ["decor", "gaming"])).toBe(false);
    expect(isUnder(["keychains"], ["decor"])).toBe(false);
  });

  it("treats an empty prefix as matching everything", () => {
    expect(isUnder(["anything"], [])).toBe(true);
    expect(isUnder([], [])).toBe(true);
  });
});
