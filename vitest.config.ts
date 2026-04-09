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
    alias: {
      cpmm: path.resolve(__dirname, '../cpmm'),
      clmm: path.resolve(__dirname, '../clmm'),
      staking: path.resolve(__dirname, '../staking')
    }
  }
})
