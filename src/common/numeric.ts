import Decimal from 'decimal.js';

export type NumericLike = Decimal | bigint | number | string | undefined | null;

export class NumericUtils {
  static decimalFrom(value: NumericLike): Decimal {
    if (value === undefined || value === null) {
      return new Decimal(0);
    }
    if (Decimal.isDecimal(value)) {
      return value;
    }
    if (typeof value === 'bigint') {
      return new Decimal(value.toString());
    }
    return new Decimal(value);
  }

  static decimalToString(value: Decimal): string {
    if (!value.isFinite()) {
      return value.toString();
    }
    return value.toFixed(value.decimalPlaces());
  }

  static scaleDecimal(value: NumericLike, decimals: number): Decimal {
    if (decimals < 0) {
      throw new Error('Decimals must be non-negative');
    }
    if (decimals === 0) {
      return this.decimalFrom(value);
    }
    return this.decimalFrom(value).div(new Decimal(10).pow(decimals));
  }

  static scaleToString(value: NumericLike, decimals: number): string {
    return this.decimalToString(this.scaleDecimal(value, decimals));
  }

  static numericToString(value: NumericLike): string {
    return this.decimalToString(this.decimalFrom(value));
  }

  static numericToBigInt(value: NumericLike): bigint {
    if (value === undefined || value === null) {
      return 0n;
    }
    if (typeof value === 'bigint') {
      return value;
    }

    const decimalValue = this.decimalFrom(value);

    if (!decimalValue.isFinite()) {
      throw new Error('Cannot convert non-finite value to bigint');
    }

    if (!decimalValue.isInteger()) {
      throw new Error('Cannot convert non-integer value to bigint');
    }

    return BigInt(decimalValue.toFixed(0));
  }
}
