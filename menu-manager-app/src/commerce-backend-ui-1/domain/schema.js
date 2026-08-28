/**
 * Field definitions + validation, derived 1:1 from the legacy declarative
 * schema in ScandiPWA/MenuOrganizer/etc/db_schema.xml (scanned 18 Aug 2026).
 *
 * OPEN QUESTION (carried to the plan's Q-list): five fields are exposed by the
 * legacy schema.graphqls but do NOT exist as columns in db_schema.xml —
 *   is_promo, promo_image, is_with_cms_block, custom_redirect, cms_page_identifier
 * `cms_page_identifier` is plainly derived from cms_page_id. The other four have
 * unknown provenance (resolver-computed, or a column added outside declarative
 * schema). They are carried as optional passthrough fields and must be
 * confirmed against the live DB before go-live rather than guessed at.
 */

const MENU_FIELDS = {
  identifier: { type: 'string', required: true, maxLength: 100 },
  title: { type: 'string', required: true, maxLength: 255 },
  cssClass: { type: 'string', maxLength: 100 },
  isActive: { type: 'boolean', default: true },
  storeCodes: { type: 'array', default: [] }
};

const ITEM_FIELDS = {
  menuId: { type: 'string', required: true },
  parentId: { type: 'string', nullable: true, default: null },
  title: { type: 'string', required: true, maxLength: 255 },
  itemClass: { type: 'string', maxLength: 255, default: '' },
  identifier: { type: 'string', maxLength: 100, default: '' },
  url: { type: 'string' },
  openType: { type: 'integer', default: 0 },
  urlType: { type: 'integer', default: 0, enum: [0, 1, 2] }, // 0 link, 1 CMS page, 2 category
  cmsPageId: { type: 'integer', nullable: true, default: null },
  categoryId: { type: 'integer', nullable: true, default: null },
  position: { type: 'integer', default: 0 },
  isActive: { type: 'boolean', default: true },
  urlAttributes: { type: 'string', maxLength: 255 },
  icon: { type: 'string', maxLength: 255 },
  iconAlt: { type: 'string', maxLength: 255 },
  advertisement: { type: 'string', maxLength: 255 },
  advertisementLink: { type: 'string', maxLength: 255 },
  advertisementSecond: { type: 'string', maxLength: 255 },
  advertisementSecondLink: { type: 'string', maxLength: 255 },
  // Legacy MenuOrganizer passthrough (schema.graphqls fields not in db_schema.xml
  // — see Q2). Persisted here so the V2 admin can author them and the storefront
  // mega-menu can render them; flattenForStorefront already emits all four.
  promoImage: { type: 'string', maxLength: 255 },
  isPromo: { type: 'boolean', default: false },
  isWithCmsBlock: { type: 'boolean', default: false },
  customRedirect: { type: 'string', maxLength: 255 },
  level: { type: 'integer', nullable: true, default: 1 }
};

const URL_TYPE = { LINK: 0, CMS_PAGE: 1, CATEGORY: 2 };

class ValidationError extends Error {
  constructor (errors) {
    super(`Validation failed: ${errors.map((e) => `${e.field} ${e.message}`).join('; ')}`);
    this.code = 'VALIDATION';
    this.errors = errors;
  }
}

function validate (input, fields) {
  const errors = [];
  const out = {};

  Object.entries(fields).forEach(([name, spec]) => {
    let value = input[name];

    if (value === undefined || value === null || value === '') {
      if (spec.required) { errors.push({ field: name, message: 'is required' }); return; }
      if (value === null && spec.nullable) { out[name] = null; return; }
      if (Object.prototype.hasOwnProperty.call(spec, 'default')) out[name] = spec.default;
      return;
    }

    switch (spec.type) {
      case 'string':
        value = String(value);
        if (spec.maxLength && value.length > spec.maxLength) {
          errors.push({ field: name, message: `exceeds ${spec.maxLength} characters` });
          return;
        }
        break;
      case 'integer': {
        const n = Number(value);
        if (!Number.isInteger(n)) { errors.push({ field: name, message: 'must be an integer' }); return; }
        if (spec.enum && !spec.enum.includes(n)) {
          errors.push({ field: name, message: `must be one of ${spec.enum.join(', ')}` });
          return;
        }
        value = n;
        break;
      }
      case 'boolean':
        value = value === true || value === 'true' || value === 1 || value === '1';
        break;
      case 'array':
        if (!Array.isArray(value)) { errors.push({ field: name, message: 'must be an array' }); return; }
        break;
      default:
        break;
    }
    out[name] = value;
  });

  if (errors.length) throw new ValidationError(errors);
  return out;
}

/** Cross-field rules the legacy admin enforced through form logic. */
function validateItemConsistency (item) {
  const errors = [];
  if (item.urlType === URL_TYPE.CATEGORY && item.categoryId === null) {
    errors.push({ field: 'categoryId', message: 'is required when urlType is Category' });
  }
  if (item.urlType === URL_TYPE.CMS_PAGE && item.cmsPageId === null) {
    errors.push({ field: 'cmsPageId', message: 'is required when urlType is CMS Page' });
  }
  if (item.urlType === URL_TYPE.LINK && !item.url) {
    errors.push({ field: 'url', message: 'is required when urlType is Link' });
  }
  if (errors.length) throw new ValidationError(errors);
  return item;
}

const validateMenu = (input) => validate(input, MENU_FIELDS);
const validateItem = (input) => validateItemConsistency(validate(input, ITEM_FIELDS));

module.exports = {
  MENU_FIELDS, ITEM_FIELDS, URL_TYPE, ValidationError,
  validate, validateMenu, validateItem, validateItemConsistency
};
