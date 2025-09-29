import Decimal from 'decimal.js';
import { NumericUtils } from '../../src/common/numeric';

describe('NumericUtils', () => {
  describe('decimalFrom', () => {
    it('creates Decimal instances from supported numeric inputs', () => {
      expect(NumericUtils.decimalFrom(42).eq(new Decimal(42))).toBe(true);
      expect(NumericUtils.decimalFrom('123.45').eq(new Decimal('123.45'))).toBe(true);
      expect(NumericUtils.decimalFrom(9876543210n).eq(new Decimal('9876543210'))).toBe(true);
      const decimal = new Decimal('6.02e23');
      expect(NumericUtils.decimalFrom(decimal)).toBe(decimal);
    });

    it('treats nullish values as zero', () => {
      expect(NumericUtils.decimalFrom(undefined).eq(new Decimal(0))).toBe(true);
      expect(NumericUtils.decimalFrom(null).eq(new Decimal(0))).toBe(true);
    });
  });

  describe('decimalToString', () => {
    it('serializes Decimal values using their standard string form', () => {
      const value1 = new Decimal('123456.789');
      expect(NumericUtils.decimalToString(value1)).toBe('123456.789');
      const value2 = new Decimal('6141499729366972993414');
      expect(NumericUtils.decimalToString(value2)).toBe('6141499729366972993414');
      const value3 = new Decimal('0.000012300');
      expect(NumericUtils.decimalToString(value3)).toBe('0.0000123');
    });
  });

  describe('scaleDecimal', () => {
    it('scales numeric inputs down by decimal places', () => {
      const scaled = NumericUtils.scaleDecimal('1234500', 4);
      expect(scaled.toString()).toBe('123.45');
    });

    it('returns the original value when decimals === 0', () => {
      const original = NumericUtils.scaleDecimal('99.9', 0);
      expect(original.toString()).toBe('99.9');
    });

    it('throws when decimals is negative', () => {
      expect(() => NumericUtils.scaleDecimal('1', -1)).toThrow('Decimals must be non-negative');
    });
  });

  describe('scaleToString', () => {
    it('returns a scaled string representation', () => {
      expect(NumericUtils.scaleToString(250000n, 5)).toBe('2.5');
    });
  });

  describe('numericToString', () => {
    it('normalizes supported numeric inputs to strings', () => {
      expect(NumericUtils.numericToString(1234)).toBe('1234');
      expect(NumericUtils.numericToString('5e2')).toBe('500');
      expect(NumericUtils.numericToString(3000000000000000000n)).toBe('3000000000000000000');
      expect(NumericUtils.numericToString('6.141499729366972993414e+21')).toBe(
        '6141499729366972993414',
      );
    });
  });

  describe('numericToBigInt', () => {
    it('converts numeric strings in scientific notation to bigint', () => {
      expect(NumericUtils.numericToBigInt('6.141499729366972993414e+21')).toBe(
        BigInt('6141499729366972993414'),
      );
    });

    it('returns bigint inputs unchanged', () => {
      const value = 12345678901234567890n;
      expect(NumericUtils.numericToBigInt(value)).toBe(value);
    });

    it('handles Decimal instances', () => {
      const value = new Decimal('9876543210');
      expect(NumericUtils.numericToBigInt(value)).toBe(9876543210n);
    });

    it('treats undefined as zero', () => {
      expect(NumericUtils.numericToBigInt(undefined)).toBe(0n);
    });

    it('throws when the value has a fractional component', () => {
      expect(() => NumericUtils.numericToBigInt('1.5')).toThrow(
        'Cannot convert non-integer value to bigint',
      );
    });

    it('throws on non-finite values', () => {
      expect(() => NumericUtils.numericToBigInt('Infinity')).toThrow(
        'Cannot convert non-finite value to bigint',
      );
    });
  });
});
