import type {
  CatalogData,
  ItemDraft,
  ItemListResult,
  Menu,
  MenuListResult,
} from "#web/lib/types.ts";

/**
 * Base URL of the deployed Menu Manager actions (Stage workspace).
 *
 * The admin SPA runs on adobeio-static.net and calls these actions on
 * adobeioruntime.net; the runtime already returns `Access-Control-Allow-Origin: *`
 * and answers the OPTIONS preflight, so no CORS shim is needed on the actions.
 * Every action here is `require-adobe-auth: true` — the admin's IMS token from
 * useIms() is validated by Adobe before our code runs.
 */
const ACTIONS_BASE =
  "https://1951857-weekendmenumanager-stage.adobeioruntime.net/api/v1/web/menu-manager";

async function request<T>(
  auth: { token: string; orgId: string },
  action: string,
  opts: { method?: "GET" | "POST"; query?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  const method = opts.method ?? "GET";
  const url = new URL(`${ACTIONS_BASE}/${action}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      // require-adobe-auth validates the token against this org; without the
      // header it rejects with "missing x-gw-ims-org-id header".
      "x-gw-ims-org-id": auth.orgId,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON body (e.g. gateway error) — handled below */
  }

  if (!res.ok) {
    const p = payload as { error?: string } | null;
    throw new Error(p?.error || `${action} failed (HTTP ${res.status})`);
  }
  return payload as T;
}

/** Serialize a draft into the flat params item-save validates. */
function draftToItem(draft: ItemDraft): Record<string, unknown> {
  return {
    id: draft.id,
    menuId: draft.menuId,
    parentId: draft.parentId,
    title: draft.title.trim(),
    urlType: draft.urlType,
    url: draft.urlType === 0 ? draft.url.trim() : "",
    categoryId: draft.urlType === 2 ? draft.categoryId : null,
    cmsPageId: draft.urlType === 1 ? draft.cmsPageId : null,
    openType: draft.openType,
    position: draft.position,
    isActive: draft.isActive,
    identifier: draft.identifier.trim(),
    itemClass: draft.itemClass.trim(),
    icon: draft.icon.trim(),
  };
}

export function createMenuApi(token: string, orgId: string) {
  const auth = { token, orgId };
  return {
    async listMenus(): Promise<Menu[]> {
      const r = await request<MenuListResult>(auth, "menu-list", {
        query: { pageSize: "200" },
      });
      return r.items ?? [];
    },

    listItems(menuId: string): Promise<ItemListResult> {
      return request<ItemListResult>(auth, "item-list", { query: { menuId } });
    },

    listCatalog(): Promise<CatalogData> {
      return request<CatalogData>(auth, "catalog-list");
    },

    saveItem(draft: ItemDraft): Promise<{ item: { id: string } }> {
      return request(auth, "item-save", { method: "POST", body: draftToItem(draft) });
    },

    deleteItem(id: string): Promise<{ deleted: boolean }> {
      return request(auth, "item-delete", { method: "POST", body: { id } });
    },

    reorderItem(itemId: string, parentId: string | null, position: number): Promise<unknown> {
      return request(auth, "item-reorder", {
        method: "POST",
        body: { itemId, parentId, position },
      });
    },
  };
}

export type MenuApi = ReturnType<typeof createMenuApi>;
