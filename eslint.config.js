/* ESLint 플랫 설정 — 빌드 도구 없이 브라우저/Node 양쪽에서 도는 클래식 스크립트 */
module.exports = [
  {
    files: ['js/**/*.js', 'sw.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', globalThis: 'readonly',
        navigator: 'readonly', location: 'readonly', console: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        requestAnimationFrame: 'readonly', performance: 'readonly',
        Worker: 'readonly', Blob: 'readonly', URL: 'readonly',
        localStorage: 'readonly', caches: 'readonly', fetch: 'readonly', Response: 'readonly',
        self: 'readonly', Promise: 'readonly', AudioContext: 'readonly',
        module: 'writable', require: 'readonly', process: 'readonly'
      }
    },
    rules: {
      // catch (e) { /* 무시 */ } 패턴은 의도적이다 (구형 브라우저 호환을 위해 바인딩을 남긴다)
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-shadow-restricted-names': 'error',
      'no-dupe-keys': 'error',
      'no-fallthrough': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      eqeqeq: ['warn', 'smart'],
      'no-var': 'off',
      semi: ['error', 'always']
    }
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: { require: 'readonly', module: 'writable', console: 'readonly', process: 'readonly', __dirname: 'readonly' }
    },
    rules: { 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }] }
  }
];
