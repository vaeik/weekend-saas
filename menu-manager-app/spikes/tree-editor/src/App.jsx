import React, { useMemo, useState, useCallback } from 'react';
import {
  Provider, TreeView, TreeViewItem, TreeViewItemContent, Text,
  useDragAndDrop, Button, InlineAlert, Heading, Content, Badge
} from '@react-spectrum/s2';
import { assembleTree, computeLevels, reorder } from './tree-esm.js';
import { MENU, ITEMS } from './data.js';

const MAX_LEVEL = 4;

export default function App () {
  const [items, setItems] = useState(ITEMS);
  const [error, setError] = useState(null);
  const [log, setLog] = useState([]);

  const { tree } = useMemo(() => assembleTree(items), [items]);
  const levels = useMemo(() => computeLevels(items), [items]);

  /**
   * The whole point of the spike: a drop is not applied optimistically. It is
   * run through the SHIPPED reorder() first, so the same cycle / maxLevel
   * guards that protect the action protect the UI, and a rejected drop leaves
   * the tree untouched.
   */
  const applyMove = useCallback((itemId, parentId, position) => {
    try {
      const { updates } = reorder(items, { itemId, newParentId: parentId, newPosition: position, maxLevel: MAX_LEVEL });
      const byId = Object.fromEntries(updates.map((u) => [u.id, u]));
      setItems((prev) => prev.map((i) => (byId[i.id] ? { ...i, ...byId[i.id] } : i)));
      setError(null);
      setLog((l) => [`moved ${itemId} -> parent=${parentId ?? 'ROOT'} pos=${position} (${updates.length} rows)`, ...l].slice(0, 6));
      return true;
    } catch (e) {
      setError(`${e.code}: ${e.message}`);
      setLog((l) => [`REJECTED ${itemId}: ${e.code}`, ...l].slice(0, 6));
      return false;
    }
  }, [items]);

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': String(key) })),
    // Allow dropping between siblings AND onto an item (= reparent).
    onReorder (e) {
      const moved = String([...e.keys][0]);
      const targetId = String(e.target.key);
      const target = items.find((i) => String(i.id) === targetId);
      if (!target) return;
      const parentId = target.parentId ?? null;
      const siblings = items
        .filter((i) => (parentId === null ? (i.parentId ?? null) === null : String(i.parentId) === String(parentId)))
        .filter((i) => String(i.id) !== moved)
        .sort((a, b) => a.position - b.position);
      const idx = siblings.findIndex((s) => String(s.id) === targetId);
      applyMove(moved, parentId, e.target.dropPosition === 'before' ? idx : idx + 1);
    },
    /**
     * SPIKE FINDING: dropping ONTO an item goes through onItemDrop, whose
     * `items` are React Aria DragItem objects — NOT keys. The id must be read
     * asynchronously via getText(type). Using `.key` silently yields
     * "[object Object]" and every reparent fails as NOT_FOUND.
     */
    async onItemDrop (e) {
      const [dragged] = e.items;
      if (!dragged || typeof dragged.getText !== 'function') return;
      const moved = String(await dragged.getText('text/plain'));
      applyMove(moved, String(e.target.key), 0);
    },
    acceptedDragTypes: ['text/plain'],
    getDropOperation: () => 'move'
  });

  const renderNodes = (nodes) => nodes.map((n) => (
    <TreeViewItem key={n.id} id={n.id} textValue={n.title}>
      <TreeViewItemContent>
        <Text>{n.title}</Text>
        <Text slot="description">
          {`L${levels.get(String(n.id))} · pos ${n.position}`}
          {n.categoryId ? ` · cat ${n.categoryId}` : ''}
          {n.isActive === false ? ' · DISABLED' : ''}
          {n.advertisement ? ' · promo' : ''}
        </Text>
      </TreeViewItemContent>
      {n.children?.length ? renderNodes(n.children) : null}
    </TreeViewItem>
  ));

  return (
    <Provider background="base">
      <div style={{ padding: 24, maxWidth: 820, fontFamily: 'system-ui' }}>
        <Heading level={1}>{MENU.title}</Heading>
        <Content>
          <p style={{ color: '#666', fontSize: 13 }}>
            R1 spike · React Spectrum S2 <code>TreeView</code> + <code>useDragAndDrop</code>,
            validated through the shipped <code>domain/tree.js</code>. Max level {MAX_LEVEL}.
          </p>
        </Content>

        {error && (
          <div style={{ margin: '12px 0' }} data-testid="error">
            <InlineAlert variant="negative">
              <Heading>Move rejected</Heading>
              <Content>{error}</Content>
            </InlineAlert>
          </div>
        )}

        <div data-testid="tree" style={{ marginTop: 16 }}>
          <TreeView
            aria-label="Menu items"
            selectionMode="multiple"
            defaultExpandedKeys={['sievietem', 'viriesiem', 'apavi-s']}
            dragAndDropHooks={dragAndDropHooks}
          >
            {renderNodes(tree)}
          </TreeView>
        </div>

        <div style={{ marginTop: 20, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="negative" data-testid="try-cycle"
            onPress={() => applyMove('sievietem', 'zabaki', 0)}>
            Try illegal move (cycle)
          </Button>
          <Button variant="negative" data-testid="try-depth"
            onPress={() => applyMove('sievietem', 'apavi-v', 0)}>
            Try illegal move (exceeds max level)
          </Button>
          <Button variant="secondary" data-testid="legal-move"
            onPress={() => applyMove('outlet', null, 0)}>
            Legal move (Outlet to first)
          </Button>
        </div>

        <pre data-testid="log" style={{ marginTop: 16, fontSize: 12, background: '#f4f5f7', padding: 10, borderRadius: 4, minHeight: 40 }}>
          {log.join('\n') || 'no moves yet'}
        </pre>

        <div style={{ marginTop: 12, fontSize: 12, color: '#666' }}>
          <Badge variant="informative">Keyboard DnD</Badge>{' '}
          Focus an item, press Enter to pick up, arrow keys to move, Enter to drop, Escape to cancel.
        </div>
      </div>
    </Provider>
  );
}
