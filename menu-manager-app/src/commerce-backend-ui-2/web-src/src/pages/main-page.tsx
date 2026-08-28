import { useCallback, useEffect, useMemo, useState } from "react";
import type { Key } from "react";
import { useIms } from "@adobe/aio-commerce-lib-admin-ui/web";
import {
  ActionButton,
  ActionMenu,
  AlertDialog,
  Button,
  Content,
  DialogContainer,
  Divider,
  Heading,
  IllustratedMessage,
  InlineAlert,
  MenuItem as ActionMenuItem,
  ProgressCircle,
  StatusLight,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  ToastContainer,
  ToastQueue,
} from "@react-spectrum/s2";

import { createMenuApi } from "#web/lib/menu-api.ts";
import type {
  CatalogData,
  FlatRow,
  ItemDraft,
  Menu,
  MenuItem,
  MenuNode,
} from "#web/lib/types.ts";
import { URL_TYPE } from "#web/lib/types.ts";
import { flattenTree, forbiddenParentIds, targetLabel } from "#web/lib/tree-util.ts";
import { ItemGrid } from "#web/components/item-grid.tsx";
import type { RowActionKey } from "#web/components/item-grid.tsx";
import { ItemEditPage } from "#web/pages/item-edit-page.tsx";

type EditView = { kind: "edit"; draft: ItemDraft; heading: string; isNew: boolean };
type View = { kind: "list" } | EditView;

const byPosition = (a: MenuItem, b: MenuItem) =>
  a.position - b.position || String(a.id).localeCompare(String(b.id));

function emptyDraft(menuId: string, parentId: string | null, position: number): ItemDraft {
  return {
    menuId,
    parentId,
    title: "",
    urlType: URL_TYPE.LINK,
    url: "",
    categoryId: null,
    cmsPageId: null,
    openType: 0,
    position,
    isActive: true,
    identifier: "",
    itemClass: "",
    icon: "",
    iconAlt: "",
    advertisement: "",
    advertisementLink: "",
    advertisementSecond: "",
    advertisementSecondLink: "",
    promoImage: "",
    isPromo: false,
    isWithCmsBlock: false,
    customRedirect: "",
  };
}

function toDraft(item: MenuItem): ItemDraft {
  return {
    id: item.id,
    menuId: item.menuId,
    parentId: item.parentId,
    title: item.title ?? "",
    urlType: item.urlType ?? URL_TYPE.LINK,
    url: item.url ?? "",
    categoryId: item.categoryId ?? null,
    cmsPageId: item.cmsPageId ?? null,
    openType: item.openType ?? 0,
    position: item.position ?? 0,
    isActive: item.isActive !== false,
    identifier: item.identifier ?? "",
    itemClass: item.itemClass ?? "",
    icon: item.icon ?? "",
    iconAlt: item.iconAlt ?? "",
    advertisement: item.advertisement ?? "",
    advertisementLink: item.advertisementLink ?? "",
    advertisementSecond: item.advertisementSecond ?? "",
    advertisementSecondLink: item.advertisementSecondLink ?? "",
    promoImage: item.promoImage ?? "",
    isPromo: item.isPromo === true,
    isWithCmsBlock: item.isWithCmsBlock === true,
    customRedirect: item.customRedirect ?? "",
  };
}

