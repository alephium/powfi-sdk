import { sortTokens } from '../../src/common/utils'

describe('Utility Functions', () => {
  describe('sortTokens', () => {
    it('should sort tokens by their hex values', () => {
      const tokenA = '1000000000000000000000000000000000000000000000000000000000000001'
      const tokenB = '1000000000000000000000000000000000000000000000000000000000000002'

      const [first, second] = sortTokens(tokenA, tokenB)
      expect(first).toBe(tokenA)
      expect(second).toBe(tokenB)
    })

    it('should handle reverse order', () => {
      const tokenA = '1000000000000000000000000000000000000000000000000000000000000002'
      const tokenB = '1000000000000000000000000000000000000000000000000000000000000001'

      const [first, second] = sortTokens(tokenA, tokenB)
      expect(first).toBe(tokenB)
      expect(second).toBe(tokenA)
    })
  })
})
