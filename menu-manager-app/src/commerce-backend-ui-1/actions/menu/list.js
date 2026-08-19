const { getRepository } = require('../../repository');
const { ok, fromError } = require('../../lib/http');
const { requireAdmin } = require('../../lib/auth');
const { build } = require('../../lib/logger');

async function main (params) {
  const logger = build('menu-list', params);
  try {
    requireAdmin(params);
    const { repo } = await getRepository({ params, logger });
    const result = await repo.listMenus({
      page: params.page || 1,
      pageSize: Math.min(Number(params.pageSize) || 20, 200),
      search: params.search || '',
      isActive: params.isActive === undefined ? null : params.isActive === true || params.isActive === 'true',
      storeCode: params.storeCode || null
    });
    return ok(result);
  } catch (e) { return fromError(e, logger); }
}
exports.main = main;
