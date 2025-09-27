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
    return value.toString();
  }

  static scaleDecimal(value: NumericLike, decimals: number): Decimal {
    if (decimals <= 0) {
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
}
