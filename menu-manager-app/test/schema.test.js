const { validateMenu, validateItem, URL_TYPE } = require('../src/commerce-backend-ui-1/domain/schema');

describe('validateMenu', () => {
  test('accepts a minimal menu and applies defaults', () => {
    const m = validateMenu({ identifier: 'main', title: 'Main Menu' });
    expect(m).toMatchObject({ identifier: 'main', title: 'Main Menu', isActive: true, storeCodes: [] });
  });
  test('requires identifier and title', () => {
    expect(() => validateMenu({})).toThrow(/identifier is required/);
    expect(() => validateMenu({ identifier: 'x' })).toThrow(/title is required/);
  });
  test('enforces the legacy column lengths', () => {
    expect(() => validateMenu({ identifier: 'a'.repeat(101), title: 't' })).toThrow(/exceeds 100/);
    expect(() => validateMenu({ identifier: 'a', title: 't'.repeat(256) })).toThrow(/exceeds 255/);
  });
});

describe('validateItem', () => {
  const base = { menuId: 'm1', title: 'Shoes' };

  test('defaults urlType to Link and requires a url for it', () => {
    expect(() => validateItem(base)).toThrow(/url is required when urlType is Link/);
    expect(validateItem({ ...base, url: '/shoes' })).toMatchObject({ urlType: URL_TYPE.LINK });
  });

  test('requires categoryId when urlType is Category', () => {
    expect(() => validateItem({ ...base, urlType: 2 })).toThrow(/categoryId is required/);
    expect(validateItem({ ...base, urlType: 2, categoryId: 42 }).categoryId).toBe(42);
  });

  test('requires cmsPageId when urlType is CMS page', () => {
    expect(() => validateItem({ ...base, urlType: 1 })).toThrow(/cmsPageId is required/);
  });

  test('rejects an unknown urlType', () => {
    expect(() => validateItem({ ...base, urlType: 7 })).toThrow(/must be one of 0, 1, 2/);
  });

  test('coerces booleans the way an HTML form sends them', () => {
    expect(validateItem({ ...base, url: '/x', isActive: 'false' }).isActive).toBe(false);
    expect(validateItem({ ...base, url: '/x', isActive: '1' }).isActive).toBe(true);
  });

  test('rejects a non-integer position', () => {
    expect(() => validateItem({ ...base, url: '/x', position: 'abc' })).toThrow(/must be an integer/);
  });
});
