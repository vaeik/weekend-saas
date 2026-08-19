// The storefront module is an ES module running in a browser, so it needs a
// different environment than the CommonJS App Builder actions. Run with:
//   npm run test:storefront
export default {
  testEnvironment: 'jsdom',
  transform: {},
  testMatch: ['**/test-storefront/**/*.test.js'],
  moduleNameMapper: {
    // The storefront module imports two files that live in the EDS repo root,
    // not in this app. Mapped to local stubs so the contract can be tested here.
    '^@dropins/tools/lib/aem/configs.js$': '<rootDir>/test-storefront/__stubs__/configs.js',
    '^.*/scripts/commerce.js$': '<rootDir>/test-storefront/__stubs__/commerce.js'
  }
};
