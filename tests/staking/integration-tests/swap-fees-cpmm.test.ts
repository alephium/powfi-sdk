import {
  MINIMAL_CONTRACT_DEPOSIT,
  ONE_ALPH,
  web3,
  ALPH_TOKEN_ID,
  DUST_AMOUNT,
  addressFromContractId
} from '@alephium/web3'
import { getSigners, expectAssertionError } from '@alephium/web3-test'
import { Fixture as StakingFixture } from './helpers'
import { Fixture as CpmmFixture } from '../../cpmm/integration-tests/helpers'
import { TokenPair } from 'cpmm'
import { Powfi } from '../../../src/powfi'
import type { SignerProvider } from '@alephium/web3'

web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch)

describe('SDK swapFeesOnCPMM Integration Test', () => {
  let powfi: Powfi
  let stakingFixture: StakingFixture
  let cpmmFixture: CpmmFixture
  let deployer: SignerProvider
  let token1Id: string
  let cpmmPoolId: string

  beforeAll(async () => {
    const signers = await getSigners(2, 2000n * ONE_ALPH)
    deployer = signers[0]
    powfi = new Powfi({ networkId: 'devnet', signer: deployer })
    powfi.setCurrentProviders()

    cpmmFixture = await CpmmFixture.load(powfi, true) // Deploy CPMM with ALPH as token0
    stakingFixture = await StakingFixture.load(powfi, 1n) // Deploy Staking

    token1Id = cpmmFixture.tokenId1

    // Create CPMM pool
    const amount0 = 100n * ONE_ALPH
    const amount1 = 100n * ONE_ALPH
    await cpmmFixture.createPool(amount0, amount1)
    cpmmPoolId = powfi.cpmm.getPoolId(cpmmFixture.tokenId0, cpmmFixture.tokenId1)

    // Setup reward collector with CPMM factory
    await stakingFixture.setupFeeCollector({
      clmmFactoryId: '',
      cpmmFactoryId: cpmmFixture.factory.contractId
    })
    await powfi.cpmm.setFeeCollector()

    // Enable tokens
    await powfi.staking.enableToken(cpmmPoolId)
  }, 120000)

  beforeEach(() => {
    powfi.signer = deployer
  })

  test('should successfully swap fees on CPMM via SDK', async () => {
    const deployerAddress = (await deployer.getSelectedAccount()).address
    const nodeProvider = web3.getCurrentNodeProvider()

    // Mint additional liquidity to generate fees
    const cpmmPool = TokenPair.at(addressFromContractId(cpmmPoolId))
    await cpmmPool.transact.mint({
      signer: deployer,
      args: {
        sender: deployerAddress,
        amount0: 10n * ONE_ALPH,
        amount1: 10n * ONE_ALPH
      },
      tokens: [
        { id: cpmmFixture.tokenId0, amount: 10n * ONE_ALPH },
        { id: cpmmFixture.tokenId1, amount: 10n * ONE_ALPH }
      ],
      attoAlphAmount: 2n * ONE_ALPH
    })

    // Swap to generate protocol fees
    const amountIn = ONE_ALPH
    const amountOut = ONE_ALPH / 2n
    await cpmmPool.transact.swap({
      signer: deployer,
      args: {
        sender: deployerAddress,
        to: deployerAddress,
        amount0In: 0n,
        amount1In: amountIn,
        amount0Out: amountOut,
        amount1Out: 0n
      },
      tokens: [{ id: token1Id, amount: amountIn }]
    })

    // Burn LP tokens to trigger LP fee minting
    await cpmmPool.transact.burn({
      signer: deployer,
      args: {
        sender: deployerAddress,
        liquidity: ONE_ALPH
      },
      tokens: [{ id: cpmmPoolId, amount: ONE_ALPH }]
    })

    // 1. Collect CPMM LP tokens into the Distributor Vault
    await powfi.cpmm.collectProtocolFees({
      tokenAId: cpmmFixture.tokenId0,
      tokenBId: cpmmFixture.tokenId1
    })

    const lpVaultId = powfi.staking.getDistributorVaultId(cpmmPoolId)
    const lpVaultAddress = addressFromContractId(lpVaultId)

    // Check that the LP token has been received by the vault
    const lpBalanceBefore = await nodeProvider.addresses.getAddressesAddressBalance(lpVaultAddress)
    const lpAmountBefore = lpBalanceBefore.tokenBalances?.find((t) => t.id === cpmmPoolId)?.amount ?? '0'
    expect(BigInt(lpAmountBefore)).toBeGreaterThan(0n)

    // 2. Burn LP tokens in the vault to retrieve underlying token1 and ALPH
    await powfi.staking.burnProtocolFeesCPMM(cpmmFixture.tokenId0, cpmmFixture.tokenId1)

    // Verify LP token balance is now 0, and token1 balance is greater than 0
    const lpBalanceAfterBurn = await nodeProvider.addresses.getAddressesAddressBalance(lpVaultAddress)
    const lpAmountAfter = lpBalanceAfterBurn.tokenBalances?.find((t) => t.id === cpmmPoolId)?.amount ?? '0'
    expect(BigInt(lpAmountAfter)).toBe(0n)

    const token1AmountAfterBurn = lpBalanceAfterBurn.tokenBalances?.find((t) => t.id === token1Id)?.amount ?? '0'
    expect(BigInt(token1AmountAfterBurn)).toBeGreaterThan(0n)

    // 3. Swap the accumulated token1 for ALPH using swapProtocolFeesCPMM
    const rewardCollectorId = powfi.staking.getConfig().feeCollectorId
    const rewardCollectorAddress = addressFromContractId(rewardCollectorId)

    const collectorBalanceBefore = await nodeProvider.addresses.getAddressesAddressBalance(rewardCollectorAddress)

    await powfi.staking.swapProtocolFeesCPMM(cpmmPoolId, token1Id)

    // 4. Verify token1 has been swapped (balance is 0) and collector received ALPH
    const lpBalanceAfterSwap = await nodeProvider.addresses.getAddressesAddressBalance(lpVaultAddress)
    const token1AmountAfterSwap = lpBalanceAfterSwap.tokenBalances?.find((t) => t.id === token1Id)?.amount ?? '0'
    expect(BigInt(token1AmountAfterSwap)).toBe(0n)

    const collectorBalanceAfter = await nodeProvider.addresses.getAddressesAddressBalance(rewardCollectorAddress)
    expect(BigInt(collectorBalanceAfter.balance)).toBeGreaterThan(BigInt(collectorBalanceBefore.balance))
  }, 120000)

  test('should fail when swapFeesOnCPMM is called by non-owner', async () => {
    const invalidCallerSigner = (await getSigners(2, 10n * ONE_ALPH))[1]
    const lpVaultId = powfi.staking.getDistributorVaultId(cpmmPoolId)
    const lpVaultAddress = addressFromContractId(lpVaultId)

    powfi.signer = invalidCallerSigner

    await expectAssertionError(
      powfi.staking.swapProtocolFeesCPMM(cpmmPoolId, token1Id),
      lpVaultAddress,
      18
    )
  }, 120000)
})
