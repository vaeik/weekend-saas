import { useCallback, useEffect, useMemo, useState } from "react";
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
  Text,
  ToastContainer,
  ToastQueue,
} from "@react-spectrum/s2";

import { createMenuApi } from "#web/lib/menu-api.ts";
import type { ItemDraft, Menu, MenuItem, MenuNode } from "#web/lib/types.ts";
import { URL_TYPE } from "#web/lib/types.ts";
import { ItemDialog } from "#web/components/item-dialog.tsx";

type DialogState =
  | { kind: "add" | "edit"; draft: ItemDraft; title: string }
  | { kind: "delete"; item: MenuItem }
  | null;

function emptyDraft(menuId: string, parentId: string | null): ItemDraft {
  return {
    menuId,
    parentId,
    title: "",
    urlType: URL_TYPE.LINK,
    url: "",
    categoryId: null,
    cmsPageId: null,
    openType: 0,
    isActive: true,
    identifier: "",
    itemClass: "",
    icon: "",
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
    isActive: item.isActive !== false,
    identifier: item.identifier ?? "",
    itemClass: item.itemClass ?? "",
    icon: item.icon ?? "",
  };
}

function targetLabel(item: MenuItem): string {
  if (item.urlType === URL_TYPE.CATEGORY) return `Category #${item.categoryId ?? "?"}`;
  if (item.urlType === URL_TYPE.CMS_PAGE) return `CMS page #${item.cmsPageId ?? "?"}`;
  return item.url || "—";
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setLoadError(null);
    try {
      const menus = await api.listMenus();
      if (menus.length === 0) {
        setMenu(null);
        setTree([]);
        return;
      }
      const chosen = menus.find((m) => m.identifier === "main") ?? menus[0];
      setMenu(chosen);
      const items = await api.listItems(chosen.id);
      setTree(items.tree ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveItem = async (draft: ItemDraft) => {
    if (!api) return;
    setBusy(true);
    try {
      await api.saveItem(draft);
      ToastQueue.positive(draft.id ? "Item updated" : "Item added", { timeout: 3000 });
      setDialog(null);
      await load();
    } catch (e) {
      ToastQueue.negative(e instanceof Error ? e.message : "Save failed", { timeout: 6000 });
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = async (item: MenuItem) => {
    if (!api) return;
    setBusy(true);
    try {
      await api.deleteItem(item.id);
      ToastQueue.positive("Item deleted", { timeout: 3000 });
      setDialog(null);
      await load();
    } catch (e) {
      ToastQueue.negative(e instanceof Error ? e.message : "Delete failed", { timeout: 6000 });
    } finally {
      setBusy(false);
    }
  };

  const move = async (item: MenuItem, position: number) => {
    if (!api) return;
    setBusy(true);
    try {
      await api.reorderItem(item.id, item.parentId, position);
      await load();
    } catch (e) {
      ToastQueue.negative(e instanceof Error ? e.message : "Reorder failed", { timeout: 6000 });
    } finally {
      setBusy(false);
    }
  };

  const onRowAction = (node: MenuNode, index: number, siblingCount: number, key: string) => {
    switch (key) {
      case "add-child":
        setDialog({ kind: "add", draft: emptyDraft(node.menuId, node.id), title: `Add under “${node.title}”` });
        break;
      case "edit":
        setDialog({ kind: "edit", draft: toDraft(node), title: `Edit “${node.title}”` });
        break;
      case "up":
        if (index > 0) void move(node, index - 1);
        break;
      case "down":
        if (index < siblingCount - 1) void move(node, index + 1);
        break;
      case "delete":
        setDialog({ kind: "delete", item: node });
        break;
      default:
        break;
    }
  };

  const renderNodes = (nodes: MenuNode[], depth: number) =>
    nodes.map((node, index) => (
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
            onAction={(key) => onRowAction(node, index, nodes.length, String(key))}
          >
            <ActionMenuItem id="add-child">Add sub-item</ActionMenuItem>
            <ActionMenuItem id="edit">Edit</ActionMenuItem>
            <ActionMenuItem id="up">Move up</ActionMenuItem>
            <ActionMenuItem id="down">Move down</ActionMenuItem>
            <ActionMenuItem id="delete">Delete</ActionMenuItem>
          </ActionMenu>
        </div>
        {node.children.length > 0 && renderNodes(node.children, depth + 1)}
      </div>
    ));

  // ---- render states -------------------------------------------------------

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
    <main style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <ToastContainer />

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
          <Button
            variant="accent"
            onPress={() =>
              setDialog({ kind: "add", draft: emptyDraft(menu.id, null), title: "Add top-level item" })
            }
            isDisabled={busy}
          >
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

      {!loading && !loadError && menu && tree.length === 0 && (
        <IllustratedMessage>
          <Heading>This menu is empty</Heading>
          <Content>Use “Add item” to create the first top-level entry.</Content>
        </IllustratedMessage>
      )}

      {!loading && !loadError && menu && tree.length > 0 && (
        <div style={{ marginTop: 8 }}>{renderNodes(tree, 0)}</div>
      )}

      <DialogContainer onDismiss={() => !busy && setDialog(null)}>
        {dialog && (dialog.kind === "add" || dialog.kind === "edit") && (
          <ItemDialog
            initial={dialog.draft}
            titleText={dialog.title}
            isSaving={busy}
            onSave={(d) => void saveItem(d)}
            onCancel={() => setDialog(null)}
          />
        )}
        {dialog && dialog.kind === "delete" && (
          <AlertDialog
            variant="destructive"
            title="Delete item"
            primaryActionLabel="Delete"
            cancelLabel="Cancel"
            onPrimaryAction={() => void deleteItem(dialog.item)}
            onCancel={() => setDialog(null)}
          >
            Delete “{dialog.item.title}” and all of its sub-items? This cannot be undone.
          </AlertDialog>
        )}
      </DialogContainer>
    </main>
  );
}
