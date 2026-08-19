const core = require('@adobe/aio-lib-core-logging');
const build = (name, params = {}) => core(name, { level: params.LOG_LEVEL || 'info' });
module.exports = { build };
