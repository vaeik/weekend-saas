/**
 * Mock menu modelled on weekendshoes.lv's real navigation shape:
 * 3 levels, category-bound items, a promo item with an advertisement image.
 * Enough to exercise every guard in reorder().
 */
export const MENU = { id: 'm1', identifier: 'main', title: 'Main menu', isActive: true, cssClass: 'nav' };

export const ITEMS = [
  { id: 'sievietem', parentId: null, position: 0, title: 'Sievietēm', urlType: 2, categoryId: 11, isActive: true },
  { id: 'viriesiem', parentId: null, position: 1, title: 'Vīriešiem', urlType: 2, categoryId: 12, isActive: true },
  { id: 'berniem', parentId: null, position: 2, title: 'Bērniem', urlType: 2, categoryId: 13, isActive: true },
  { id: 'outlet', parentId: null, position: 3, title: 'Outlet', urlType: 0, url: '/outlet', isActive: true },

  { id: 'apavi-s', parentId: 'sievietem', position: 0, title: 'Apavi', urlType: 2, categoryId: 111, isActive: true },
  { id: 'somas-s', parentId: 'sievietem', position: 1, title: 'Somas', urlType: 2, categoryId: 112, isActive: true },
  { id: 'promo-s', parentId: 'sievietem', position: 2, title: 'Jaunā kolekcija', urlType: 0, url: '/jauna', isActive: true, advertisement: '/media/promo-aw26.jpg' },

  { id: 'zabaki', parentId: 'apavi-s', position: 0, title: 'Zābaki', urlType: 2, categoryId: 1111, isActive: true },
  { id: 'kurpes', parentId: 'apavi-s', position: 1, title: 'Kurpes', urlType: 2, categoryId: 1112, isActive: true },
  { id: 'sandales', parentId: 'apavi-s', position: 2, title: 'Sandales', urlType: 2, categoryId: 1113, isActive: false },

  { id: 'apavi-v', parentId: 'viriesiem', position: 0, title: 'Apavi', urlType: 2, categoryId: 121, isActive: true },
  { id: 'jakas-v', parentId: 'viriesiem', position: 1, title: 'Jakas', urlType: 2, categoryId: 122, isActive: true }
];
