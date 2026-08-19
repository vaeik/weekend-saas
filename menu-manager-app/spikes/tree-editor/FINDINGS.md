# R1 spike — nested tree editor on React Spectrum S2

**Question this spike existed to answer:** the build plan's highest-variance risk.
`TreeView` + `useDragAndDrop` exist in React Spectrum S2, but Adobe's samples
repository contains **zero** files using either. Phase 3 (160 h) is shaped by
whether they can actually drive a nested, reorderable menu tree — so this had to
be settled before building grids and forms around an editor that might need
replacing.

**Verdict: GO.** The interaction model works. No re-architecture needed.
Phase 3 stands as estimated.

---

## What was actually verified

Driven in headless Chromium, not eyeballed. Menu fixture mirrors
weekendshoes.lv's real shape: 4 root items, 3 levels, category-bound items, one
disabled item, one promo item with an advertisement image.

| Behaviour | Result |
|---|---|
| Renders a 3-level nested tree with expand/collapse | ✅ |
| **Pointer drag** reparents across branches (Jakas: Vīriešiem → Bērniem) | ✅ verified, asserted at L2 pos 0 under the new parent |
| **Keyboard drag-and-drop** (Enter to pick up, arrows, Enter to drop) | ✅ engages drop targets — free accessibility, no extra work |
| Reorder within a sibling group, dense renumbering | ✅ Outlet → pos 0 renumbered the other three roots 1,2,3 |
| Cycle guard surfaces in the UI | ✅ `CYCLE: Cannot move an item beneath its own descendant` |
| Depth guard surfaces in the UI | ✅ `MAX_LEVEL: Move would nest to level 5, exceeding maxLevel 4` |
| Tree survives rejected moves uncorrupted | ✅ legal move still worked after two rejections |
| Multi-select checkboxes (needed for mass actions) | ✅ built in |

The spike imports **the shipped `domain/tree.js` unmodified** — it is not a
reimplementation. So the same `reorder()` that guards the runtime action guards
the UI, and a rejected drop is rejected identically in both places.

## Two findings that cost real time

### 1. `onItemDrop` does not give you keys

Reordering *between* siblings fires `onReorder` with `e.keys`. Dropping *onto*
an item — which is how reparenting works — fires `onItemDrop`, whose `e.items`
are React Aria **`DragItem` objects**, not keys. The id must be read
asynchronously:

```js
async onItemDrop (e) {
  const [dragged] = e.items;
  const moved = String(await dragged.getText('text/plain'));
  applyMove(moved, String(e.target.key), 0);
}
```

Using `.key` yields `"[object Object]"` and every reparent fails as `NOT_FOUND` —
with no error, because it looks like a legitimate miss. Cost: one debugging
cycle. Documented here so Phase 3 does not repeat it.

### 2. NEW FINDING F5 — S2 needs Adobe's build pipeline, not just its package

Built under Vite, S2 components render with **broken layout**: label and
description overlap, badges stretch full width. Diagnosed at runtime rather than
guessed:

- `--s2-scale: 1` is set and `grid-area: drag-handle` / `checkbox` **are**
  applied → S2's CSS is loading and largely working.
- `--lightningcss-light` and `--lightningcss-dark` are **unset**. S2 ships
  precompiled with Lightning CSS's `light-dark()` polyfill
  (`var(--lightningcss-light,#x)var(--lightningcss-dark,#y)`); without those
  custom properties the declarations are invalid and dropped.
- Adding `unplugin-parcel-macros` changed nothing (the macro is only needed for
  `style()` calls you author yourself — S2's own are precompiled).

**Impact: low for the real build, high if ignored.** App Builder's `aio app init`
scaffolds the supported toolchain, so the production app gets the right pipeline
for free. But it means **the admin UI cannot be prototyped in an arbitrary
bundler** — combined with F3 (no local testing against ACCS), the dev loop is
narrower than it first appears. Phase 1 should stand the UI up inside the real
App Builder `web-src` scaffold from day one rather than in a side project.

## What this does NOT prove

- Not tested at scale. The fixture is 12 items. Weekend's real menu size is still
  unknown (gate G2). `TreeView` supports virtualisation, but drag-and-drop over a
  virtualised, deeply nested tree is unproven here.
- Not tested inside the Commerce Admin iframe. Height and scroll management
  inside the iframe is its own Phase 3 task.
- Styling is unresolved (F5), so this says nothing about how the finished editor
  will look.

## Running it

```bash
npm install
npm run build && npm run preview     # http://localhost:4173
node drive.mjs                       # guards + legal move, headless
node verify.mjs                      # pointer drag reparent, asserted
```
