import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'data/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['census/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', setTimeout: 'readonly' } },
  },
);
