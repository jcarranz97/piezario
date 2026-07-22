/**
 * The folder tree behind both sidebars.
 *
 * Models and fonts are both "things that live in nested folders", so the tree
 * is generic over the item type: give it a way to read an item's category path
 * and a label to sort by, and it rebuilds the nesting. Rebuilding it matters
 * because a flat path like `["decor", "gaming"]` is enough to filter on but
 * says nothing about shape — a label reading "DECOR / GAMING" doesn't convey
 * that *gaming* lives inside *decor*.
 */
export interface TreeNode<T> {
  /** Folder name. Empty string for the synthetic root. */
  name: string;
  /** Full path from the root, e.g. ["decor", "gaming"]. */
  path: string[];
  /** Stable id for keys and expansion state. "" for the root. */
  key: string;
  children: TreeNode<T>[];
  /** Items sitting directly in this folder (not in its children). */
  items: T[];
  /** Items in this folder *and* everything below it. */
  count: number;
}

function emptyNode<T>(name: string, path: string[]): TreeNode<T> {
  return { name, path, key: path.join("/"), children: [], items: [], count: 0 };
}

export function buildTree<T>(
  items: T[],
  categoriesOf: (item: T) => string[],
  labelOf: (item: T) => string,
): TreeNode<T> {
  const root = emptyNode<T>("", []);

  for (const item of items) {
    let node = root;
    for (const segment of categoriesOf(item)) {
      let child = node.children.find((candidate) => candidate.name === segment);
      if (!child) {
        child = emptyNode<T>(segment, [...node.path, segment]);
        node.children.push(child);
      }
      node = child;
    }
    node.items.push(item);
  }

  // Depth-first: sort children by name, items by label, and total the counts.
  const finalize = (node: TreeNode<T>): number => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.items.sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
    node.count =
      node.items.length +
      node.children.reduce((total, child) => total + finalize(child), 0);
    return node.count;
  };
  finalize(root);

  return root;
}

/**
 * Does `categories` sit inside `prefix`?
 *
 * Prefix matching is what makes selecting *decor* also show the items under
 * *decor/gaming*. An empty prefix matches everything.
 */
export function isUnder(categories: string[], prefix: string[]): boolean {
  return prefix.every((segment, index) => categories[index] === segment);
}
