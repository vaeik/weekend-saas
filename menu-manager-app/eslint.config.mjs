// Three different module systems live in this repo on purpose:
//   - src/**, hooks/**, test/**  -> CommonJS. App Builder actions are CJS.
//   - test-storefront/**, *.mjs  -> ESM. The storefront module is an ES module
//                                   because EDS blocks are.
//   - spikes/**                  -> its own project, own package.json, own
//                                   toolchain (React/JSX/Vite). Linting it with
//                                   the app's config would be wrong, not just
//                                   noisy, so it is excluded here.
export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'writable', process: 'readonly', Buffer: 'readonly',
        console: 'readonly', exports: 'writable', __dirname: 'readonly', global: 'writable',
        // Node 18+ / I/O Runtime nodejs:22 globals used by the actions
        URLSearchParams: 'readonly', URL: 'readonly', fetch: 'readonly',
        globalThis: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      eqeqeq: ['error', 'smart'],
      'no-console': 'off'
    }
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly', test: 'readonly', expect: 'readonly', jest: 'readonly',
        beforeEach: 'readonly', afterEach: 'readonly', beforeAll: 'readonly', afterAll: 'readonly'
      }
    }
  },
  {
    // ESM: the storefront module and its tests, plus any .mjs tooling.
    files: ['test-storefront/**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        console: 'readonly', process: 'readonly', document: 'readonly', window: 'readonly',
        fetch: 'readonly', URL: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        AbortController: 'readonly', globalThis: 'writable',
        describe: 'readonly', test: 'readonly', expect: 'readonly', jest: 'readonly',
        beforeEach: 'readonly', afterEach: 'readonly'
      }
    }
  },
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'spikes/**'] }
];
