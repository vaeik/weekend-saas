/**
 * Read cache for the storefront hot path: App Builder State.
 *
 * One key per (identifier, storeCode) holding the fully-resolved FLAT menu.
 * The storefront therefore does a single key lookup, never a query — which is
 * exactly what State is good at, and keeps Database off the request path.
 *
 * TTL is 24h and every write invalidates, so a stale menu can only survive a
 * dropped invalidation for one day. State's max TTL is 365 days; we are
 * nowhere near it, so the TTL trap that ruled State out as a system of record
 * is irrelevant here.
 */
const DEFAULT_TTL = 86400; // 24h, well inside State's 365-day ceiling

const key = (identifier, storeCode) => `menu:${identifier}:${storeCode || 'default'}`;

class MenuCache {
  constructor (state, { ttl = DEFAULT_TTL, logger = null } = {}) {
    this.state = state;
    this.ttl = ttl;
    this.logger = logger;
  }

  async get (identifier, storeCode) {
    if (!this.state) return null;
    try {
      const hit = await this.state.get(key(identifier, storeCode));
      if (!hit || !hit.value) return null;
      return typeof hit.value === 'string' ? JSON.parse(hit.value) : hit.value;
    } catch (err) {
      // A cache failure must never fail the request — fall through to Database.
      this.logger?.warn(`menu cache read failed: ${err.message}`);
      return null;
    }
  }

  async put (identifier, storeCode, payload) {
    if (!this.state) return false;
    try {
      await this.state.put(key(identifier, storeCode), JSON.stringify(payload), { ttl: this.ttl });
      return true;
    } catch (err) {
      this.logger?.warn(`menu cache write failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Invalidate every store variant of a menu.
   * State has no prefix delete, and `list()` is documented as eventually
   * consistent and able to skip keys mid-iteration, so we delete the known
   * store codes explicitly rather than trusting a glob sweep.
   */
  async invalidate (identifier, storeCodes = []) {
    if (!this.state) return 0;
    const codes = storeCodes.length ? [...new Set([...storeCodes, 'default'])] : ['default'];
    let n = 0;
    for (const code of codes) {
      try { await this.state.delete(key(identifier, code)); n += 1; } catch (err) {
        this.logger?.warn(`menu cache invalidate failed for ${code}: ${err.message}`);
      }
    }
    return n;
  }
}

module.exports = { MenuCache, DEFAULT_TTL, key };
