const U256_HEX_CHARS = 64;
const CONTRACT_ID_HEX_CHARS = 64;

const chunkHexString = (hex: string, chunkLength: number): string[] => {
  if (hex.length === 0) {
    return [];
  }
  if (hex.length % chunkLength !== 0) {
    throw new Error(`Packed data must be a multiple of ${chunkLength / 2} bytes`);
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < hex.length; offset += chunkLength) {
    const chunk = hex.slice(offset, offset + chunkLength);
    chunks.push(chunk);
  }
  return chunks;
};

export const decodeU256List = (str: string): bigint[] => {
  return chunkHexString(str, U256_HEX_CHARS).map((chunk) => BigInt(`0x${chunk}`));
};

export const decodeContractIdList = (str: string): string[] => {
  return chunkHexString(str, CONTRACT_ID_HEX_CHARS);
};
