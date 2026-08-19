/**
 * Pure tree logic for menu items. No I/O, no Adobe SDKs — this module is the
 * part of the app that must be provably correct, so it is kept dependency-free
 * and fully unit tested.
 *
 * Legacy parity note: Magento stored root items as `parent_id = 0`. This model
 * uses `parentId = null` for roots; the importer maps 0 -> null.
 */

/** Items whose parentId is missing/0/null are roots. */
const isRoot = (item) => item.parentId === null || item.parentId === undefined || item.parentId === 0;

const byPosition = (a, b) => {
  if (a.position !== b.position) return a.position - b.position;
  // Stable, deterministic tie-break so two items sharing a position never
  // swap order between requests (the legacy grid allowed duplicate positions).
  return String(a.id).localeCompare(String(b.id));
};

/**
 * Build a nested tree from a flat item list.
 * Items referencing a missing parent are treated as roots rather than dropped —
 * losing a menu branch silently is worse than showing it at top level.
 * @returns {{tree: object[], orphaned: string[]}}
 */
function assembleTree (items) {
  const byId = new Map();
  const orphaned = [];
  items.forEach((i) => byId.set(String(i.id), { ...i, children: [] }));

  const roots = [];
  byId.forEach((node) => {
    if (isRoot(node)) { roots.push(node); return; }
    const parent = byId.get(String(node.parentId));
    if (!parent) { orphaned.push(String(node.id)); roots.push(node); return; }
    parent.children.push(node);
  });

  const sortRec = (nodes) => {
    nodes.sort(byPosition);
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);

  return { tree: roots, orphaned };
}

/**
 * Recompute `level` for every item from its actual depth in the tree.
 * Roots are level 1, matching the legacy data (level is 1-based there).
 * Guards against cycles so a corrupt parent chain cannot hang an action.
 */
function computeLevels (items) {
  const { tree } = assembleTree(items);
  const out = new Map();
  const walk = (nodes, level, seen) => {
    nodes.forEach((n) => {
      const key = String(n.id);
      if (seen.has(key)) return; // cycle guard
      out.set(key, level);
      walk(n.children, level + 1, new Set([...seen, key]));
    });
  };
  walk(tree, 1, new Set());
  return out;
}

/** All descendant ids of `itemId`, cycle-safe. */
function descendantIds (items, itemId) {
  const childrenOf = new Map();
  items.forEach((i) => {
    const p = isRoot(i) ? '__root__' : String(i.parentId);
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(String(i.id));
  });
  const out = new Set();
  const stack = [String(itemId)];
  while (stack.length) {
    const cur = stack.pop();
    (childrenOf.get(cur) || []).forEach((c) => {
      if (out.has(c)) return;
      out.add(c);
      stack.push(c);
    });
  }
  return out;
}

/**
 * Move an item to a new parent/position and return the minimal set of writes.
 *
 * Refuses to move a node under itself or any of its own descendants — without
 * this the tree detaches from the root and the branch disappears from the
 * storefront with no error anywhere.
 *
 * @returns {{updates: {id, parentId, position, level}[]}}
 * @throws {Error} code CYCLE | NOT_FOUND | MAX_LEVEL
 */
