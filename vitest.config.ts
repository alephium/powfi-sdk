import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts'],
      reporter: ['text', 'lcov', 'html']
    },
    fileParallelism: false,
    sequence: {
      concurrent: false
    }
  },
  resolve: {
    // Mirrors the `paths` in tsconfig.json: contract artifacts live in ./clmm, ./cpmm and ./staking
    alias: [
      { find: /^(clmm|cpmm|staking)$/, replacement: path.resolve(__dirname, '$1/artifacts/ts/index.ts') },
      { find: /^(clmm|cpmm|staking)\//, replacement: path.resolve(__dirname, '$1') + '/' }
    ]
  }
})
