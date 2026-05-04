import {
  MINIMAL_CONTRACT_DEPOSIT,
  ONE_ALPH,
  web3,
  ALPH_TOKEN_ID,
  DUST_AMOUNT,
  addressFromContractId,
  sleep,
} from '@alephium/web3'
import { Fixture as ClmmFixture } from '../../clmm/integration-tests/helpers'
import { Fixture as StakingFixture } from '../../staking/integration-tests/helpers'
import { Fixture as CpmmFixture } from '../../cpmm/integration-tests/helpers'
import { TokenPair } from '../../../cpmm/artifacts/ts'

import { getSigners } from '@alephium/web3-test'
import { Powfi } from '../../../src/powfi'

describe('CLMM Protocol Swap Integration Test', () => {
  let powfi: Powfi
  let clmmFixture: ClmmFixture
  let cpmmFixture: CpmmFixture

  beforeAll(async () => {
    const [deployer] = await getSigners(1, 2000n * ONE_ALPH)
    powfi = new Powfi({ networkId: 'devnet', signer: deployer })
    powfi.setCurrentProviders()
    clmmFixture = await ClmmFixture.load(powfi, true) // Deploy CLMM
    cpmmFixture = await CpmmFixture.load(powfi, true) // Deploy CPMM
  })

  test('protocol-swap flow for CLMM and CPMM', async () => {
    const stakingFixture = await StakingFixture.load(powfi, 1n)
    const deployer = clmmFixture.deployer
    const deployerAddress = (await deployer.getSelectedAccount()).address

    const staker = stakingFixture.deployer
    const stakerAddress = (await staker.getSelectedAccount()).address

    // 1. Create CLMM Pool Config
    const feeProtocol = 4n | (4n << 4n) // 1/4 for both tokens
    const configIndex = 0n
    await clmmFixture.factory.transact.createConfig({
      signer: deployer,
      args: {
        config: {
          tickSpacing: 1n,
          fee: 3000n,
          feeProtocol
        }
      },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT
    })

    // 2. Create CLMM Pool
    const tokenId1 = clmmFixture.tokenId1
    await powfi.clmm.createPool(
      configIndex,
      ALPH_TOKEN_ID,
      tokenId1,
      '',
      0n, // tick
      100n * ONE_ALPH,
      100n * ONE_ALPH,
      -887272n,
      887272n
    )

    // 3. Create CPMM Pool
    const amount0 = 100n * ONE_ALPH
    const amount1 = 100n * ONE_ALPH
    await cpmmFixture.createPool(amount0, amount1)

    const cpmmPoolId = powfi.cpmm.getPoolId(cpmmFixture.tokenId0, cpmmFixture.tokenId1)

    // 4. Setup RewardFeeCollector
    const rewardCollector = await stakingFixture.setupFeeCollector({
      clmmFactoryId: clmmFixture.factory.contractId,
      cpmmFactoryId: cpmmFixture.factory.contractId
    })

    await powfi.clmm.setFeeCollector()
    await powfi.cpmm.setFeeCollector()

    await powfi.staking.enableToken(tokenId1)
    await powfi.staking.enableToken(cpmmPoolId)

    // --- Reward Distribution Flow ---
    // a. User stakes 1 ALPH
    const stakeAmount = 1n * ONE_ALPH
    await stakingFixture.stakeAlph(staker, stakeAmount)
    const balancesAfterStake = await stakingFixture.getBalances(stakerAddress)
    expect(balancesAfterStake.xalph).toBeGreaterThan(0n)

    // b. Generate CLMM Fees (swap token1 -> token0)
    const pool = powfi.clmm.getPool(ALPH_TOKEN_ID, tokenId1, configIndex)
    await pool.transact.swap({
      signer: deployer,
      args: {
        payer: deployerAddress,
        recipient: deployerAddress,
        token: ALPH_TOKEN_ID, // token out
        zeroForOne: false,
        amountSpecified: 10n * ONE_ALPH, // exact out ALPH
        sqrtPriceLimitX96: 1461446703485210103287273052203988822378723970341n,
        data: ''
      },
      tokens: [{ id: tokenId1, amount: 20n * ONE_ALPH }],
      attoAlphAmount: DUST_AMOUNT * 2n
    })

    // c. Generate CPMM Fees (swap token1 -> token0)
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
      tokens: [{ id: cpmmFixture.tokenId1, amount: amountIn }],
    })

    // Trigger LP Fee Minting via Burn
    await cpmmPool.transact.burn({
      signer: deployer,
      args: {
        sender: deployerAddress,
        liquidity: ONE_ALPH
      },
      tokens: [{ id: cpmmPoolId, amount: ONE_ALPH }],
    })

    const nodeProvider = web3.getCurrentNodeProvider()

    // 5. Collect and Swap CLMM
    await powfi.clmm.collectProtocolFees({
      token0: ALPH_TOKEN_ID,
      token1: tokenId1,
      configIndex,
      tokenId: tokenId1
    })
    await powfi.staking.swapProtocolFeesCLMM(tokenId1, configIndex)

    // 6. Collect and Swap CPMM
    await powfi.cpmm.collectProtocolFees({
      tokenAId: cpmmFixture.tokenId0,
      tokenBId: cpmmFixture.tokenId1
    })

    const lpVaultIdFinal = powfi.staking.getDistributorVaultId(cpmmPoolId)
    const lpVaultAddressFinal = addressFromContractId(lpVaultIdFinal)

    const lpBalanceBefore = await nodeProvider.addresses.getAddressesAddressBalance(lpVaultAddressFinal)
    const lpAmountBefore = lpBalanceBefore.tokenBalances?.find(t => t.id === cpmmPoolId)?.amount ?? '0'
    expect(BigInt(lpAmountBefore)).toBeGreaterThan(0n)

    await powfi.staking.burnProtocolFeesCPMM(cpmmFixture.tokenId0, cpmmFixture.tokenId1)

    const lpBalanceAfterBurn = await nodeProvider.addresses.getAddressesAddressBalance(lpVaultAddressFinal)
    const lpAmountAfter = lpBalanceAfterBurn.tokenBalances?.find(t => t.id === cpmmPoolId)?.amount ?? '0'
    expect(BigInt(lpAmountAfter)).toBe(0n)

    // Check released tokens (token1) in LP vault
    const token1AmountAfterBurn = lpBalanceAfterBurn.tokenBalances?.find(t => t.id === cpmmFixture.tokenId1)?.amount ?? '0'
    expect(BigInt(token1AmountAfterBurn)).toBeGreaterThan(0n)

    await powfi.staking.swapProtocolFeesCPMM(cpmmPoolId, cpmmFixture.tokenId1)

    const lpBalanceAfterSwap = await nodeProvider.addresses.getAddressesAddressBalance(lpVaultAddressFinal)
    const token1AmountAfterSwap = lpBalanceAfterSwap.tokenBalances?.find(t => t.id === cpmmFixture.tokenId1)?.amount ?? '0'
    expect(BigInt(token1AmountAfterSwap)).toBe(0n)

    // Transfer ALPH to collector
    await powfi.staking.transferALPH(cpmmPoolId)
    const lpBalanceAfterTransfer = await nodeProvider.addresses.getAddressesAddressBalance(lpVaultAddressFinal)
    expect(BigInt(lpBalanceAfterTransfer.balance)).toBeLessThan(BigInt(lpBalanceAfterSwap.balance))

    // d. Set reward rate and Distribute Rewards to xALPH holders
    await stakingFixture.powfi.staking.setRewardRate(1000n)
    const xAlphStateBefore = await stakingFixture.powfi.staking.getXAlphToken().fetchState()
    await stakingFixture.powfi.staking.distributeRewards(rewardCollector.contractId)

    const xAlphStateAfter = await stakingFixture.powfi.staking.getXAlphToken().fetchState()
    const distributedAmount = xAlphStateAfter.fields.totalDepositedAlph - xAlphStateBefore.fields.totalDepositedAlph
    expect(distributedAmount).toBeGreaterThan(0n)

    // e. Unstake and Claim
    const balanceBeforeUnstake = await nodeProvider.addresses.getAddressesAddressBalance(stakerAddress)
    await stakingFixture.startUnstake(staker, balancesAfterStake.xalph)
    const unstakeVaultIndexes = await stakingFixture.getActiveUnstakeVaultIndexes(staker)
    await stakingFixture.claimUnstaked(staker, unstakeVaultIndexes[0], balancesAfterStake.xalph)

    const balanceAfterClaim = await nodeProvider.addresses.getAddressesAddressBalance(stakerAddress)
    expect(BigInt(balanceAfterClaim.balance)).toBeGreaterThan(BigInt(balanceBeforeUnstake.balance))
  }, 60000000)
})