function reorder (items, { itemId, newParentId = null, newPosition = 0, maxLevel = null }) {
  const id = String(itemId);
  const moving = items.find((i) => String(i.id) === id);
  if (!moving) { const e = new Error(`Item ${id} not found`); e.code = 'NOT_FOUND'; throw e; }

  const targetParent = newParentId === null || newParentId === undefined ? null : String(newParentId);

  if (targetParent === id) { const e = new Error('An item cannot be its own parent'); e.code = 'CYCLE'; throw e; }
  if (targetParent !== null) {
    if (!items.some((i) => String(i.id) === targetParent)) {
      const e = new Error(`Parent ${targetParent} not found`); e.code = 'NOT_FOUND'; throw e;
    }
    if (descendantIds(items, id).has(targetParent)) {
      const e = new Error('Cannot move an item beneath its own descendant'); e.code = 'CYCLE'; throw e;
    }
  }

  const next = items.map((i) => (String(i.id) === id ? { ...i, parentId: targetParent } : { ...i }));

  if (maxLevel !== null) {
    const levels = computeLevels(next);
    const subtree = new Set([id, ...descendantIds(next, id)]);
    let deepest = 0;
    subtree.forEach((s) => { deepest = Math.max(deepest, levels.get(s) || 0); });
    if (deepest > maxLevel) {
      const e = new Error(`Move would nest to level ${deepest}, exceeding maxLevel ${maxLevel}`);
      e.code = 'MAX_LEVEL';
      throw e;
    }
  }

  // Renumber the destination sibling group 0..n-1 with the moved item inserted
  // at newPosition. Dense renumbering removes the duplicate and gappy positions the
  // legacy grid accumulated.
  const siblings = next
    .filter((i) => String(i.id) !== id)
    .filter((i) => (targetParent === null ? isRoot(i) : String(i.parentId) === targetParent))
    .sort(byPosition);

  const clamped = Math.max(0, Math.min(Number(newPosition) || 0, siblings.length));
  siblings.splice(clamped, 0, next.find((i) => String(i.id) === id));

  const levels = computeLevels(next);
  const updates = siblings.map((s, idx) => ({
    id: String(s.id),
    parentId: targetParent,
    position: idx,
    level: levels.get(String(s.id)) || 1
  }));

  // The moved item changes level for its whole subtree, so those rows need
  // writing too even though their parent/position are unchanged.
  descendantIds(next, id).forEach((d) => {
    const node = next.find((i) => String(i.id) === d);
    updates.push({
      id: d,
      parentId: node.parentId === null ? null : String(node.parentId),
      position: node.position,
      level: levels.get(d) || 1
    });
  });

  return { updates };
}

/**
 * Flatten a menu into the storefront payload.
 *
 * Deliberately FLAT (plan §3): API Mesh `queryConfig.maxDepth` has a documented
 * ceiling of 6, and a recursive `children` selection burns ~2 depth levels per
 * menu tier. The EDS header block reassembles the tree client-side from
 * parent_id + level.
 *
 * Field names are the LEGACY snake_case GraphQL names so the storefront
 * contract from `scandiwebMenu` is preserved exactly.
 */
function flattenForStorefront (menu, items, { maxLevel = 4 } = {}) {
  const levels = computeLevels(items);
  const active = items.filter((i) => i.isActive !== false && (levels.get(String(i.id)) || 1) <= maxLevel);

  // Drop items whose ancestor chain contains a disabled item — the legacy
  // resolver rendered nothing under a disabled parent.
  const activeIds = new Set(active.map((i) => String(i.id)));
  const visible = active.filter((i) => isRoot(i) || activeIds.has(String(i.parentId)));

  const { tree } = assembleTree(visible);
  const ordered = [];
  const walk = (nodes) => nodes.forEach((n) => { ordered.push(n); walk(n.children); });
  walk(tree);

  return {
    menu_id: String(menu.id),
    title: menu.title,
    is_active: menu.isActive !== false,
    css_class: menu.cssClass || null,
    items: ordered.map((i) => ({
      item_id: String(i.id),
      parent_id: isRoot(i) ? null : String(i.parentId),
      level: levels.get(String(i.id)) || 1,
      position: i.position,
      title: i.title,
      item_class: i.itemClass || null,
      icon: i.icon || null,
      url: i.url || null,
      url_type: i.urlType ?? 0,
      is_active: i.isActive !== false,
      category_id: i.categoryId ?? null,
      // Resolved from the event-maintained categorySnapshot. Without this the
      // storefront would have to call Commerce per category item to turn an id
      // into a URL — which is exactly the per-request coupling the snapshot
      // exists to avoid.
      category_url_key: i.categorySnapshot?.urlKey ?? null,
      cms_page_identifier: i.cmsPageIdentifier ?? null,
      advertisement: i.advertisement || null,
      advertisement_link: i.advertisementLink || null,
      advertisement_second: i.advertisementSecond || null,
      advertisement_second_link: i.advertisementSecondLink || null,
      custom_redirect: i.customRedirect || null,
      is_promo: i.isPromo ?? null,
      promo_image: i.promoImage || null,
      is_with_cms_block: i.isWithCmsBlock ?? null
    }))
  };
}

module.exports = { assembleTree, computeLevels, descendantIds, reorder, flattenForStorefront, isRoot };
