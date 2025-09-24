module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: ['./tsconfig.eslint.json'],
    tsconfigRootDir: __dirname,
  },
  env: {
    node: true,
    es2022: true,
  },
  plugins: ['@typescript-eslint', 'prettier'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:prettier/recommended',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
    'prettier/prettier': 'error',
  },
  ignorePatterns: ['lib', 'dist', 'node_modules', 'cpmm/artifacts', 'clmm/artifacts', '*.d.ts'],
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.spec.ts'],
      env: {
        jest: true,
      },
      rules: {
        '@typescript-eslint/unbound-method': 'off',
      },
    },
  ],
  reportUnusedDisableDirectives: true,
};
