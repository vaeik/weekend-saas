import type { FlatRow, MenuItem, MenuNode } from "#web/lib/types.ts";
import { URL_TYPE } from "#web/lib/types.ts";

/** Walk the nested tree into ordered flat rows, each tagged with its depth. */
export function flattenTree(nodes: MenuNode[], depth = 0, out: FlatRow[] = []): FlatRow[] {
  for (const node of nodes) {
    const { children, ...item } = node;
    out.push({ ...(item as MenuItem), depth });
    flattenTree(children, depth + 1, out);
  }
  return out;
}

/** Human label for an item's link target. */
export function targetLabel(item: MenuItem): string {
  if (item.urlType === URL_TYPE.CATEGORY) return `Category #${item.categoryId ?? "?"}`;
  if (item.urlType === URL_TYPE.CMS_PAGE) return `CMS page #${item.cmsPageId ?? "?"}`;
  return item.url || "—";
}

/** Human label for the link type. */
export function typeLabel(urlType?: number): string {
  if (urlType === URL_TYPE.CATEGORY) return "Category";
  if (urlType === URL_TYPE.CMS_PAGE) return "CMS page";
  return "Link";
}

/**
 * Ids that cannot become a parent of `itemId`: itself and all its descendants
 * (moving a node under its own subtree would detach the branch — the backend
 * guards this too, but the picker should not offer it).
 */
export function forbiddenParentIds(items: MenuItem[], itemId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const i of items) {
    const p = i.parentId == null ? "__root__" : String(i.parentId);
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p)!.push(String(i.id));
  }
  const out = new Set<string>([String(itemId)]);
  const stack = [String(itemId)];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of childrenOf.get(cur) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}