export function MainPage() {
  const { data, error: imsError } = useIms();
  const token = data?.imsToken ?? null;
  const orgId = data?.imsOrgId ?? null;
  const api = useMemo(
    () => (token && orgId ? createMenuApi(token, orgId) : null),
    [token, orgId],
  );

  const [menu, setMenu] = useState<Menu | null>(null);
  const [tree, setTree] = useState<MenuNode[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<string>("tree");
  const [view, setView] = useState<View>({ kind: "list" });
  const [deleteTarget, setDeleteTarget] = useState<MenuItem | null>(null);
  const [catalog, setCatalog] = useState<CatalogData>({ categories: [], cmsPages: [] });

  const rows: FlatRow[] = useMemo(() => flattenTree(tree), [tree]);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setLoadError(null);
    try {
      const menus = await api.listMenus();
      if (menus.length === 0) {
        setMenu(null);
        setTree([]);
        setItems([]);
        return;
      }
      const chosen = menus.find((m) => m.identifier === "main") ?? menus[0];
      setMenu(chosen);
      const res = await api.listItems(chosen.id);
      setTree(res.tree ?? []);
      setItems(res.items ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // Catalog (categories / CMS pages) for the editor pickers — loaded once,
  // best-effort: a failure just falls the editor back to manual id entry.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    api
      .listCatalog()
      .then((c) => {
        if (!cancelled) setCatalog({ categories: c.categories ?? [], cmsPages: c.cmsPages ?? [] });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api]);

  const siblingsOf = useCallback(
    (parentId: string | null) =>
      items
        .filter((i) => (i.parentId ?? null) === (parentId ?? null))
        .sort(byPosition),
    [items],
  );

  const openAdd = (parentId: string | null) => {
    if (!menu) return;
    const position = siblingsOf(parentId).length;
    setView({
      kind: "edit",
      isNew: true,
      draft: emptyDraft(menu.id, parentId, position),
      heading: parentId ? "Add sub-item" : "Add top-level item",
    });
  };

  const openEdit = (item: MenuItem) => {
    setView({ kind: "edit", isNew: false, draft: toDraft(item), heading: `Edit “${item.title}”` });
  };

  const saveItem = async (draft: ItemDraft) => {
    if (!api) return;
    setBusy(true);
    try {
      await api.saveItem(draft);
      ToastQueue.positive(draft.id ? "Item updated" : "Item added", { timeout: 3000 });
      setView({ kind: "list" });
      await load();
    } catch (e) {
      ToastQueue.negative(e instanceof Error ? e.message : "Save failed", { timeout: 6000 });
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (item: MenuItem) => {
    if (!api) return;
    setBusy(true);
    try {
      await api.deleteItem(item.id);
      ToastQueue.positive("Item deleted", { timeout: 3000 });
      setDeleteTarget(null);
      setView({ kind: "list" });
      await load();
    } catch (e) {
      ToastQueue.negative(e instanceof Error ? e.message : "Delete failed", { timeout: 6000 });
    } finally {
      setBusy(false);
    }
  };

  const move = async (item: MenuItem, dir: "up" | "down") => {
    if (!api) return;
    const sibs = siblingsOf(item.parentId ?? null);
    const idx = sibs.findIndex((s) => String(s.id) === String(item.id));
    const target = dir === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || target < 0 || target >= sibs.length) return;
    setBusy(true);
    try {
      await api.reorderItem(item.id, item.parentId ?? null, target);
      await load();
    } catch (e) {
      ToastQueue.negative(e instanceof Error ? e.message : "Reorder failed", { timeout: 6000 });
    } finally {
      setBusy(false);
    }
  };

  const dispatchRowAction = (item: MenuItem, key: RowActionKey | string) => {
    switch (key) {
      case "edit":
        openEdit(item);
        break;
      case "add-child":
        openAdd(item.id);
        break;
      case "up":
        void move(item, "up");
        break;
      case "down":
        void move(item, "down");
        break;
      case "delete":
        setDeleteTarget(item);
        break;
      default:
        break;
    }
  };

  const parentOptionsFor = (isNew: boolean, draft: ItemDraft): { id: string; label: string }[] => {
    const forbidden = !isNew && draft.id ? forbiddenParentIds(items, draft.id) : new Set<string>();
    return rows
      .filter((r) => !forbidden.has(String(r.id)))
      .map((r) => ({ id: String(r.id), label: `${"— ".repeat(r.depth)}${r.title}` }));
  };

  const renderTree = (nodes: MenuNode[], depth: number) =>
    nodes.map((node) => (
      <div key={node.id}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 12px",
            marginInlineStart: depth * 24,
            borderBottom: "1px solid var(--s2-container-border, rgba(0,0,0,0.08))",
            minHeight: 44,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Text>
                <strong>{node.title}</strong>
              </Text>
              {node.isActive === false && (
                <StatusLight variant="neutral" size="S">
                  Inactive
                </StatusLight>
              )}
            </div>
            <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>{targetLabel(node)}</div>
          </div>

          <ActionMenu
            aria-label={`Actions for ${node.title}`}
            isQuiet
            onAction={(key: Key) => dispatchRowAction(node, String(key))}
          >
            <ActionMenuItem id="add-child">Add sub-item</ActionMenuItem>
            <ActionMenuItem id="edit">Edit</ActionMenuItem>
            <ActionMenuItem id="up">Move up</ActionMenuItem>
            <ActionMenuItem id="down">Move down</ActionMenuItem>
            <ActionMenuItem id="delete">Delete</ActionMenuItem>
          </ActionMenu>
        </div>
        {node.children.length > 0 && renderTree(node.children, depth + 1)}
      </div>
    ));

  // ---- render --------------------------------------------------------------

  if (imsError) {
    return (
      <div style={{ padding: 24 }}>
        <InlineAlert variant="negative">
          <Heading>Could not authenticate</Heading>
          <Content>{imsError instanceof Error ? imsError.message : String(imsError)}</Content>
        </InlineAlert>
      </div>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 1040, margin: "0 auto" }}>
      <ToastContainer />

      {view.kind === "edit" ? (
        <ItemEditPage
          draft={view.draft}
          heading={view.heading}
          parentOptions={parentOptionsFor(view.isNew, view.draft)}
          categories={catalog.categories}
          cmsPages={catalog.cmsPages}
          isSaving={busy}
          onSave={(d) => void saveItem(d)}
          onBack={() => setView({ kind: "list" })}
          onDelete={
            view.isNew || !view.draft.id
              ? undefined
              : () => setDeleteTarget(items.find((i) => i.id === view.draft.id) ?? null)
          }
        />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <Heading>Menu Manager</Heading>
              {menu && (
                <Text>
                  <span style={{ opacity: 0.7 }}>
                    {menu.title} · <code>{menu.identifier}</code>
                  </span>
                </Text>
              )}
            </div>
            <ActionButton onPress={() => void load()} isDisabled={loading || busy}>
              Refresh
            </ActionButton>
            {menu && (
              <Button variant="accent" onPress={() => openAdd(null)} isDisabled={busy}>
                Add item
              </Button>
            )}
          </div>

          <Divider size="M" />

          {loading && (
            <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
              <ProgressCircle isIndeterminate aria-label="Loading menu" />
            </div>
          )}

          {!loading && loadError && (
            <InlineAlert variant="negative">
              <Heading>Failed to load the menu</Heading>
              <Content>{loadError}</Content>
            </InlineAlert>
          )}

          {!loading && !loadError && !menu && (
            <IllustratedMessage>
              <Heading>No menus yet</Heading>
              <Content>Seed a menu with the backend before managing it here.</Content>
            </IllustratedMessage>
          )}

          {!loading && !loadError && menu && rows.length === 0 && (
            <IllustratedMessage>
              <Heading>This menu is empty</Heading>
              <Content>Use “Add item” to create the first top-level entry.</Content>
            </IllustratedMessage>
          )}

          {!loading && !loadError && menu && rows.length > 0 && (
            <Tabs
              selectedKey={tab}
              onSelectionChange={(k: Key) => setTab(String(k))}
              aria-label="Menu views"
            >
              <TabList>
                <Tab id="tree">Tree</Tab>
                <Tab id="grid">Grid</Tab>
              </TabList>
              <TabPanel id="tree">
                <div style={{ marginTop: 8 }}>{renderTree(tree, 0)}</div>
              </TabPanel>
              <TabPanel id="grid">
                <div style={{ marginTop: 8 }}>
                  <ItemGrid rows={rows} onRowAction={(row, key) => dispatchRowAction(row, key)} />
                </div>
              </TabPanel>
            </Tabs>
          )}
        </>
      )}

      <DialogContainer onDismiss={() => !busy && setDeleteTarget(null)}>
        {deleteTarget && (
          <AlertDialog
            variant="destructive"
            title="Delete item"
            primaryActionLabel="Delete"
            cancelLabel="Cancel"
            onPrimaryAction={() => void doDelete(deleteTarget)}
            onCancel={() => setDeleteTarget(null)}
          >
            Delete “{deleteTarget.title}” and all of its sub-items? This cannot be undone.
          </AlertDialog>
        )}
      </DialogContainer>
    </main>
  );
}
