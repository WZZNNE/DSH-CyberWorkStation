// ESLint flat config for the suite's own code (launcher, plugins, the README generator). The vendored core has
// its own toolchain and is not linted here; the retired fork dsh-token-usage-plus keeps its upstream style.
import js from '@eslint/js'
import globals from 'globals'

const unused = ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }]

// The cost-meter fork carries an upstream `eslint-disable-line react-hooks/exhaustive-deps`: a stub rule keeps
// that directive from being reported as an unknown rule without pulling the React plugin in.
const reactHooksStub = { rules: { 'exhaustive-deps': { meta: { type: 'suggestion' }, create: () => ({}) } } }

// launcher pages are classic scripts: app.js defines these helpers, the other pages use them through <script> order
const pageGlobals = { $: 'readonly', $$: 'readonly', api: 'readonly', esc: 'readonly', toast: 'readonly', LAUNCHER_TOKEN: 'readonly', refreshers: 'readonly' }
const i18nGlobals = { T: 'readonly', I18N: 'writable', LANG: 'writable' }

export default [
  {
    ignores: ['core/**', 'node_modules/**', 'plugins/node_modules/**', 'plugins/*/node_modules/**', 'plugins/dsh-token-usage-plus/**', '.local/**', 'docs/showcase/**', 'launcher/public/assets/**'],
  },
  js.configs.recommended,
  {
    // every suite file not matched more specifically below: a Node ES module (browser code is kept out so
    // Node globals never leak into it — flat-config globals merge across matching blocks)
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ignores: ['launcher/public/**', 'plugins/*/lib/client.js', 'docs/showcase-src/shell.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.es2024 } },
    rules: { 'no-unused-vars': unused, 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    // host halves, launcher server modules, the shared kit, the README generator: Node ES modules
    files: ['launcher/**/*.mjs', 'plugins/*/lib/**/*.js', 'plugins/_shared/*.js', 'docs/showcase-src/**/*.mjs'],
    ignores: ['plugins/*/lib/client.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.es2024 } },
    rules: {
      'no-unused-vars': unused,
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      // file-name sanitising patterns match control characters on purpose
      'no-control-regex': 'off',
    },
  },
  {
    // browser halves of the plugins: ES modules loaded by the core's client runner
    files: ['plugins/*/lib/client.js'],
    plugins: { 'react-hooks': reactHooksStub },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, ...globals.es2024 } },
    rules: {
      'no-unused-vars': unused,
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-condition': 'off',
    },
  },
  {
    files: ['launcher/public/app.js', 'launcher/public/i18n.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.browser, ...globals.es2024, ...i18nGlobals } },
    rules: { 'no-unused-vars': unused, 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    files: ['launcher/public/deck-market.js', 'launcher/public/memory.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.browser, ...globals.es2024, ...i18nGlobals, ...pageGlobals } },
    rules: { 'no-unused-vars': unused, 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  {
    // the showcase page's inline script
    files: ['docs/showcase-src/shell.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.browser, ...globals.es2024 } },
  },
]
