import Decimal from 'decimal.js'

export type NumericLike = Decimal | bigint | number | string | undefined | null

/** Conversion utilities between bigint, Decimal, number, and string. */
export class NumericUtils {
  /** Converts any NumericLike value to a Decimal instance. */
  static decimalFrom(value: NumericLike): Decimal {
    if (value === undefined || value === null) {
      return new Decimal(0)
    }
    if (Decimal.isDecimal(value)) {
      return value
    }
    if (typeof value === 'bigint') {
      return new Decimal(value.toString())
    }
    return new Decimal(value)
  }

  /** Converts a Decimal to a plain numeric string (no scientific notation). */
  static decimalToString(value: Decimal): string {
    if (!value.isFinite()) {
      return value.toString()
    }
    return value.toFixed(value.decimalPlaces())
  }

  /** Scales a value by dividing by 10^decimals (for token amount display). */
  static scaleDecimal(value: NumericLike, decimals: number): Decimal {
    if (decimals < 0) {
      throw new Error('Decimals must be non-negative')
    }
    if (decimals === 0) {
      return this.decimalFrom(value)
    }
    return this.decimalFrom(value).div(new Decimal(10).pow(decimals))
  }

  /** Scales and converts to string in one step. */
  static scaleToString(value: NumericLike, decimals: number): string {
    return this.decimalToString(this.scaleDecimal(value, decimals))
  }

  /** Converts any NumericLike to a plain numeric string. */
  static numericToString(value: NumericLike): string {
    return this.decimalToString(this.decimalFrom(value))
  }

  /** Converts any NumericLike to a bigint; throws for non-finite or non-integer values. */
  static numericToBigInt(value: NumericLike): bigint {
    if (value === undefined || value === null) {
      return 0n
    }
    if (typeof value === 'bigint') {
      return value
    }

    const decimalValue = this.decimalFrom(value)

    if (!decimalValue.isFinite()) {
      throw new Error('Cannot convert non-finite value to bigint')
    }

    if (!decimalValue.isInteger()) {
      throw new Error('Cannot convert non-integer value to bigint')
    }

    return BigInt(decimalValue.toFixed(0))
  }
}
