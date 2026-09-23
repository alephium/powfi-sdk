/* eslint-disable @typescript-eslint/require-await -- copied as-is from the staking contracts package */
import keccak256 from 'keccak256'

export type MerkleWhitelist = {
  root: string
  proofs: Record<string, string>
  leaves: string[]
}

export async function buildMerkleWhitelist(codeHashes: string[]): Promise<MerkleWhitelist> {
  if (codeHashes.length === 0) {
    throw new Error('At least one code hash is required to build a Merkle allowlist')
  }
  const leafHashes = await Promise.all(codeHashes.map(hash))
  const levels = await buildMerkleTreeLevels(leafHashes)
  const root = levels[levels.length - 1][0]
  const proofs: Record<string, string> = {}
  codeHashes.forEach((hashValue, index) => {
    proofs[hashValue] = buildProofForIndex(levels, index).join('')
  })
  return { root, proofs, leaves: codeHashes }
}

export function buildProofForIndex(levels: string[][], leafIndex: number): string[] {
  const proof: string[] = []
  let index = leafIndex
  for (let level = 0; level < levels.length - 1; level += 1) {
    const currentLevel = levels[level]
    const isRightNode = index % 2 === 1
    const siblingIndex = isRightNode ? index - 1 : index + 1
    const sibling = currentLevel[siblingIndex] ?? currentLevel[index]
    proof.push(sibling)
    index = Math.floor(index / 2)
  }
  return proof
}

async function buildMerkleTreeLevels(leaves: string[]): Promise<string[][]> {
  if (leaves.length === 0) {
    throw new Error('Cannot build a Merkle tree with zero leaves')
  }
  const levels: string[][] = [leaves]
  while (levels[levels.length - 1].length > 1) {
    const currentLevel = levels[levels.length - 1]
    const nextLevel: string[] = []
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i]
      const right = currentLevel[i + 1] ?? currentLevel[i]
      nextLevel.push(await hashPair(left, right))
    }
    levels.push(nextLevel)
  }
  return levels
}

async function hash(data: string): Promise<string> {
  return keccak256(Buffer.from(data, 'hex')).toString('hex')
}

async function hashPair(a: string, b: string): Promise<string> {
  const aValue = BigInt(`0x${a}`)
  const bValue = BigInt(`0x${b}`)
  const [first, second] = aValue < bValue ? [a, b] : [b, a]
  return keccak256(Buffer.from(`${first}${second}`, 'hex')).toString('hex')
}
