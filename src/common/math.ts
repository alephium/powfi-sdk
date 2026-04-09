export type Rounding = 'floor' | 'ceil'

/** Bigint math utilities for AMM calculations. */
export class MathUtil {
  /** Computes integer square root using Newton's method. */
  static sqrt = function (value: bigint): bigint {
    if (value < 2n) {
      return value
    }

    if (value < 16n) {
      return BigInt(Math.sqrt(Number(value)) | 0)
    }

    let x0, x1
    if (value < 4503599627370496n) {
      //1n<<52n
      x1 = BigInt(Math.sqrt(Number(value)) | 0) - 3n
    } else {
      const vlen = value.toString().length
      if (!(vlen & 1)) {
        x1 = 10n ** BigInt(vlen / 2)
      } else {
        x1 = 4n * 10n ** BigInt((vlen / 2) | 0)
      }
    }

    do {
      x0 = x1
      x1 = (value / x0 + x0) >> 1n
    } while (x0 !== x1 && x0 !== x1 - 1n)

    return x0
  }

  /** Floor division that rounds towards negative infinity (Alephium convention). */
  static alphDiv(a: bigint, b: bigint): bigint {
    const result = a / b
    if (a * b < 0n) return result - BigInt(a % b != 0n)
    return result
  }

  /** Ceiling division that rounds away from zero. */
  static alphCeil(a: bigint, b: bigint): bigint {
    const result = a / b
    const rem = a % b
    return result + BigInt(rem != 0n) * BigInt(rem < 0n ? -1n : 1n)
  }

  /** Floor division for non-negative denominators. */
  static divFloor(a: bigint, b: bigint): bigint {
    return this.divWithRounding(a, b, 'floor')
  }

  /** Ceiling division for non-negative denominators. */
  static divCeil(a: bigint, b: bigint): bigint {
    return this.divWithRounding(a, b, 'ceil')
  }

  /** Multiplies then divides with floor rounding; throws on division by zero. */
  static mulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
    if (d === 0n) {
      throw new Error(`Division by zero in mulDivFloor: ${a} * ${b} / ${d}`)
    }
    const product = a * b
    return this.divFloor(product, d)
  }

  /** Multiplies then divides with ceiling rounding; throws on division by zero. */
  static mulDivCeil(a: bigint, b: bigint, d: bigint): bigint {
    if (d === 0n) {
      throw new Error(`Division by zero in mulDivCeil: ${a} * ${b} / ${d}`)
    }
    const product = a * b
    return this.divCeil(product, d)
  }

  private static divWithRounding = (a: bigint, b: bigint, mode: Rounding): bigint => {
    if (b === 0n) {
      throw new Error(`Division by zero: ${a} / ${b}`)
    }

    const quotient = a / b
    const remainder = a % b
    if (remainder === 0n) {
      return quotient
    }

    const signsMatch = a >= 0n === b >= 0n
    if (mode === 'floor') {
      return signsMatch ? quotient : quotient - 1n
    }
    return signsMatch ? quotient + 1n : quotient
  }
}
