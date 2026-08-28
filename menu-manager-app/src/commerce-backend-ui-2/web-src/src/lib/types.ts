/** Shapes mirrored from the backend domain (schema.js / tree.js). */

/** urlType: 0 external/internal link, 1 CMS page, 2 category. */
export const URL_TYPE = { LINK: 0, CMS_PAGE: 1, CATEGORY: 2 } as const;
export type UrlType = (typeof URL_TYPE)[keyof typeof URL_TYPE];

export interface MenuItem {
  id: string;
  menuId: string;
  parentId: string | null;
  title: string;
  itemClass?: string;
  identifier?: string;
  url?: string;
  openType?: number;
  urlType?: number;
  cmsPageId?: number | null;
  categoryId?: number | null;
  position: number;
  isActive?: boolean;
  icon?: string;
  level?: number | null;
}

/** A MenuItem with its children attached (from assembleTree). */
export interface MenuNode extends MenuItem {
  children: MenuNode[];
}

export interface Menu {
  id: string;
  identifier: string;
  title: string;
  isActive?: boolean;
  storeCodes?: string[];
}

export interface MenuListResult {
  // repo.listMenus() returns the menus under `items`, not `menus`.
  items: Menu[];
  total?: number;
  page?: number;
  pageSize?: number;
}

export interface ItemListResult {
  items: MenuItem[];
  tree: MenuNode[];
  orphaned: string[];
  total: number;
}

/** Fields the add/edit form edits. */
export interface ItemDraft {
  id?: string;
  menuId: string;
  parentId: string | null;
  title: string;
  urlType: number;
  url: string;
  categoryId: number | null;
  cmsPageId: number | null;
  openType: number;
  position: number;
  isActive: boolean;
  identifier: string;
  itemClass: string;
  icon: string;
}

/** A flat menu item annotated with its depth in the tree (for the grid). */
export interface FlatRow extends MenuItem {
  depth: number;
}

/** A catalog category for the picker. */
export interface CatalogCategory {
  id: number;
  label: string;
  urlPath: string;
  depth: number;
}

/** A CMS page for the picker. */
export interface CmsPageOption {
  id: number;
  identifier: string;
  title: string;
}

export interface CatalogData {
  categories: CatalogCategory[];
  cmsPages: CmsPageOption[];
}
