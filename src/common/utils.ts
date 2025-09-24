export function sortTokens(tokenAId: string, tokenBId: string): [string, string] {
  return tokenAId < tokenBId ? [tokenAId, tokenBId] : [tokenBId, tokenAId];
}
