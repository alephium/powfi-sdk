import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  splitting: false,
  outDir: 'lib',
  noExternal: ['clmm', 'cpmm', 'staking']
})
