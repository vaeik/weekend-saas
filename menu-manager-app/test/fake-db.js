/**
 * In-memory stand-in for the CONNECTED @adobe/aio-lib-db client — i.e. what
 * `(await dbLib.init(...)).connect()` returns, NOT what init() returns.
 *
 * That distinction is load-bearing: init() gives a DbBase (provision / ping /
 * connect) and collection() only appears on the DbClient from connect().
 * Because this fake exposes collection() directly, unit tests cannot catch a
 * missing connect() in repository/index.js — and they didn't.
 *
 * Implements only the Mongo-style surface DbMenuRepository actually uses. Lets the repository be tested for
 * real without Adobe credentials — which matters because plan finding F3 means
 * there is no local dev loop against ACCS.
 */
function matches (doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (k === '$or') return v.some((sub) => matches(doc, sub));
    const actual = doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.map(String).includes(String(actual));
      if ('$regex' in v) return new RegExp(v.$regex, v.$options || '').test(String(actual ?? ''));
    }
    if (Array.isArray(actual)) return actual.includes(v);
    return String(actual) === String(v);
  });
}

class FakeCollection {
  constructor () { this.docs = new Map(); }

  find (filter = {}) {
    let rows = [...this.docs.values()].filter((d) => matches(d, filter));
    const cursor = {
      sort: (spec) => {
        const [[k, dir]] = Object.entries(spec);
        rows = [...rows].sort((a, b) => String(a[k] ?? '').localeCompare(String(b[k] ?? '')) * dir);
        return cursor;
      },
      skip: (n) => { rows = rows.slice(n); return cursor; },
      limit: (n) => { rows = rows.slice(0, n); return cursor; },
      toArray: async () => rows.map((d) => ({ ...d }))
    };
    return cursor;
  }

  async findOne (filter) {
    const hit = [...this.docs.values()].find((d) => matches(d, filter));
    // Matches the REAL service, which throws rather than returning null.
    // Discovered by scripts/smoke.js. Do not "fix" this back to null — the
    // divergence is what let a production-breaking bug through review.
    if (!hit) throw new Error('Request abc to v1/collection/x/findOne failed: Document not found');
    return { ...hit };
  }

  async countDocuments (filter = {}) {
    return [...this.docs.values()].filter((d) => matches(d, filter)).length;
  }

  async replaceOne (filter, doc) { this.docs.set(doc._id, { ...doc }); return { upsertedCount: 1 }; }

  async updateOne (filter, update) {
    const hit = [...this.docs.values()].find((d) => matches(d, filter));
    if (!hit) return { modifiedCount: 0 };
    Object.assign(hit, update.$set);
    return { modifiedCount: 1 };
  }

  async updateMany (filter, update) {
    const hits = [...this.docs.values()].filter((d) => matches(d, filter));
    hits.forEach((h) => Object.assign(h, update.$set));
    return { modifiedCount: hits.length };
  }

  async deleteOne (filter) {
    const hit = [...this.docs.values()].find((d) => matches(d, filter));
    if (hit) this.docs.delete(hit._id);
    return { deletedCount: hit ? 1 : 0 };
  }

  async deleteMany (filter) {
    const hits = [...this.docs.values()].filter((d) => matches(d, filter));
    hits.forEach((h) => this.docs.delete(h._id));
    return { deletedCount: hits.length };
  }

  async createIndex (spec, options = {}) { return options.name || Object.keys(spec).join('_'); }
}

class FakeDb {
  constructor () { this.collections = new Map(); }
  collection (name) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection());
    return this.collections.get(name);
  }
}

class FakeState {
  constructor () { this.store = new Map(); this.puts = []; this.deletes = []; }
  async get (k) { return this.store.has(k) ? { value: this.store.get(k) } : undefined; }
  async put (k, v, opts) { this.store.set(k, v); this.puts.push({ k, opts }); return k; }
  async delete (k) { this.deletes.push(k); this.store.delete(k); return k; }
}

module.exports = { FakeDb, FakeState, FakeCollection };
