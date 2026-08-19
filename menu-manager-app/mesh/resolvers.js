/**
 * API Mesh programmatic resolver for `scandiwebMenu`.
 *
 * Uses globalThis.fetch rather than the JsonSchema source handler on purpose:
 * Adobe documents NO sample of an App Builder action as a Mesh source, but does
 * explicitly sanction fetch inside edge-mesh resolvers and publishes a working
 * example of it. Fewer unknowns on the critical path.
 *
 * The shared secret lives in a Mesh SECRET, never in a forwarded request header.
 * Forwarding `x-mm-secret` from the caller would let anyone supply their own and
 * would be worse than having no secret at all.
 */
module.exports = {
  resolvers: {
    Query: {
      scandiwebMenu: {
        resolve: async (root, args, context) => {
          const secrets = context.secrets || {};
          const actionUrl = secrets.MM_ACTION_URL;
          const secret = secrets.MM_SECRET;

          if (!actionUrl || !secret) {
            context.logger?.error('scandiwebMenu: MM_ACTION_URL or MM_SECRET secret is not set');
            return null;
          }

          const url = new URL(actionUrl);
          url.searchParams.set('identifier', args.identifier);
          if (args.maxLevel) url.searchParams.set('maxLevel', String(args.maxLevel));
          if (args.storeCode) url.searchParams.set('storeCode', args.storeCode);

          try {
            const res = await globalThis.fetch(url.toString(), {
              method: 'GET',
              headers: { 'x-mm-secret': secret }
            });

            // A missing or inactive menu is a legitimate null, not an error —
            // the storefront falls back to its authored nav on null.
            if (res.status === 404) return null;

            if (!res.ok) {
              context.logger?.error(`scandiwebMenu: action returned HTTP ${res.status}`);
              return null;
            }
            return await res.json();
          } catch (err) {
            context.logger?.error(`scandiwebMenu: fetch failed: ${err.message}`);
            return null;
          }
        }
      }
    }
  }
};
