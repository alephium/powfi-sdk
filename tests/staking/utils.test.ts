import { decodeContractIdList, decodeU256List } from '../../src/staking/utils';

const padU256 = (value: bigint): string => value.toString(16).padStart(64, '0');

describe('staking utils', () => {
  describe('decodeU256List', () => {
    it('decodes packed u256 byte vectors into bigint arrays', () => {
      const packed = `${padU256(1n)}${padU256(512n)}`;
      expect(decodeU256List(packed)).toStrictEqual([1n, 512n]);
    });

    it('returns an empty array for empty payloads', () => {
      expect(decodeU256List('')).toStrictEqual([]);
    });

    it('throws when payload length is invalid', () => {
      expect(() => decodeU256List('1234')).toThrow('Packed data must be a multiple of 32 bytes');
    });
  });

  describe('decodeContractIdList', () => {
    it('converts packed contract ids into string arrays', () => {
      const idA = 'abcd'.padEnd(64, '0');
      const idB = 'fff1'.padEnd(64, '0');
      expect(decodeContractIdList(`${idA}${idB}`)).toStrictEqual([idA, idB]);
    });

    it('handles empty payloads', () => {
      expect(decodeContractIdList('')).toStrictEqual([]);
    });
  });
});
