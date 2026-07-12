/* ESLint config for the NestJS + TypeScript backend. */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    // Disables stylistic rules that would conflict with Prettier (the repo
    // formats with `npm run format`). This does NOT run Prettier as a lint rule.
    'prettier',
  ],
  env: { node: true, jest: true },
  ignorePatterns: ['dist', 'node_modules', '.eslintrc.cjs'],
  rules: {
    // NestJS leans on decorators + DI; explicit return types add little here.
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    // Honour the `_`-prefix convention for intentionally-unused bindings
    // (e.g. `const { members: _m, ...rest } = project`, unused gateway params).
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
  },
};
