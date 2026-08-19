# API Mesh configuration

`scandiwebMenu(identifier, maxLevel)` keeps the exact signature of the legacy
Magento GraphQL query, so the storefront contract survives the replatform.

## Before deploying

1. Replace `{NAMESPACE}` in `mesh.json` with the runtime namespace
   (`aio runtime namespace get`).
2. Put the storefront shared secret in a mesh secret, not in the file.
3. `aio api-mesh:create mesh.json` (or `:update`).

## Verified constraints this config is built around

| Constraint | Value | Consequence here |
|---|---|---|
| `queryConfig.maxDepth` | ceiling **6** | Response is flat, not nested |
| Cacheable requests | **GET only, ≤2048 chars** | Query kept small; GET operation |
| Request timeout | 60 s | Fine — the action reads one State key |
| CDN caching | **bring your own** (e.g. Fastly) | `Cache-Control` is set, but edge caching needs the CDN in front |

## Unverified — confirm before relying on it

Adobe documents neither an App Builder web action as a Mesh source, nor a sample
of one. It is a plain HTTPS REST endpoint so `JsonSchema` should work, but this
is an unblessed pattern. Fallback if it misbehaves: a programmatic JS resolver
using `fetch`, which Adobe explicitly sanctions for edge meshes.
