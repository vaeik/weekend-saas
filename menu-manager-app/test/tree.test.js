const {
  assembleTree, computeLevels, descendantIds, reorder, flattenForStorefront
} = require('../src/commerce-backend-ui-1/domain/tree');

const item = (id, parentId, position, extra = {}) => ({
  id, parentId, position, title: `Item ${id}`, isActive: true, ...extra
});

// men > shoes > sneakers ; women
const sample = () => [
  item('men', null, 0),
  item('women', null, 1),
  item('shoes', 'men', 0),
  item('boots', 'men', 1),
  item('sneakers', 'shoes', 0)
];

describe('assembleTree', () => {
  test('nests children under parents and sorts by position', () => {
    const { tree } = assembleTree(sample());
    expect(tree.map((n) => n.id)).toEqual(['men', 'women']);
    expect(tree[0].children.map((n) => n.id)).toEqual(['shoes', 'boots']);
    expect(tree[0].children[0].children.map((n) => n.id)).toEqual(['sneakers']);
  });

  test('treats legacy parent_id = 0 as a root', () => {
    const { tree } = assembleTree([item('a', 0, 0), item('b', null, 1)]);
    expect(tree.map((n) => n.id)).toEqual(['a', 'b']);
  });

  test('promotes items with a missing parent to root instead of dropping them', () => {
    const { tree, orphaned } = assembleTree([item('a', null, 0), item('ghost', 'gone', 5)]);
    expect(orphaned).toEqual(['ghost']);
    expect(tree.map((n) => n.id).sort()).toEqual(['a', 'ghost']);
  });

  test('breaks position ties deterministically', () => {
    const a = assembleTree([item('b', null, 0), item('a', null, 0)]).tree.map((n) => n.id);
    const b = assembleTree([item('a', null, 0), item('b', null, 0)]).tree.map((n) => n.id);
    expect(a).toEqual(b);
  });
});

describe('computeLevels', () => {
  test('is 1-based and reflects real depth', () => {
    const l = computeLevels(sample());
    expect(l.get('men')).toBe(1);
    expect(l.get('shoes')).toBe(2);
    expect(l.get('sneakers')).toBe(3);
  });

  test('does not hang on a corrupt parent cycle', () => {
    const cyclic = [item('a', 'b', 0), item('b', 'a', 0)];
    expect(() => computeLevels(cyclic)).not.toThrow();
  });
});

describe('descendantIds', () => {
  test('collects the whole subtree', () => {
    expect([...descendantIds(sample(), 'men')].sort()).toEqual(['boots', 'shoes', 'sneakers']);
  });
  test('is empty for a leaf', () => {
    expect([...descendantIds(sample(), 'sneakers')]).toEqual([]);
  });
});

describe('reorder', () => {
  test('renumbers the destination sibling group densely', () => {
    const { updates } = reorder(sample(), { itemId: 'boots', newParentId: null, newPosition: 0 });
    const roots = updates.filter((u) => u.parentId === null).sort((a, b) => a.position - b.position);
    expect(roots.map((u) => u.id)).toEqual(['boots', 'men', 'women']);
    expect(roots.map((u) => u.position)).toEqual([0, 1, 2]);
  });

  test('refuses to move an item under its own descendant', () => {
    expect(() => reorder(sample(), { itemId: 'men', newParentId: 'sneakers' }))
      .toThrow(/beneath its own descendant/);
  });

  test('refuses to make an item its own parent', () => {
    expect(() => reorder(sample(), { itemId: 'men', newParentId: 'men' })).toThrow(/its own parent/);
  });

  test('rejects a move that would exceed maxLevel', () => {
    // moving `men` (subtree depth 3) under `women` would push sneakers to 4
    expect(() => reorder(sample(), { itemId: 'men', newParentId: 'women', maxLevel: 3 }))
      .toThrow(/exceeding maxLevel/);
  });

  test('allows the same move when maxLevel permits it', () => {
    expect(() => reorder(sample(), { itemId: 'men', newParentId: 'women', maxLevel: 4 })).not.toThrow();
  });

  test('rewrites levels for the moved subtree, not just the moved node', () => {
    const { updates } = reorder(sample(), { itemId: 'shoes', newParentId: null, newPosition: 0 });
    const byId = Object.fromEntries(updates.map((u) => [u.id, u]));
    expect(byId.shoes.level).toBe(1);
    expect(byId.sneakers.level).toBe(2);
  });

  test('throws NOT_FOUND for an unknown item or parent', () => {
    expect(() => reorder(sample(), { itemId: 'nope' })).toThrow(/not found/);
    expect(() => reorder(sample(), { itemId: 'men', newParentId: 'nope' })).toThrow(/not found/);
  });
});

describe('flattenForStorefront', () => {
  const menu = { id: 'm1', identifier: 'main', title: 'Main', isActive: true, cssClass: 'nav' };

  test('emits a flat, depth-first ordered list with legacy field names', () => {
    const out = flattenForStorefront(menu, sample());
    expect(out.menu_id).toBe('m1');
    expect(out.items.map((i) => i.item_id)).toEqual(['men', 'shoes', 'sneakers', 'boots', 'women']);
    expect(out.items[1]).toMatchObject({ parent_id: 'men', level: 2 });
    expect(Object.keys(out.items[0])).toEqual(expect.arrayContaining(['item_id', 'parent_id', 'url_type', 'is_active']));
  });

  test('hides disabled items and everything beneath them', () => {
    const items = sample().map((i) => (i.id === 'shoes' ? { ...i, isActive: false } : i));
    const ids = flattenForStorefront(menu, items).items.map((i) => i.item_id);
    expect(ids).not.toContain('shoes');
    expect(ids).not.toContain('sneakers'); // orphaned by its disabled parent
    expect(ids).toContain('boots');
  });

  test('respects maxLevel', () => {
    const out = flattenForStorefront(menu, sample(), { maxLevel: 2 });
    expect(out.items.map((i) => i.item_id)).not.toContain('sneakers');
  });

  test('never nests — the payload stays within API Mesh maxDepth', () => {
    const out = flattenForStorefront(menu, sample());
    out.items.forEach((i) => expect(i.children).toBeUndefined());
  });
});


describe('flattenForStorefront — category URLs', () => {
  const menu = { id: 'm1', identifier: 'main', title: 'Main', isActive: true };

  test('exposes the snapshot url key so the storefront never calls Commerce per item', () => {
    const items = [{
      id: 'a', parentId: null, position: 0, title: 'Apavi', isActive: true,
      urlType: 2, categoryId: 111, categorySnapshot: { urlKey: 'sieviesu-apavi', name: 'Apavi' }
    }];
    expect(flattenForStorefront(menu, items).items[0]).toMatchObject({
      url_type: 2, category_id: 111, category_url_key: 'sieviesu-apavi'
    });
  });

  test('is null when the snapshot has not synced yet', () => {
    const items = [{ id: 'a', parentId: null, position: 0, title: 'X', isActive: true, urlType: 2, categoryId: 9 }];
    expect(flattenForStorefront(menu, items).items[0].category_url_key).toBeNull();
  });
});
