/* ESLint config for the Vite + React + TypeScript frontend. */
module.exports = {
  root: true,
  env: { browser: true, es2020: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'coverage', 'node_modules', '*.cjs'],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['react-refresh'],
  rules: {
    // Intentionally off: several files co-locate a context/provider with its
    // hook (AuthContext→useAuth, Toast→useToast) or export an icon map. That's
    // a deliberate pattern here, not a bug — only a HMR-granularity nicety.
    'react-refresh/only-export-components': 'off',
  },
};
