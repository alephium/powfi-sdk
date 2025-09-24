export type Rounding = 'floor' | 'ceil';

export class MathUtil {
  // Copied from https://github.com/Aisse-258/bigint-isqrt/blob/master/main.js
  static sqrt = function (value: bigint): bigint {
    if (value < 2n) {
      return value;
    }

    if (value < 16n) {
      return BigInt(Math.sqrt(Number(value)) | 0);
    }

    let x0, x1;
    if (value < 4503599627370496n) {
      //1n<<52n
      x1 = BigInt(Math.sqrt(Number(value)) | 0) - 3n;
    } else {
      const vlen = value.toString().length;
      if (!(vlen & 1)) {
        x1 = 10n ** BigInt(vlen / 2);
      } else {
        x1 = 4n * 10n ** BigInt((vlen / 2) | 0);
      }
    }

    do {
      x0 = x1;
      x1 = (value / x0 + x0) >> 1n;
    } while (x0 !== x1 && x0 !== x1 - 1n);

    return x0;
  };

  static divFloor(a: bigint, b: bigint): bigint {
    return this.divWithRounding(a, b, 'floor');
  }

  static divCeil(a: bigint, b: bigint): bigint {
    return this.divWithRounding(a, b, 'ceil');
  }

  static mulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
    if (d === 0n) {
      throw new Error(`Division by zero in mulDivFloor: ${a} * ${b} / ${d}`);
    }
    const product = a * b;
    return this.divFloor(product, d);
  }

  static mulDivCeil(a: bigint, b: bigint, d: bigint): bigint {
    if (d === 0n) {
      throw new Error(`Division by zero in mulDivCeil: ${a} * ${b} / ${d}`);
    }
    const product = a * b;
    return this.divCeil(product, d);
  }

  private static divWithRounding = (a: bigint, b: bigint, mode: Rounding): bigint => {
    if (b === 0n) {
      throw new Error(`Division by zero: ${a} / ${b}`);
    }

    const quotient = a / b;
    const remainder = a % b;
    if (remainder === 0n) {
      return quotient;
    }

    const signsMatch = a >= 0n === b >= 0n;
    if (mode === 'floor') {
      return signsMatch ? quotient : quotient - 1n;
    }
    return signsMatch ? quotient + 1n : quotient;
  };
}
