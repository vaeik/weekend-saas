// Re-export the REAL domain logic from the App Builder app, unmodified, so the
// spike proves the shipped reorder()/computeLevels() — not a reimplementation.
import mod from './tree.cjs';
export const { assembleTree, computeLevels, descendantIds, reorder, flattenForStorefront, isRoot } = mod;
