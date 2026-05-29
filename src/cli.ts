/* eslint-disable */
import { Powfi } from './powfi'
import { ALPH_TOKEN_ID, addressFromContractId, KeyType, hexToString, subContractId } from '@alephium/web3'
import { PrivateKeyWallet } from '@alephium/web3-wallet'
import { testPrivateKeyWallet } from '@alephium/web3-test'
import { TickUtils } from './clmm/tick'
import { ClmmLiquidityUtils } from './clmm/liquidity'
import { sortTokens } from './common/utils'
import Decimal from 'decimal.js'
import { Position, DexAccount, DexAccountRoot } from 'clmm'
import { PoolUtils } from './clmm/pool'
import type { ClmmPoolContractState, ClmmSimulateSwapQuote } from './clmm/types'
import type { CpmmPoolContractState } from './cpmm/types'
import type { TokenInfo } from '@alephium/token-list'
import { TokenPair } from 'cpmm'
import { DistributorVault } from 'staking'

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command) {
    console.log('Usage: npx ts-node src/cli.ts <module> <action> [args]')
    console.log('Modules:')
    console.log('  clmm')
    console.log('  cpmm')
    console.log('  stake')
    console.log('  token')
    console.log('  collector')
    console.log('  ref create [referrer] | info [address] | set-parents | upgrade [address] | migrate')
    return
  }

  const networkId = (process.env.NETWORK as string) || 'devnet'
  const privateKey = process.env.PRIVATE_KEY
  const keyType: KeyType = process.env.GROUP ? 'default' : 'gl-secp256k1'

  let signer: PrivateKeyWallet
  if (privateKey) {
    signer = new PrivateKeyWallet({ privateKey, keyType })
  } else if (networkId === 'devnet') {
    signer = testPrivateKeyWallet
    console.log('Using default test signer for devnet')
  } else {
    console.error('PRIVATE_KEY environment variable is required for non-devnet networks')
    process.exit(1)
  }

  const powfi = new Powfi({
    networkId: networkId as 'mainnet' | 'testnet' | 'devnet',
    signer
  })

  powfi.setCurrentProviders()

  const formatAmount = (amount: bigint, decimals: number) => {
    return new Decimal(amount.toString()).div(new Decimal(10).pow(decimals)).toString()
  }

  const getTokenInfo = async (symbol: string) => {
    try {
      return await powfi.token.getTokenBySymbol(symbol)
    } catch (error) {
      // Check if it's a valid token ID
      if (symbol.length === 64) {
        const tokenId = symbol
        try {
          return await powfi.token.getTokenById(tokenId)
        } catch {
          const onChain = await powfi.nodeProvider.fetchFungibleTokenMetaData(tokenId)
          onChain.symbol = hexToString(onChain.symbol)
          onChain.name = hexToString(onChain.name)
          if (onChain) {
            return { id: tokenId, ...onChain, description: '', logoURI: '' }
          }
          throw new Error(`Unknown token: ${tokenId}`)
        }
      }
      throw new Error(`Unknown token: ${symbol}`)
    }
  }

  const getAmount = (amountStr: string | undefined, decimals: number): bigint => {
    if (!amountStr) return 0n
    const d = new Decimal(amountStr)
    const abs = BigInt(d.abs().mul(new Decimal(10).pow(decimals)).floor().toFixed(0))
    return d.isNegative() ? -abs : abs
  }

  const waitForTx = async (txId: string) => {
    while (true) {
      try {
        const status = await powfi.nodeProvider.transactions.getTransactionsStatus({ txId })
        if (status.type === 'Confirmed') return
      } catch (e) {
        // ignore errors and keep waiting
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
  }

  const showSwapStats = async (
    type: 'clmm' | 'cpmm',
    txId: string,
    poolId: string,
    tokenIn: { id: string; decimals: number; symbol: string },
    tokenOut: { id: string; decimals: number; symbol: string },
    prePrice: Decimal,
    options: {
      zeroForOne?: boolean
      t0: { id: string; decimals: number; symbol: string }
      t1: { id: string; decimals: number; symbol: string }
      poolState: ClmmPoolContractState | CpmmPoolContractState
    }
  ) => {
    const events = await powfi.nodeProvider.events.getEventsTxIdTxid(txId)
    const poolAddress = addressFromContractId(poolId)
    const eventIndex = type === 'clmm' ? 3 : 2
    const swapEvent = events.events.find((e) => e.contractAddress === poolAddress && e.eventIndex === eventIndex)

    if (!swapEvent) {
      console.log('Swap completed but info could not be parsed from events.')
      return
    }

    const fields = swapEvent.fields as { type: string; value: string }[]
    let actualIn: bigint
    let actualOut: bigint
    let finalPrice: Decimal
    let protocolFeeStr: string | undefined

    const { t0, t1, poolState } = options

    if (type === 'clmm') {
      const amount0 = BigInt(fields[2].value)
      const amount1 = BigInt(fields[3].value)
      const sqrtPriceX96After = BigInt(fields[4].value)
      const { zeroForOne } = options

      actualIn = zeroForOne ? amount0 : amount1
      actualOut = zeroForOne ? -amount1 : -amount0
      finalPrice = new Decimal(TickUtils.sqrtPriceX96ToPrice(sqrtPriceX96After, t0.decimals, t1.decimals))

      const clmmPoolState = poolState as ClmmPoolContractState
      const feeProtocolRaw = clmmPoolState.protocolFee
      const feeProtocolScale = zeroForOne ? feeProtocolRaw % 16n : feeProtocolRaw >> 4n
      if (feeProtocolScale > 0n) {
        const totalFee = new Decimal(actualIn.toString()).mul(Number(clmmPoolState.tradingFee)).div(1000000)
        const protocolFee = totalFee.div(Number(feeProtocolScale))
        protocolFeeStr = formatAmount(BigInt(protocolFee.floor().toString()), tokenIn.decimals)
      }
    } else {
      const amount0In = BigInt(fields[1].value)
      const amount1In = BigInt(fields[2].value)
      const amount0Out = BigInt(fields[3].value)
      const amount1Out = BigInt(fields[4].value)

      const isToken0 = tokenIn.id === t0.id
      actualIn = isToken0 ? amount0In : amount1In
      actualOut = isToken0 ? amount1Out : amount0Out

      const cpmmPoolState = poolState as CpmmPoolContractState
      const postReserve0 = BigInt(cpmmPoolState.reserve0) + amount0In - amount0Out
      const postReserve1 = BigInt(cpmmPoolState.reserve1) + amount1In - amount1Out
      finalPrice = new Decimal(postReserve1.toString())
        .div(new Decimal(postReserve0.toString()))
        .mul(new Decimal(10).pow(t0.decimals - t1.decimals))
    }

    const executionIn = formatAmount(actualIn, tokenIn.decimals)
    const executionOut = formatAmount(actualOut, tokenOut.decimals)

    const execPrice =
      actualIn === 0n
        ? new Decimal(0)
        : new Decimal(actualOut.toString())
            .div(new Decimal(actualIn.toString()))
            .mul(new Decimal(10).pow(tokenIn.decimals - tokenOut.decimals))

    const isT0 = tokenIn.id === t0.id
    const baseP = isT0 ? prePrice : prePrice.isZero() ? new Decimal(0) : new Decimal(1).div(prePrice)
    const finalP = isT0 ? finalPrice : finalPrice.isZero() ? new Decimal(0) : new Decimal(1).div(finalPrice)

    const priceDiff = finalP.sub(baseP)
    const priceImpact = baseP.isZero() ? new Decimal(0) : priceDiff.div(baseP).mul(100).abs()

    console.log(`\n${type.toUpperCase()} Swap Results:`)
    console.log(`- Input used:      ${executionIn} ${tokenIn.symbol}`)
    console.log(`- Output received: ${executionOut} ${tokenOut.symbol}`)
    console.log(`- Execution Price: ${execPrice.toFixed(10)} ${tokenOut.symbol}/${tokenIn.symbol}`)
    console.log(`- Price Impact:    ${priceImpact.toFixed(4)}%`)
    if (protocolFeeStr) {
      console.log(`- Protocol Fees:   ${protocolFeeStr} ${tokenIn.symbol}`)
    }
    console.log(`- Final price:     ${finalPrice.toFixed(10)} ${t1.symbol}/${t0.symbol}`)
  }

  const showSimStats = (
    type: 'clmm' | 'cpmm',
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: bigint,
    amountOut: bigint,
    priceImpact: number | Decimal,
    options: {
      prePrice?: Decimal
      finalPrice?: Decimal
      t0: TokenInfo
      t1: TokenInfo
      clmmQuote?: ClmmSimulateSwapQuote
    }
  ) => {
    console.log(`\n${type.toUpperCase()} Swap Simulation:`)
    console.log(`- Token In:       ${tokenIn.symbol}`)
    console.log(`- Token Out:      ${tokenOut.symbol}`)
    console.log(`- Input Amount:   ${formatAmount(amountIn, tokenIn.decimals)} ${tokenIn.symbol}`)
    console.log(`- Output Amount:  ${formatAmount(amountOut, tokenOut.decimals)} ${tokenOut.symbol}`)

    const execPrice =
      amountIn === 0n
        ? new Decimal(0)
        : new Decimal(amountOut.toString())
            .div(new Decimal(amountIn.toString()))
            .mul(new Decimal(10).pow(tokenIn.decimals - tokenOut.decimals))

    console.log(`- Execution Price: ${execPrice.toFixed(10)} ${tokenOut.symbol}/${tokenIn.symbol}`)
    console.log(`- Price Impact:    ${new Decimal(priceImpact.toString()).toFixed(4)}%`)

    if (options.finalPrice) {
      console.log(`- Final Price:     ${options.finalPrice.toFixed(10)} ${options.t1.symbol}/${options.t0.symbol}`)
    }

    if (type === 'clmm' && options.clmmQuote) {
      console.log(`\nCLMM Details:`)
      console.log(`  Tick rows fetched : ${options.clmmQuote.rows.length}`)
      console.log(`  Fee tier          : ${options.clmmQuote.fee} pips`)
    }
  }

  if (command === 'clmm') {
    const clmmActionOrTokenA = args[1]

    if (clmmActionOrTokenA === 'set-fee-collector') {
      console.log(`Setting CLMM fee collector...`)
      try {
        const result = await powfi.clmm.setFeeCollector()
        console.log(`Set fee collector submitted: ${result.txId}`)
        await waitForTx(result.txId)
        console.log(`Set fee collector confirmed.`)
      } catch (error) {
        console.error('Failed to set fee collector:', error)
      }
      return
    }

    const symbolA = clmmActionOrTokenA
    const symbolB = args[2]
    const configIndexStr = args[3]
    const action = args[4]
    const actionArgs = args.slice(5)

    if (!symbolA || !symbolB || !configIndexStr || !action) {
      console.log('Usage: npx ts-node src/cli.ts clmm <symbolA> <symbolB> <index> <action> [args]')
      console.log('Global Actions:')
      console.log('  clmm set-fee-collector')
      console.log('\nPool Actions:')
      console.log('  create <price> [amountA] [amountB]')
      console.log('  info [priceMin] [priceMax]                  # Pool or position info')
      console.log('  add <priceMin> <priceMax> <amount1> [amount2]')
      console.log('  rm <priceMin> <priceMax> <percent>          # Remove percentage of liquidity')
      console.log('  swap <symbolIn> <amountIn> [slippageBps]   # positive = exact-in, negative = exact-out')
      console.log('  sim-swap <symbolIn> <amountIn>              # positive = exact-in, negative = exact-out')
      console.log(
        '  swap-to <targetPrice>                       # swap until pool reaches target price (direction auto-inferred)'
      )
      console.log('  collect-protocol <tokenSymbol>')
      console.log('  protocol-swap')
      console.log('  rewards set <rewardSymbol> <amount> <durationDays>')
      console.log('  rewards extend <rewardSymbol> <amount>')
      console.log('  migrate-factory <newBytecode>')
      console.log('  migrate-account <newBytecode>')
      return
    }

    console.log(`Fetching token info for ${symbolA} and ${symbolB}...`)
    const [tokenA, tokenB] = await Promise.all([getTokenInfo(symbolA), getTokenInfo(symbolB)])

    const [id0, id1] = sortTokens(tokenA.id, tokenB.id)
    const isReversed = id0 !== tokenA.id
    const t0Info = isReversed ? tokenB : tokenA
    const t1Info = isReversed ? tokenA : tokenB

    const configIndex = BigInt(configIndexStr)
    const allConfigs = await powfi.clmm.getAllPoolConfigs()
    const config = allConfigs.find((c) => c.configIndex === configIndex)

    if (!config) {
      console.error(
        `Failed to find pool config ${configIndex}. Available indices: ${allConfigs.map((c) => c.configIndex).join(', ')}`
      )
      return
    }

    const poolId = powfi.clmm.getPoolId(t0Info.id, t1Info.id, configIndex)

    if (action === 'create') {
      const priceStr = actionArgs[0]
      const amountAStr = actionArgs[1]
      const amountBStr = actionArgs[2]

      if (!priceStr) {
        console.log('Usage: clmm <T1> <T2> <INDEX> create <price> [amountA] [amountB]')
        return
      }

      const exists = await powfi.clmm.poolExists(t0Info.id, t1Info.id, configIndex)
      if (exists) {
        console.error(`Pool already exists at address ${addressFromContractId(poolId)}`)
        return
      }

      const rawPrice = new Decimal(priceStr)
      const price = isReversed ? new Decimal(1).div(rawPrice) : rawPrice

      const tick = TickUtils.getAlignedTick(price.toNumber(), t0Info.decimals, t1Info.decimals, config.tickSpacing)

      console.log(`Creating pool with initial tick ${tick} (price ${priceStr} ${symbolB}/${symbolA})...`)

      const amountA = getAmount(amountAStr, tokenA.decimals)
      const amountB = getAmount(amountBStr, tokenB.decimals)

      const amount0 = isReversed ? amountB : amountA
      const amount1 = isReversed ? amountA : amountB

      // Default values for range
      const tickLower = (-887272n / config.tickSpacing) * config.tickSpacing
      const tickUpper = (887272n / config.tickSpacing) * config.tickSpacing

      try {
        const { poolId, result } = await powfi.clmm.createPool(
          configIndex,
          t0Info.id,
          t1Info.id,
          powfi.staking.getConfig().xAlphTokenId, // Use xALPH as reward token by default
          tick,
          amount0,
          amount1,
          tickLower,
          tickUpper
        )

        console.log(`Pool creation submitted: ${result.txId}`)
        console.log(`Pool ID will be: ${poolId}`)
        await waitForTx(result.txId)
        console.log('Pool creation confirmed.')
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        if (msg.includes('already exists')) {
          console.error(`Error: The pool or a sub-contract already exists.`)
        } else if (msg.includes('Error Code: 107')) {
          console.error(`Error: Initial liquidity is required (Error 107). Please provide amountA and amountB.`)
        } else if (msg.includes('InvalidTokenOrder')) {
          console.error(`Error: Invalid token order (701).`)
        } else {
          console.error('Failed to create pool:', error)
        }
      }
    } else if (action === 'add') {
      const priceMinStr = actionArgs[0]
      const priceMaxStr = actionArgs[1]
      const amountAStr = actionArgs[2]
      const amountBStr = actionArgs[3]

      if (!priceMinStr || !priceMaxStr || (!amountAStr && !amountBStr)) {
        console.log('Usage: clmm <T1> <T2> <INDEX> add <priceMin> <priceMax> <amount1> [amount2]')
        return
      }

      const exists = await powfi.clmm.poolExists(t0Info.id, t1Info.id, configIndex)
      if (!exists) {
        console.error(`Pool does not exist. Please create it first.`)
        return
      }

      const poolState = await powfi.clmm.getPoolState(poolId)
      const currentPrice = TickUtils.sqrtPriceX96ToPrice(poolState.sqrtPriceX96, t0Info.decimals, t1Info.decimals)
      console.log(`Current price: ${currentPrice.toFixed(6)} ${t1Info.symbol}/${t0Info.symbol}`)

      const priceMinVal = new Decimal(priceMinStr)
      const priceMaxVal = new Decimal(priceMaxStr)

      const p0 = isReversed ? new Decimal(1).div(priceMaxVal) : priceMinVal
      const p1 = isReversed ? new Decimal(1).div(priceMinVal) : priceMaxVal

      let tickLower = TickUtils.getAlignedTick(p0.toNumber(), t0Info.decimals, t1Info.decimals, config.tickSpacing)
      let tickUpper = TickUtils.getAlignedTick(p1.toNumber(), t0Info.decimals, t1Info.decimals, config.tickSpacing)

      if (tickLower > tickUpper) {
        ;[tickLower, tickUpper] = [tickUpper, tickLower]
      }

      console.log(`Adding liquidity between ticks ${tickLower} and ${tickUpper}`)

      const amountAValue = amountAStr ? getAmount(amountAStr, tokenA.decimals) : 0n
      const amountBValue = amountBStr ? getAmount(amountBStr, tokenB.decimals) : 0n

      let amount0 = isReversed ? amountBValue : amountAValue
      let amount1 = isReversed ? amountAValue : amountBValue

      // Autocalculate if one is missing
      if (amount0 > 0n && amount1 === 0n) {
        const sqrtRatioX96 = poolState.sqrtPriceX96
        const sqrtRatioAX96 = TickUtils.getSqrtRatioAtTick(tickLower)
        const sqrtRatioBX96 = TickUtils.getSqrtRatioAtTick(tickUpper)
        if (sqrtRatioX96 < sqrtRatioAX96) {
          amount1 = 0n
        } else if (sqrtRatioX96 < sqrtRatioBX96) {
          const liquidity = ClmmLiquidityUtils.getLiquidityFromToken0(sqrtRatioX96, sqrtRatioBX96, amount0)
          amount1 = ClmmLiquidityUtils.getToken1Delta(sqrtRatioAX96, sqrtRatioX96, liquidity)
        } else {
          console.error('Cannot add token0 to this range (already above current price)')
          return
        }
      } else if (amount1 > 0n && amount0 === 0n) {
        const sqrtRatioX96 = poolState.sqrtPriceX96
        const sqrtRatioAX96 = TickUtils.getSqrtRatioAtTick(tickLower)
        const sqrtRatioBX96 = TickUtils.getSqrtRatioAtTick(tickUpper)
        if (sqrtRatioX96 < sqrtRatioAX96) {
          console.error('Cannot add token1 to this range (already below current price)')
          return
        } else if (sqrtRatioX96 < sqrtRatioBX96) {
          const liquidity = ClmmLiquidityUtils.getLiquidityFromToken1(sqrtRatioAX96, sqrtRatioX96, amount1)
          amount0 = ClmmLiquidityUtils.getToken0Delta(sqrtRatioX96, sqrtRatioBX96, liquidity)
        } else {
          amount0 = 0n
        }
      }

      const [realAmount0, realAmount1, liquidity] = ClmmLiquidityUtils.getAmountsAndLiquidityAtSqrtPrice(
        poolState.sqrtPriceX96,
        TickUtils.getSqrtRatioAtTick(tickLower),
        TickUtils.getSqrtRatioAtTick(tickUpper),
        amount0,
        amount1
      )

      console.log(`Calculations:`)
      console.log(`- Liquidity to mint: ${liquidity}`)
      console.log(
        `- Token0 (${t0Info.symbol}) needed: ${formatAmount(realAmount0, t0Info.decimals)} (max ${formatAmount(amount0, t0Info.decimals)})`
      )
      console.log(
        `- Token1 (${t1Info.symbol}) needed: ${formatAmount(realAmount1, t1Info.decimals)} (max ${formatAmount(amount1, t1Info.decimals)})`
      )

      const signerAccount = await powfi.signer.getSelectedAccount()
      const positionId = powfi.clmm.getPositionId(poolId, signerAccount.address, tickLower, tickUpper)
      const positionAddress = addressFromContractId(positionId)
      let existingPosition = false
      try {
        await powfi.nodeProvider.contracts.getContractsAddressState(positionAddress)
        existingPosition = true
        console.log(`Detected existing position at ${positionAddress}`)
      } catch (e) {
        // Position does not exist
      }

      try {
        const { result } = await powfi.clmm.addLiquidity({
          token0: t0Info.id,
          token1: t1Info.id,
          configIndex,
          tickLower,
          tickUpper,
          amount0,
          amount1,
          slippage: 0n,
          existingPosition
        })

        console.log(`Add liquidity submitted: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('Add liquidity confirmed.')
      } catch (error) {
        console.error('Failed to add liquidity:', error)
      }
    } else if (action === 'info') {
      const priceMinStr = actionArgs[0]
      const priceMaxStr = actionArgs[1]
      const signerAccount = await powfi.signer.getSelectedAccount()

      if (!priceMinStr || !priceMaxStr) {
        try {
          const poolState = await powfi.clmm.getPoolState(poolId)
          const price = TickUtils.sqrtPriceX96ToPrice(poolState.sqrtPriceX96, t0Info.decimals, t1Info.decimals)

          console.log(`\nPool Information:`)
          console.log(`- Token pair:     ${t0Info.symbol}/${t1Info.symbol} (Index ${configIndex})`)
          console.log(`- Pool ID:        ${poolId}`)
          console.log(`- Pool Address:   ${addressFromContractId(poolId)}`)
          console.log(`- Current Price:  ${price.toFixed(10)} ${t1Info.symbol}/${t0Info.symbol}`)
          if (price !== 0) {
            console.log(`- Inverted Price: ${(1 / price).toFixed(10)} ${t0Info.symbol}/${t1Info.symbol}`)
          }
          console.log(`- Pool Tick:      ${poolState.tick}`)
          const poolLiqDecimals = Math.floor((t0Info.decimals + t1Info.decimals) / 2)
          console.log(`- Total Liq:      ${formatAmount(poolState.liquidity, poolLiqDecimals)}`)
          console.log(`- Trading Fee:    ${(Number(poolState.tradingFee) / 10000).toFixed(2)}%`)
          console.log(`- Protocol Fee:   ${poolState.protocolFee}%`)

          const protocolFees = await powfi.clmm.getPoolProtocolFees(poolId)
          if (protocolFees.token0 > 0n || protocolFees.token1 > 0n) {
            console.log(`\nUncollected Protocol Fees:`)
            console.log(`  - ${t0Info.symbol.padEnd(8)}: ${formatAmount(protocolFees.token0, t0Info.decimals)}`)
            console.log(`  - ${t1Info.symbol.padEnd(8)}: ${formatAmount(protocolFees.token1, t1Info.decimals)}`)
          }

          const rewardState = await powfi.clmm.getPoolRewardState(poolId)
          if (rewardState.rewardInfos.some((r) => r.amount > 0n)) {
            console.log(`\nActive Rewards:`)
            const poolTokens = [t0Info, t1Info, rewardState.token2Info]
            for (let i = 0; i < rewardState.rewardInfos.length; i++) {
              const r = rewardState.rewardInfos[i]
              if (r.amount > 0n) {
                const token = poolTokens[i]
                const now = BigInt(Date.now())
                const remaining = r.endTime > now ? r.endTime - now : 0n
                console.log(
                  `  - [Slot ${i}] ${token.symbol.padEnd(8)}: ${formatAmount(r.amount, token.decimals).padStart(12)} (Ends: ${new Date(Number(r.endTime)).toLocaleString()}, ${remaining / 3600000n}h left)`
                )
              }
            }
          }
        } catch (error) {
          console.error(`Failed to fetch pool info. Pool might not exist.`)
        }
      } else {
        const priceMinVal = new Decimal(priceMinStr)
        const priceMaxVal = new Decimal(priceMaxStr)

        const p0 = isReversed ? new Decimal(1).div(priceMaxVal) : priceMinVal
        const p1 = isReversed ? new Decimal(1).div(priceMinVal) : priceMaxVal

        let tickLower = TickUtils.getAlignedTick(p0.toNumber(), t0Info.decimals, t1Info.decimals, config.tickSpacing)
        let tickUpper = TickUtils.getAlignedTick(p1.toNumber(), t0Info.decimals, t1Info.decimals, config.tickSpacing)

        if (tickLower > tickUpper) {
          ;[tickLower, tickUpper] = [tickUpper, tickLower]
        }

        const positionId = powfi.clmm.getPositionId(poolId, signerAccount.address, tickLower, tickUpper)
        console.log(`\nPosition Statistics:`)
        console.log(`- Range:          [${priceMinStr}, ${priceMaxStr}] ${t1Info.symbol}/${t0Info.symbol}`)
        console.log(`- Ticks:          [${tickLower}, ${tickUpper}]`)
        console.log(`- Position ID:    ${positionId}`)
        console.log(`- Position Addr:  ${addressFromContractId(positionId)}`)

        try {
          const pos = Position.at(addressFromContractId(positionId))
          const state = await pos.fetchState()
          const liq = state.fields.liquidity
          const liqDecimals = Math.floor((t0Info.decimals + t1Info.decimals) / 2)
          console.log(`- Liquidity:      ${formatAmount(liq, liqDecimals)}`)

          const poolState = await powfi.clmm.getPoolState(poolId)
          const [amount0, amount1] = ClmmLiquidityUtils.getAmountsForLiquidity(
            poolState.sqrtPriceX96,
            TickUtils.getSqrtRatioAtTick(BigInt(tickLower)),
            TickUtils.getSqrtRatioAtTick(BigInt(tickUpper)),
            liq
          )

          console.log(`- Current values:`)
          console.log(`  - ${t0Info.symbol.padEnd(8)}: ${formatAmount(amount0, t0Info.decimals)}`)
          console.log(`  - ${t1Info.symbol.padEnd(8)}: ${formatAmount(amount1, t1Info.decimals)}`)
        } catch (error) {
          console.log('\nNo active position found in this range for the current signer.')
        }
      }
    } else if (action === 'rewards') {
      const subAction = actionArgs[0]
      const signerAccount = await powfi.signer.getSelectedAccount()

      if (subAction === 'set') {
        const rewardSymbol = actionArgs[1]
        const amountStr = actionArgs[2]
        const durationDays = actionArgs[3]

        if (!rewardSymbol || !amountStr || !durationDays) {
          console.log('Usage: clmm <T1> <T2> <INDEX> rewards set <rewardSymbol> <amount> <durationDays>')
          return
        }

        const rewardToken = await getTokenInfo(rewardSymbol)
        const amount = getAmount(amountStr, rewardToken.decimals)
        const durationSec = BigInt(Number(durationDays) * 24 * 3600 * 1000)
        const now = BigInt(Math.floor(Date.now()))

        console.log(`Setting rewards: ${amountStr} ${rewardSymbol} for ${durationDays} days...`)

        try {
          const result = await powfi.clmm.setRewardParams({
            token0: t0Info.id,
            token1: t1Info.id,
            configIndex,
            rewardToken: rewardToken.id,
            payer: signerAccount.address,
            amount,
            openTime: now,
            endTime: now + durationSec
          })
          console.log(`Set rewards submitted: ${result.txId}`)
          await waitForTx(result.txId)
          console.log('Set rewards confirmed.')
        } catch (error) {
          console.error('Failed to set rewards:', error)
        }
      } else if (subAction === 'extend') {
        const rewardSymbol = actionArgs[1]
        const amountStr = actionArgs[2]

        if (!rewardSymbol || !amountStr) {
          console.log('Usage: clmm <T1> <T2> <INDEX> rewards extend <rewardSymbol> <amount>')
          return
        }

        const rewardToken = await getTokenInfo(rewardSymbol)
        const amount = getAmount(amountStr, rewardToken.decimals)

        const rewardState = await powfi.clmm.getPoolRewardState(poolId)
        const index = rewardToken.id === t0Info.id ? 0 : rewardToken.id === t1Info.id ? 1 : 2
        const rewardInfo = rewardState.rewardInfos[index]
        const now = BigInt(Date.now())

        const timeDelta = rewardInfo.endTime - now
        const additionalTimeMs = (timeDelta * amount) / rewardInfo.amount
        const additionalDays = Number(additionalTimeMs) / (24 * 3600 * 1000)
        console.log(
          `Extending rewards: ${amountStr} ${rewardSymbol}. This will add ~${additionalDays.toFixed(2)} days at the current rate.`
        )

        try {
          const result = await powfi.clmm.extendRewards({
            token0: t0Info.id,
            token1: t1Info.id,
            configIndex,
            rewardToken: rewardToken.id,
            payer: signerAccount.address,
            amount
          })
          console.log(`Extend rewards submitted: ${result.txId}`)
          await waitForTx(result.txId)
          console.log('Extend rewards confirmed.')
        } catch (error) {
          console.error('Failed to extend rewards:', error)
        }
      } else {
        console.log('Unknown rewards action. Use "set" or "extend".')
      }
    } else if (action === 'swap') {
      const symbolIn = actionArgs[0]
      const amountInStr = actionArgs[1]
      const slippageBpsStr = actionArgs[2] || '100' // Default 1% slippage

      if (!symbolIn || !amountInStr) {
        console.log('Usage: clmm <T1> <T2> <INDEX> swap <symbolIn> <amountIn> [slippageBps]')
        console.log('  positive amountIn = exact-in swap  (e.g. 1.5)')
        console.log('  negative amountIn = exact-out swap (e.g. -1.5 means receive exactly 1.5 of output token)')
        return
      }

      const tokenInInfo = await getTokenInfo(symbolIn)
      const zeroForOne = tokenInInfo.id === t0Info.id
      const tokenOutInfo = zeroForOne ? t1Info : t0Info

      // negative amount = exact-out: parse with output token decimals (mirrors sim-swap)
      const amountSpecified = getAmount(
        amountInStr,
        amountInStr.startsWith('-') ? tokenOutInfo.decimals : tokenInInfo.decimals
      )
      const exactOut = amountSpecified < 0n
      const slippage = BigInt(slippageBpsStr)

      if (exactOut) {
        console.log(
          `\nSwapping ${tokenInInfo.symbol} to receive exactly ${amountInStr.slice(1)} ${tokenOutInfo.symbol}...`
        )
      } else {
        console.log(`\nSwapping ${amountInStr} ${tokenInInfo.symbol} for ${tokenOutInfo.symbol}...`)
      }

      try {
        const poolState = await powfi.clmm.getPoolState(poolId)
        const midPrice = TickUtils.sqrtPriceX96ToPrice(poolState.sqrtPriceX96, t0Info.decimals, t1Info.decimals)
        const prePrice = new Decimal(zeroForOne ? midPrice : midPrice === 0 ? 0 : 1 / midPrice)

        // For exact-out, simulate to accurately estimate the required input (needed for token attachment)
        let amountInForTokens: bigint
        if (exactOut) {
          const quote = await powfi.clmm.simulateSwap({
            configIndex,
            token0: t0Info.id,
            token1: t1Info.id,
            zeroForOne,
            amount: amountSpecified
          })
          const rawEstimatedIn = PoolUtils.offlineSwap(quote, amountSpecified, quote.sqrtPriceX96)
          const estimatedIn = rawEstimatedIn < 0n ? -rawEstimatedIn : rawEstimatedIn
          // Apply slippage buffer so the contract has enough tokens attached
          amountInForTokens = estimatedIn + (estimatedIn * slippage) / 10000n
        } else {
          amountInForTokens = amountSpecified
        }

        const result = await powfi.clmm.swap({
          token0: tokenInInfo.id,
          token1: tokenOutInfo.id,
          amount: amountSpecified,
          amountIn: amountInForTokens,
          slippage,
          routePlan: [configIndex]
        })

        console.log(`Swap submitted: ${result.txId}`)
        console.log('Waiting for confirmation...')

        await waitForTx(result.txId)
        await showSwapStats('clmm', result.txId, poolId, tokenInInfo, tokenOutInfo, prePrice, {
          zeroForOne,
          t0: t0Info,
          t1: t1Info,
          poolState
        })
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        const traceMsg = (error as any)?.trace?.message || ''
        if (msg.includes('Error Code: 501') || traceMsg.includes('Error Code: 501')) {
          console.error('\nError: Slippage too high. The price moved more than the allowed limit.')
          console.error('Try increasing the [slippageBps] (e.g. 500 for 5%).')
        } else {
          console.error('Failed to swap:', error)
        }
      }
    } else if (action === 'sim-swap') {
      const symbolIn = actionArgs[0]
      const amountInStr = actionArgs[1]

      if (!symbolIn || !amountInStr) {
        console.log('Usage: clmm <T1> <T2> <INDEX> sim-swap <symbolIn> <amountIn>')
        return
      }

      const tokenInInfo = await getTokenInfo(symbolIn)
      const zeroForOne = tokenInInfo.id === t0Info.id
      const tokenOutInfo = zeroForOne ? t1Info : t0Info
      const amountSpecified = getAmount(
        amountInStr,
        amountInStr.startsWith('-') ? tokenOutInfo.decimals : tokenInInfo.decimals
      )
      const exactOut = amountSpecified < 0n

      console.log(
        exactOut
          ? `\nSimulating exact-out swap: receive ${amountInStr.slice(1)} ${tokenOutInfo.symbol}, paying ${tokenInInfo.symbol}`
          : `\nSimulating swap: ${amountInStr} ${tokenInInfo.symbol} → ${tokenOutInfo.symbol}`
      )
      try {
        // 1. Online simulate: fetch liquidity distribution from chain
        const quote = await powfi.clmm.simulateSwap({
          configIndex,
          token0: t0Info.id,
          token1: t1Info.id,
          zeroForOne,
          amount: amountSpecified
        })

        const sqrt0 = quote.sqrtPriceX96
        const sqrt1 = quote.rows.at(quote.rows.length - 1)?.sqrtPriceX96!
        const prePrice = new Decimal(TickUtils.sqrtPriceX96ToPrice(sqrt0, t0Info.decimals, t1Info.decimals))
        const finalPrice = new Decimal(TickUtils.sqrtPriceX96ToPrice(sqrt1, t0Info.decimals, t1Info.decimals))

        // 2. Offline swap: compute the other side without any further on-chain call
        const rawOther = PoolUtils.offlineSwap(quote, amountSpecified, sqrt0)
        const absOther = rawOther < 0n ? -rawOther : rawOther
        const absSpecified = amountSpecified < 0n ? -amountSpecified : amountSpecified

        const amountIn = exactOut ? absOther : absSpecified
        const amountOut = exactOut ? absSpecified : absOther

        const isT0 = tokenInInfo.id === t0Info.id
        const baseP = isT0 ? prePrice : prePrice.isZero() ? new Decimal(0) : new Decimal(1).div(prePrice)
        const finalP = isT0 ? finalPrice : finalPrice.isZero() ? new Decimal(0) : new Decimal(1).div(finalPrice)
        const priceDiff = finalP.sub(baseP)
        const priceImpact = baseP.isZero() ? new Decimal(0) : priceDiff.div(baseP).mul(100).abs()

        showSimStats('clmm', tokenInInfo, tokenOutInfo, amountIn, amountOut, priceImpact, {
          t0: t0Info,
          t1: t1Info,
          prePrice,
          finalPrice,
          clmmQuote: quote
        })
      } catch (error) {
        console.error('Failed to simulate swap:', error)
      }
    } else if (action === 'swap-to') {
      const targetPriceStr = actionArgs[0]

      if (!targetPriceStr) {
        console.log('Usage: clmm <T1> <T2> <INDEX> swap-to <targetPrice>')
        console.log('  Swaps T1 or T2 until the pool price reaches <targetPrice> (expressed as T2/T1).')
        console.log('  Direction is inferred automatically from current vs target price.')
        return
      }

      const rawTargetPrice = new Decimal(targetPriceStr)
      const targetTick = TickUtils.getAlignedTick(
        rawTargetPrice.toNumber(),
        t0Info.decimals,
        t1Info.decimals,
        config.tickSpacing
      )
      const targetSqrtPriceX96 = TickUtils.getSqrtRatioAtTick(targetTick)

      try {
        const poolState = await powfi.clmm.getPoolState(poolId)
        const currentSqrtPriceX96 = poolState.sqrtPriceX96

        const zeroForOne = targetSqrtPriceX96 < currentSqrtPriceX96
        const tokenInInfo = zeroForOne ? t0Info : t1Info
        const tokenOutInfo = zeroForOne ? t1Info : t0Info

        const midPrice = TickUtils.sqrtPriceX96ToPrice(currentSqrtPriceX96, t0Info.decimals, t1Info.decimals)
        const currentPrice = midPrice // already t1/t0

        if (targetSqrtPriceX96 === currentSqrtPriceX96) {
          console.error('Target price equals current price — nothing to do.')
          return
        }

        console.log(
          `\nSwap-to: selling ${tokenInInfo.symbol} until price reaches ${targetPriceStr} ${t1Info.symbol}/${t0Info.symbol}`
        )
        console.log(`  Direction         : ${zeroForOne ? 'zeroForOne (sell t0)' : 'oneForZero (sell t1)'}`)
        console.log(`  Current price     : ${currentPrice.toFixed(6)} ${t1Info.symbol}/${t0Info.symbol}`)
        console.log(`  Target tick       : ${targetTick}`)

        const signerAccount = await powfi.signer.getSelectedAccount()
        const balanceInfo = await powfi.nodeProvider.addresses.getAddressesAddressBalance(signerAccount.address)
        const amountInMax =
          tokenInInfo.id === ALPH_TOKEN_ID
            ? BigInt(balanceInfo.balance) > 1000000000000000000n
              ? BigInt(balanceInfo.balance) - 1000000000000000000n
              : 0n
            : BigInt(balanceInfo.tokenBalances?.find((t) => t.id === tokenInInfo.id)?.amount ?? '0')

        if (amountInMax === 0n) {
          console.error(`No ${tokenInInfo.symbol} balance available.`)
          return
        }

        console.log(
          `  Max input attached: ${formatAmount(amountInMax, tokenInInfo.decimals)} ${tokenInInfo.symbol} (full balance)`
        )

        const result = await powfi.clmm.swapTo({
          tokenIn: tokenInInfo.id,
          tokenOut: tokenOutInfo.id,
          configIndex,
          targetSqrtPriceX96,
          amountInMax
        })

        console.log(`\nSwap-to submitted: ${result.txId}`)
        console.log('Waiting for confirmation...')

        await waitForTx(result.txId)
        await showSwapStats('clmm', result.txId, poolId, tokenInInfo, tokenOutInfo, new Decimal(currentPrice), {
          zeroForOne,
          t0: t0Info,
          t1: t1Info,
          poolState
        })
      } catch (error: any) {
        if (error?.message?.includes('Error Code: 501') || error?.trace?.message?.includes('Error Code: 501')) {
          console.error('\nError: Price limit violated. The target price may already be past the current price.')
        } else {
          console.error('Failed to swap-to:', error)
        }
      }
    } else if (action === 'rm') {
      const priceMinStr = actionArgs[0]
      const priceMaxStr = actionArgs[1]
      const percentStr = actionArgs[2]

      if (!priceMinStr || !priceMaxStr || !percentStr) {
        console.log('Usage: clmm <T1> <T2> <INDEX> rm <priceMin> <priceMax> <percent>')
        return
      }

      const pVal0 = new Decimal(priceMinStr)
      const pVal1 = new Decimal(priceMaxStr)

      const p0 = isReversed ? new Decimal(1).div(pVal1) : pVal0
      const p1 = isReversed ? new Decimal(1).div(pVal0) : pVal1

      let tickLower = TickUtils.getAlignedTick(p0.toNumber(), t0Info.decimals, t1Info.decimals, config.tickSpacing)
      let tickUpper = TickUtils.getAlignedTick(p1.toNumber(), t0Info.decimals, t1Info.decimals, config.tickSpacing)

      if (tickLower > tickUpper) {
        ;[tickLower, tickUpper] = [tickUpper, tickLower]
      }

      const poolId = powfi.clmm.getPoolId(t0Info.id, t1Info.id, configIndex)
      const signerAccount = await powfi.signer.getSelectedAccount()
      const positionId = powfi.clmm.getPositionId(poolId, signerAccount.address, tickLower, tickUpper)

      try {
        const posContract = Position.at(addressFromContractId(positionId))
        const posState = await posContract.fetchState()
        const currentLiquidity = posState.fields.liquidity
        const percent = BigInt(percentStr)
        const liquidity = (currentLiquidity * percent) / 100n
        const liqDecimals = Math.floor((t0Info.decimals + t1Info.decimals) / 2)

        if (liquidity === 0n) {
          console.error('Percent result in zero liquidity.')
          return
        }

        console.log(
          `Removing ${percentStr}% of position liquidity (amount: ${formatAmount(liquidity, liqDecimals)}) from [${tickLower}, ${tickUpper}]...`
        )

        const result = await powfi.clmm.removeLiquidity({
          token0: t0Info.id,
          token1: t1Info.id,
          configIndex,
          owner: signerAccount.address,
          tickLower: BigInt(tickLower),
          tickUpper: BigInt(tickUpper),
          liquidity,
          base: 'token0',
          baseAmount: 0n,
          otherAmountMax: 0n
        })
        console.log(`Remove liquidity submitted: ${result.result.txId}`)
        await waitForTx(result.result.txId)
        console.log('Remove liquidity confirmed.')
      } catch (error) {
        console.error('Failed to remove liquidity: Position might not exist or percent is invalid.', error)
      }
    } else if (action === 'collect-protocol') {
      const collectTokenSymbol = actionArgs[0]
      if (!collectTokenSymbol) {
        console.log(`Usage: clmm <T1> <T2> <INDEX> collect-protocol <tokenSymbol>`)
        return
      }

      const collectToken = await getTokenInfo(collectTokenSymbol)
      console.log(
        `Collecting protocol fees for ${symbolA}/${symbolB} (Config ${configIndex}) - Token: ${collectToken.symbol}...`
      )
      try {
        const result = await powfi.clmm.collectProtocolFees({
          token0: t0Info.id,
          token1: t1Info.id,
          configIndex: config.configIndex,
          tokenId: collectToken.id
        })

        console.log(`Collect protocol fees submitted: ${result.txId}`)
        console.log('Waiting for confirmation...')

        // Wait for confirmation
        await waitForTx(result.txId)

        const eventsData = await powfi.nodeProvider.events.getEventsTxIdTxid(result.txId)
        const poolAddress = powfi.clmm.getPoolAddress(t0Info.id, t1Info.id, config.configIndex)

        // Print debug events emitted from the pool before CollectProtocol
        const poolEvents = eventsData.events.filter((e) => e.contractAddress === poolAddress)

        // CollectProtocol is the last pool event
        const collectEvent = poolEvents.at(-1)

        console.log('\nProtocol Fee Collection Results:')

        if (collectEvent) {
          const fields = collectEvent.fields as { type: string; value: string }[]
          const sender = fields[0].value
          const recipient = fields[1].value
          const amount0 = BigInt(fields[2].value)
          const amount1 = BigInt(fields[3].value)

          console.log(`- Sender:         ${sender}`)
          console.log(`- Recipient:      ${recipient}`)
          console.log(`- ${t0Info.symbol.padEnd(12)}: ${formatAmount(amount0, t0Info.decimals)}`)
          console.log(`- ${t1Info.symbol.padEnd(12)}: ${formatAmount(amount1, t1Info.decimals)}`)
        } else {
          console.log('Fees collected but info could not be parsed from events.')
        }
      } catch (error) {
        console.error('Failed to collect protocol fees:', error)
      }
    } else if (action === 'protocol-swap') {
      console.log(`Swapping collected protocol fees for ${symbolA}/${symbolB} (Config ${configIndex}) to ALPH...`)
      try {
        console.log(`Swapping ${t1Info.symbol} for ALPH...`)
        const result = await powfi.staking.swapProtocolFeesCLMM(t1Info.id, config.configIndex)
        console.log(`Protocol swap submitted: ${result.txId}`)
        await waitForTx(result.txId)

        const eventsData = await powfi.nodeProvider.events.getEventsTxIdTxid(result.txId)
        const poolAddress = powfi.clmm.getPoolAddress(t0Info.id, t1Info.id, config.configIndex)

        // Swap event has eventIndex === 3
        const swapEvent = eventsData.events.find((e) => e.contractAddress === poolAddress && e.eventIndex === 3)

        if (swapEvent) {
          const fields = swapEvent.fields as { type: string; value: string }[]
          let poolDelta0 = BigInt(fields[2].value)
          if (poolDelta0 > 2n ** 255n) poolDelta0 -= 2n ** 256n
          let poolDelta1 = BigInt(fields[3].value)
          if (poolDelta1 > 2n ** 255n) poolDelta1 -= 2n ** 256n

          const userDelta0 = -poolDelta0
          const userDelta1 = -poolDelta1

          console.log('\nProtocol Swap Results:')
          console.log(
            `- ${t0Info.symbol.padEnd(12)}: ${userDelta0 > 0n ? '+' : ''}${formatAmount(userDelta0, t0Info.decimals)}`
          )
          console.log(
            `- ${t1Info.symbol.padEnd(12)}: ${userDelta1 > 0n ? '+' : ''}${formatAmount(userDelta1, t1Info.decimals)}`
          )
        } else {
          console.log('Protocol swap confirmed.')
        }
      } catch (error) {
        console.error('Failed to swap protocol fees:', error)
      }
    } else if (action === 'migrate-account') {
      const newBytecode = actionArgs[0]
      if (newBytecode === undefined) {
        console.log('Usage: clmm migrate-account <newBytecode>')
        return
      }
      try {
        const result = await powfi.clmm.migrateDexAccount(newBytecode)
        console.log(`Account migration submitted: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('Account migration confirmed.')
      } catch (error) {
        console.error('Failed to migrate account:', error)
      }
    } else if (action === 'migrate-factory') {
      const newBytecode = actionArgs[0]
      if (newBytecode === undefined) {
        console.log('Usage: clmm migrate-factory <newBytecode>')
        return
      }
      try {
        const result = await powfi.clmm.migrateFactory(newBytecode)
        console.log(`Factory migration submitted: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('Factory migration confirmed.')
      } catch (error) {
        console.error('Failed to migrate factory:', error)
      }
    } else {
      console.log(`Unknown action ${action} for module clmm`)
    }
  } else if (command === 'cpmm') {
    const cpmmActionOrTokenA = args[1]

    if (cpmmActionOrTokenA === 'set-fee-collector') {
      console.log(`Setting CPMM fee collector...`)
      try {
        const result = await powfi.cpmm.setFeeCollector()
        console.log(`Set fee collector submitted: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('Set fee collector confirmed.')
      } catch (error) {
        console.error('Failed to set fee collector:', error)
      }
      return
    }

    const symbolA = cpmmActionOrTokenA
    const symbolB = args[2]
    const action = args[3]
    const actionArgs = args.slice(4)

    if (!symbolA || !symbolB || !action) {
      console.log('Usage: npx ts-node src/cli.ts cpmm <symbolA> <symbolB> <action> [args]')
      console.log('Global Actions:')
      console.log('  cpmm set-fee-collector')
      console.log('Pool Actions:')
      console.log('  create <amountA> <amountB>  # Create pair and add initial liquidity')
      console.log('  add <amountA> [amountB]     # Add liquidity (if one is 0, the other is calculated)')
      console.log('  rm <percentage> [slippageBps]      # Remove percentage of LP tokens')
      console.log('  swap <symbolIn> <amountIn>  # Swap tokens (positive amountIn = exact-in, negative = exact-out)')
      console.log('  sim-swap <symbolIn> <amountIn> # Simulation of swap')
      console.log('  info                        # Show reserves and price')
      console.log('  collect-protocol            # Collect protocol fees')
      console.log('  protocol-swap               # Swap collected fees for ALPH')
      console.log('  protocol-burn               # Burn LP fees for underlying tokens')
      console.log('  protocol-transfer <symbol>  # Transfer fees from LP vault to destination vault/collector')
      console.log('  migrate-factory <newBytecode>')
      console.log('  migrate-pool <newBytecode>')
      console.log('  migrate-account <newBytecode>')
      return
    }

    console.log(`Fetching token info for ${symbolA} and ${symbolB}...`)
    const [tokenA, tokenB] = await Promise.all([getTokenInfo(symbolA), getTokenInfo(symbolB)])

    if (action === 'create') {
      const amountAStr = actionArgs[0]
      const amountBStr = actionArgs[1]

      if (!amountAStr || !amountBStr) {
        console.log('Usage: cpmm <T1> <T2> create <amountA> <amountB>')
        return
      }

      const amountA = getAmount(amountAStr, tokenA.decimals)
      const amountB = getAmount(amountBStr, tokenB.decimals)

      const signerAccount = await powfi.signer.getSelectedAccount()
      const exists = await powfi.cpmm.poolExists(tokenA.id, tokenB.id)
      if (exists) {
        console.log(`Pool already exists for ${symbolA}/${symbolB}`)
        return
      }
      try {
        const { result, poolId } = await powfi.cpmm.createPool({
          tokenAId: tokenA.id,
          tokenBId: tokenB.id,
          sender: signerAccount.address,
          initialLiquidity: {
            tokenAAmount: amountA,
            tokenBAmount: amountB
          }
        })
        console.log(`CPMM pool created: ${poolId}`)
        console.log(`Transaction ID: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('CPMM pool creation confirmed.')
      } catch (error) {
        console.error('Failed to create CPMM pool:', error)
      }
    } else if (action === 'add') {
      const amountAStr = actionArgs[0]
      const amountBStr = actionArgs[1]
      const slippageBpsStr = actionArgs[2] || '100'

      if (!amountAStr && !amountBStr) {
        console.log('Usage: cpmm <T1> <T2> add <amountA> [amountB] [slippageBps]')
        return
      }

      const signerAccount = await powfi.signer.getSelectedAccount()
      try {
        const poolState = await powfi.cpmm.getPoolState(tokenA.id, tokenB.id)

        let amountA = getAmount(amountAStr, tokenA.decimals)
        let amountB = getAmount(amountBStr, tokenB.decimals)
        const slippageBps = BigInt(slippageBpsStr)

        const isTokenA0 = tokenA.id === poolState.token0Info.id
        const [reserveA, reserveB] = isTokenA0
          ? [poolState.reserve0, poolState.reserve1]
          : [poolState.reserve1, poolState.reserve0]

        if (reserveA > 0n && reserveB > 0n) {
          if (amountA > 0n && amountB === 0n) {
            amountB = (amountA * reserveB) / reserveA
            console.log(`Optimal ${tokenB.symbol} amount: ${formatAmount(amountB, tokenB.decimals)}`)
          } else if (amountB > 0n && amountA === 0n) {
            amountA = (amountB * reserveA) / reserveB
            console.log(`Optimal ${tokenA.symbol} amount: ${formatAmount(amountA, tokenA.decimals)}`)
          } else if (amountA > 0n && amountB > 0n) {
            // Balance both provided amounts
            const optimalB = (amountA * reserveB) / reserveA
            if (optimalB <= amountB) {
              amountB = optimalB
            } else {
              amountA = (amountB * reserveA) / reserveB
            }
          }
        }

        if (amountA === 0n || amountB === 0n) {
          console.log(
            'Error: Both amounts must be greater than 0 (or providing one will calculate the other for existing pools)'
          )
          return
        }

        console.log(
          `Adding liquidity (balanced): ${formatAmount(amountA, tokenA.decimals)} ${tokenA.symbol} and ${formatAmount(amountB, tokenB.decimals)} ${tokenB.symbol}`
        )

        const result = await powfi.cpmm.addLiquidity({
          poolState,
          tokenAId: tokenA.id,
          tokenBId: tokenB.id,
          amountA,
          amountB,
          slippageBps,
          sender: signerAccount.address
        })
        console.log(`Add liquidity submitted: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('Add liquidity confirmed.')
      } catch (error) {
        console.error('Failed to add liquidity:', error)
      }
    } else if (action === 'rm') {
      const percentageStr = actionArgs[0]
      const slippageBpsStr = actionArgs[1] || '100'

      if (!percentageStr) {
        console.log('Usage: cpmm <T1> <T2> rm <percentage> [slippageBps]')
        return
      }

      const signerAccount = await powfi.signer.getSelectedAccount()
      const slippageBps = BigInt(slippageBpsStr)

      try {
        const poolState = await powfi.cpmm.getPoolState(tokenA.id, tokenB.id)
        const lpTokenId = poolState.poolId

        const balance = await powfi.nodeProvider.addresses.getAddressesAddressBalance(signerAccount.address)
        const tokenBalance = balance.tokenBalances?.find((t) => t.id === lpTokenId)
        const userLpBalance = tokenBalance ? BigInt(tokenBalance.amount) : 0n

        if (userLpBalance === 0n) {
          console.error(`You have no LP tokens for pool ${symbolA}/${symbolB}`)
          return
        }

        const percentage = BigInt(percentageStr)
        const liquidity = (userLpBalance * percentage) / 100n
        const lpDecimals = Math.floor((tokenA.decimals + tokenB.decimals) / 2)

        if (liquidity === 0n) {
          console.error('Resulting liquidity to remove is zero.')
          return
        }

        console.log(
          `Removing ${percentageStr}% of your LP tokens (${formatAmount(liquidity, lpDecimals)}) from ${symbolA}/${symbolB}...`
        )
        const result = await powfi.cpmm.removeLiquidity({
          poolState,
          liquidity,
          slippageBps,
          sender: signerAccount.address
        })
        console.log(`Remove liquidity submitted: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('Remove liquidity confirmed.')
      } catch (error) {
        console.error('Failed to remove liquidity:', error)
      }
    } else if (action === 'swap') {
      const symbolIn = actionArgs[0]
      const amountInStr = actionArgs[1]
      const slippageBpsStr = actionArgs[2] || '100'

      if (!symbolIn || !amountInStr) {
        console.log('Usage: cpmm <T1> <T2> swap <symbolIn> <amountIn> [slippageBps]')
        return
      }

      const tokenIn = await getTokenInfo(symbolIn)
      const tokenOut = tokenIn.id === tokenA.id ? tokenB : tokenA
      const amount = getAmount(amountInStr, amountInStr.startsWith('-') ? tokenOut.decimals : tokenIn.decimals)
      const slippageBps = BigInt(slippageBpsStr)

      const signerAccount = await powfi.signer.getSelectedAccount()
      try {
        const poolState = await powfi.cpmm.getPoolState(tokenA.id, tokenB.id)
        const prePrice = new Decimal(poolState.reserve1.toString())
          .div(new Decimal(poolState.reserve0.toString()))
          .mul(new Decimal(10).pow(poolState.token0Info.decimals - poolState.token1Info.decimals))

        const result = await powfi.cpmm.swap({
          tokenInId: tokenIn.id,
          tokenOutId: tokenOut.id,
          amountIn: amount > 0n ? amount : undefined,
          amountOut: amount < 0n ? -amount : undefined,
          slippageBps,
          sender: signerAccount.address
        })
        console.log(`Swap submitted: ${result.txId}`)
        console.log('Waiting for confirmation...')

        await waitForTx(result.txId)
        await showSwapStats('cpmm', result.txId, poolState.poolId, tokenIn, tokenOut, prePrice, {
          t0: poolState.token0Info,
          t1: poolState.token1Info,
          poolState
        })
      } catch (error) {
        console.error('Failed to swap:', error)
      }
    } else if (action === 'sim-swap') {
      const symbolIn = actionArgs[0]
      const amountInStr = actionArgs[1]

      if (!symbolIn || !amountInStr) {
        console.log('Usage: cpmm <T1> <T2> sim-swap <symbolIn> <amountIn>')
        return
      }

      const tokenIn = await getTokenInfo(symbolIn)
      const tokenOut = tokenIn.id === tokenA.id ? tokenB : tokenA
      const amount = getAmount(amountInStr, amountInStr.startsWith('-') ? tokenOut.decimals : tokenIn.decimals)

      try {
        const quote = await powfi.cpmm.simSwap({
          tokenInId: tokenIn.id,
          tokenOutId: tokenOut.id,
          amountIn: amount > 0n ? amount : undefined,
          amountOut: amount < 0n ? -amount : undefined,
          slippageBps: 100n,
          sender: ''
        })

        const poolState = await powfi.cpmm.getPoolState(tokenA.id, tokenB.id)
        const { token0Info: t0, token1Info: t1 } = poolState

        const prePrice = new Decimal(poolState.reserve1.toString())
          .div(new Decimal(poolState.reserve0.toString()))
          .mul(new Decimal(10).pow(t0.decimals - t1.decimals))

        const amount0In = tokenIn.id === t0.id ? quote.tokenInAmount : 0n
        const amount1In = tokenIn.id === t1.id ? quote.tokenInAmount : 0n
        const amount0Out = tokenIn.id === t1.id ? quote.tokenOutAmount : 0n
        const amount1Out = tokenIn.id === t0.id ? quote.tokenOutAmount : 0n

        const postReserve0 = BigInt(poolState.reserve0) + amount0In - amount0Out
        const postReserve1 = BigInt(poolState.reserve1) + amount1In - amount1Out
        const finalPrice = new Decimal(postReserve1.toString())
          .div(new Decimal(postReserve0.toString()))
          .mul(new Decimal(10).pow(t0.decimals - t1.decimals))

        showSimStats('cpmm', tokenIn, tokenOut, quote.tokenInAmount, quote.tokenOutAmount, quote.priceImpact, {
          t0,
          t1,
          prePrice,
          finalPrice
        })
      } catch (error) {
        console.error('Simulation failed:', error)
      }
    } else if (action === 'swap-to') {
      const targetPriceStr = actionArgs[0]
      const slippageBpsStr = actionArgs[1] || '50'

      if (!targetPriceStr) {
        console.log('Usage: cpmm <T1> <T2> swap-to <targetPrice> [slippageBps]')
        return
      }

      const targetPrice = new Decimal(targetPriceStr)
      const slippageBps = BigInt(slippageBpsStr)
      const signerAccount = await powfi.signer.getSelectedAccount()

      try {
        const poolState = await powfi.cpmm.getPoolState(tokenA.id, tokenB.id)
        const prePrice = new Decimal(poolState.reserve1.toString())
          .div(new Decimal(poolState.reserve0.toString()))
          .mul(new Decimal(10).pow(poolState.token0Info.decimals - poolState.token1Info.decimals))

        const result = await powfi.cpmm.swapTo({
          tokenA: tokenA.id,
          tokenB: tokenB.id,
          targetPrice: Number(targetPrice.toString()),
          sender: signerAccount.address,
          slippageBps
        })
        console.log(`Swap-to submitted: ${result.txId}`)
        console.log('Waiting for confirmation...')

        await waitForTx(result.txId)

        // For swapTo, we need to find tokenIn from events
        const events = await powfi.nodeProvider.events.getEventsTxIdTxid(result.txId)
        const poolAddress = addressFromContractId(poolState.poolId)
        const swapEvent = events.events.find((e) => e.contractAddress === poolAddress && e.eventIndex === 2)
        if (swapEvent) {
          const fields = swapEvent.fields as any[]
          const amount0In = BigInt(fields[1].value)
          const isToken0In = amount0In > 0n
          const tokenIn = isToken0In ? poolState.token0Info : poolState.token1Info
          const tokenOut = isToken0In ? poolState.token1Info : poolState.token0Info

          await showSwapStats('cpmm', result.txId, poolState.poolId, tokenIn, tokenOut, prePrice, {
            t0: poolState.token0Info,
            t1: poolState.token1Info,
            poolState
          })
        } else {
          console.log('Swap-to completed but info could not be parsed from events.')
        }
      } catch (error) {
        console.error('Swap-to failed:', error)
      }
    } else if (action === 'info') {
      try {
        const state = await powfi.cpmm.getPoolState(tokenA.id, tokenB.id)
        const price = new Decimal(state.reserve1.toString())
          .div(new Decimal(state.reserve0.toString()))
          .mul(new Decimal(10).pow(state.token0Info.decimals - state.token1Info.decimals))

        console.log(`CPMM Pool: ${state.token0Info.symbol}/${state.token1Info.symbol}`)
        console.log(`Address: ${addressFromContractId(state.poolId)}`)
        console.log(`Reserve 0: ${formatAmount(state.reserve0, state.token0Info.decimals)} ${state.token0Info.symbol}`)
        console.log(`Reserve 1: ${formatAmount(state.reserve1, state.token1Info.decimals)} ${state.token1Info.symbol}`)
        console.log(`Price: ${price.toFixed(10)} ${state.token1Info.symbol}/${state.token0Info.symbol}`)

        const signerAccount = await powfi.signer.getSelectedAccount()
        const lpTokenId = state.poolId
        const balance = await powfi.nodeProvider.addresses.getAddressesAddressBalance(signerAccount.address)
        const tokenBalance = balance.tokenBalances?.find((t) => t.id === lpTokenId)
        const userLpBalance = tokenBalance ? BigInt(tokenBalance.amount) : 0n
        const lpDecimals = Math.floor((state.token0Info.decimals + state.token1Info.decimals) / 2)
        console.log(`My LP Tokens: ${formatAmount(userLpBalance, lpDecimals)}`)
      } catch (error) {
        console.error('Failed to fetch pool info:', error)
      }
    } else if (action === 'collect-protocol') {
      console.log(`Collecting protocol fees for ${symbolA}/${symbolB}...`)
      try {
        const poolState = await powfi.cpmm.getPoolState(tokenA.id, tokenB.id)
        const protocolFees = await powfi.cpmm.getPoolProtocolFees(addressFromContractId(poolState.poolId))
        const { token0Info: t0, token1Info: t1, reserve0, reserve1, totalSupply } = poolState

        const amount0 = (protocolFees * reserve0) / totalSupply
        const amount1 = (protocolFees * reserve1) / totalSupply

        const result = await powfi.cpmm.collectProtocolFees({
          tokenAId: tokenA.id,
          tokenBId: tokenB.id
        })
        console.log(`Collect protocol fees submitted: ${result.txId}`)
        console.log('Waiting for confirmation...')
        await waitForTx(result.txId)

        console.log('\nProtocol Fee Collection Results:')
        console.log(`- Collected ${t0.symbol.padEnd(7)}: ${formatAmount(amount0, t0.decimals)}`)
        console.log(`- Collected ${t1.symbol.padEnd(7)}: ${formatAmount(amount1, t1.decimals)}`)
      } catch (error) {
        console.error('Failed to collect protocol fees from CPMM pool:', error)
      }
    } else if (action === 'protocol-swap') {
      try {
        const [id0, id1] = sortTokens(tokenA.id, tokenB.id)
        const cpmmConfig = powfi.cpmm.getCpmmConfig()
        const lpTokenId = subContractId(cpmmConfig.factoryId, id0 + id1, cpmmConfig.groupIndex)

        const t1 = id1 === tokenA.id ? tokenA : tokenB
        console.log(`Swapping ${t1.symbol} for ALPH...`)
        const result = await powfi.staking.swapProtocolFeesCPMM(lpTokenId, t1.id)
        console.log(`Protocol fee swap submitted: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('Protocol fee swap confirmed.')
      } catch (error) {
        console.error('Failed to swap protocol fees:', error)
      }
    } else if (action === 'protocol-burn') {
      try {
        const [id0, id1] = sortTokens(tokenA.id, tokenB.id)
        const result = await powfi.staking.burnProtocolFeesCPMM(id0, id1)
        console.log(`Protocol fee burn submitted: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('Protocol fee burn confirmed.')
      } catch (error) {
        console.error('Failed to burn protocol fees:', error)
      }
    } else if (action === 'protocol-transfer') {
      const symbolTransfer = actionArgs[0]
      if (!symbolTransfer) {
        console.log('Usage: cpmm <T1> <T2> protocol-transfer <symbol>')
        return
      }
      try {
        const [id0, id1] = sortTokens(tokenA.id, tokenB.id)
        const cpmmConfig = powfi.cpmm.getCpmmConfig()
        const lpTokenId = subContractId(cpmmConfig.factoryId, id0 + id1, cpmmConfig.groupIndex)

        const tokenTransfer = await getTokenInfo(symbolTransfer)
        const result =
          tokenTransfer.id === ALPH_TOKEN_ID
            ? await powfi.staking.transferProtocolFeesALPH(lpTokenId)
            : await powfi.staking.transferProtocolFees(lpTokenId, tokenTransfer.id)

        console.log(`Protocol fee transfer submitted: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('Protocol fee transfer confirmed.')
      } catch (error) {
        console.error('Failed to transfer protocol fees:', error)
      }
    } else if (action === 'migrate-factory') {
      const newBytecode = actionArgs[0]
      if (newBytecode === undefined) {
        console.log('Usage: cpmm migrate-factory <newBytecode>')
        return
      }
      try {
        const result = await powfi.cpmm.migrateFactory(newBytecode)
        console.log(`Factory migration submitted: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('Factory migration confirmed.')
      } catch (error) {
        console.error('Failed to migrate factory:', error)
      }
    } else if (action === 'migrate-pool') {
      const newBytecode = actionArgs[0]
      if (newBytecode === undefined) {
        console.log('Usage: cpmm <T1> <T2> migrate-pool <newBytecode>')
        return
      }
      try {
        const result = await powfi.cpmm.migratePool(tokenA.id, tokenB.id, newBytecode)
        console.log(`Pool migration submitted: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('Pool migration confirmed.')
      } catch (error) {
        console.error('Failed to migrate pool:', error)
      }
    } else {
      console.log(`Unknown action ${action} for module cpmm`)
    }
  } else if (command === 'stake') {
    const action = args[1]
    const actionArgs = args.slice(2)

    if (!action) {
      console.log('Usage: npx ts-node src/cli.ts stake <action> [args...]')
      console.log('Actions:')
      console.log('  deposit <amountALPH>       # Stake ALPH to get xALPH')
      console.log('  donate <amountALPH>        # Donate ALPH as reward to all xALPH holders')
      console.log('  info                       # Show xALPH price and my holdings')
      return
    }

    const xAlphId = powfi.staking.getConfig().xAlphTokenId

    if (action === 'deposit') {
      const amountStr = actionArgs[0]
      if (!amountStr) {
        console.log('Usage: stake deposit <amountALPH>')
        return
      }
      const amount = getAmount(amountStr, 18)
      console.log(`Staking ${amountStr} ALPH to get xALPH...`)
      try {
        const result = await powfi.staking.stakeAlph(amount)
        console.log(`Deposit submitted: ${result.txId}`)
        console.log('Waiting for confirmation...')

        await waitForTx(result.txId)

        const events = await powfi.nodeProvider.events.getEventsTxIdTxid(result.txId)
        const xAlphAddress = addressFromContractId(xAlphId)
        // XAlphToken emits Staked(to, alphAmount, xAlphAmount) as event index 0
        const stakedEvent = events.events.find((e) => e.contractAddress === xAlphAddress && e.eventIndex === 0)

        if (stakedEvent) {
          const fields = stakedEvent.fields as any[]
          const alphPaid = BigInt(fields[1].value)
          const xAlphMinted = BigInt(fields[2].value)
          console.log('\nStake Results:')
          console.log(`- ALPH paid:    ${formatAmount(alphPaid, 18)} ALPH`)
          console.log(`- xALPH minted: ${formatAmount(xAlphMinted, 18)} xALPH`)
        } else {
          console.log('Stake confirmed.')
        }
      } catch (error) {
        console.error('Failed to deposit:', error)
      }
    } else if (action === 'donate') {
      const amountStr = actionArgs[0]
      if (!amountStr) {
        console.log('Usage: stake donate <amountALPH>')
        return
      }
      const amount = getAmount(amountStr, 18)
      console.log(`Donating ${amountStr} ALPH as reward to all xALPH holders...`)
      try {
        const result = await powfi.staking.donateReward(amount)
        console.log(`Donate submitted: ${result.txId}`)
        console.log('Waiting for confirmation...')

        await waitForTx(result.txId)

        const events = await powfi.nodeProvider.events.getEventsTxIdTxid(result.txId)
        const xAlphAddress = addressFromContractId(xAlphId)
        // XAlphToken emits RewardDeposited(from, amount) as event index 3
        const rewardEvent = events.events.find((e) => e.contractAddress === xAlphAddress && e.eventIndex === 3)

        if (rewardEvent) {
          const fields = rewardEvent.fields as any[]
          const donated = BigInt(fields[1].value)
          console.log(`\nDonated ${formatAmount(donated, 18)} ALPH to xALPH reward pool.`)
        } else {
          console.log('Donation confirmed.')
        }
      } catch (error) {
        console.error('Failed to donate:', error)
      }
    } else if (action === 'info') {
      try {
        const signerAccount = await powfi.signer.getSelectedAccount()
        const [tokenState, balanceInfo] = await Promise.all([
          powfi.staking.getXAlphTokenState(),
          powfi.nodeProvider.addresses.getAddressesAddressBalance(signerAccount.address)
        ])

        const totalDeposited = tokenState.fields.totalDepositedAlph
        const totalSupply = tokenState.fields.totalXAlphSupply

        // Price: how much ALPH one xALPH is worth
        const priceAlphPerXAlph =
          totalSupply > 0n ? new Decimal(totalDeposited.toString()).div(totalSupply.toString()) : new Decimal(1)

        // My xALPH balance
        const myXAlph = BigInt(balanceInfo.tokenBalances?.find((t) => t.id === xAlphId)?.amount ?? '0')
        const myAlphValue = totalSupply > 0n ? (myXAlph * totalDeposited) / totalSupply : 0n

        console.log('\nxALPH Staking Info:')
        console.log(`- xALPH price     : ${priceAlphPerXAlph.toFixed(6)} ALPH/xALPH`)
        console.log(`- Total ALPH pool : ${formatAmount(totalDeposited, 18)} ALPH`)
        console.log(`- Total xALPH     : ${formatAmount(totalSupply, 18)} xALPH`)
        console.log(`\nMy Holdings (${signerAccount.address}):`)
        console.log(`- xALPH balance   : ${formatAmount(myXAlph, 18)} xALPH`)
        console.log(`- ALPH value      : ${formatAmount(myAlphValue, 18)} ALPH`)
      } catch (error) {
        console.error('Failed to fetch staking info:', error)
      }
    } else {
      console.log(`Unknown action ${action} for module stake`)
    }
  } else if (command === 'token') {
    const action = args[1]
    if (action === 'list') {
      const signerAccount = await powfi.signer.getSelectedAccount()

      const [tokensResult, balanceInfo] = await Promise.all([
        powfi.token.getTokens().catch(() => [] as any[]),
        powfi.nodeProvider.addresses.getAddressesAddressBalance(signerAccount.address)
      ])

      console.log(`Balances for ${signerAccount.address}:`)

      // Display ALPH first
      const alphBalance = formatAmount(BigInt(balanceInfo.balance), 18)
      console.log(`- ALPH:      ${alphBalance.padEnd(20)} [Alephium] (${ALPH_TOKEN_ID})`)

      const registryTokens = tokensResult as any[]
      const walletTokens = balanceInfo.tokenBalances || []

      const xAlphId = powfi.staking.getConfig().xAlphTokenId

      walletTokens.forEach((walletInfo) => {
        const balance = BigInt(walletInfo.amount)
        if (balance > 0n) {
          const registryInfo = registryTokens.find((t) => t.id === walletInfo.id)
          const isXAlph = walletInfo.id === xAlphId

          if (registryInfo || isXAlph) {
            const symbol = registryInfo?.symbol || (isXAlph ? 'xALPH' : 'UNKNOWN')
            const name = registryInfo?.name || (isXAlph ? 'Staked ALPH' : `Token ${walletInfo.id.substring(0, 8)}...`)
            const decimals = registryInfo?.decimals || 18
            const formatted = formatAmount(balance, decimals)

            console.log(`- ${symbol.padEnd(10)}: ${formatted.padEnd(20)} [${name}] (${walletInfo.id})`)
          }
        }
      })
    } else if (action === 'ext') {
      const signerAccount = await powfi.signer.getSelectedAccount()

      const [tokensResult, balanceInfo] = await Promise.all([
        powfi.token.getTokens().catch(() => [] as any[]),
        powfi.nodeProvider.addresses.getAddressesAddressBalance(signerAccount.address)
      ])

      console.log(`Extended Balances for ${signerAccount.address} (Balance > 1):`)

      const alphBalance = BigInt(balanceInfo.balance)
      console.log(`- ALPH:      ${formatAmount(alphBalance, 18).padEnd(20)} [Alephium] (${ALPH_TOKEN_ID})`)

      const walletTokens = balanceInfo.tokenBalances || []

      for (const walletInfo of walletTokens) {
        const balance = BigInt(walletInfo.amount)
        if (balance > 0n) {
          let decimals = 18
          let symbol = `TKN-${walletInfo.id.substring(0, 6)}`
          let name = `Token ${walletInfo.id.substring(0, 8)}...`

          try {
            const tokenInfo = await getTokenInfo(walletInfo.id)
            decimals = tokenInfo.decimals
            symbol = tokenInfo.symbol
            name = tokenInfo.name
          } catch {
            // Fallback to defaults already set
          }

          const formatted = formatAmount(balance, decimals)
          console.log(`- ${symbol.padEnd(10)}: ${formatted.padEnd(20)} [${name}] (${walletInfo.id})`)
        }
      }
    } else {
      console.log(`Unknown action ${action} for module token`)
      console.log('Available Actions:')
      console.log('  list')
      console.log('  ext')
    }
  } else if (command === 'collector') {
    const action = args[1]

    if (!action) {
      console.log('Usage: npx ts-node src/cli.ts collector <action> [args...]')
      console.log('Available actions:')
      console.log('  info [symbol] # Show collector stats or specific vault info')
      console.log('  rr <%>     # Set reward rate (percent per year)')
      console.log('  br <%>     # Set burn rate (percent of rewards to burn)')
      console.log('  distribute # Manually trigger reward distribution')
      console.log('  enable <symbol> # Enable token for collection')
      console.log('  vault-upgrade <symbol> # Upgrade distributor vault for token')
      console.log('  set-clmm-factory # Set CLMM factory ID automatically')
      console.log('  set-cpmm-factory # Set CPMM factory ID automatically')
      return
    }

    if (action === 'info') {
      const symbol = args[2]
      if (symbol) {
        try {
          const token = await getTokenInfo(symbol)
          const info = await powfi.staking.getVaultState(token.id)
          console.log(`\nVault Info for ${token.symbol}:`)
          console.log(`- Address: ${info.address}`)
          console.log(`- ID:      ${info.id}`)
          console.log(`- Owner:   ${info.state.fields.owner}`)

          console.log('\nBalances:')
          for (const balance of info.balances.tokenBalances ?? []) {
            const bToken = await getTokenInfo(balance.id)
            console.log(`- ${bToken.symbol.padEnd(12)}: ${formatAmount(BigInt(balance.amount), bToken.decimals)}`)
          }
          console.log(`- ALPH:         ${formatAmount(BigInt(info.balances.balance), 18)}`)
        } catch (error) {
          console.error('Failed to get vault info:', error)
        }
        return
      }
      try {
        const feeCollectorId = powfi.staking.getConfig().feeCollectorId
        const feeCollectorAddress = addressFromContractId(feeCollectorId)
        const collector = powfi.staking.getRewardFeeCollector(feeCollectorId)

        const [collectorState, balanceInfo, xAlphState] = await Promise.all([
          collector.fetchState(),
          powfi.nodeProvider.addresses.getAddressesAddressBalance(feeCollectorAddress),
          powfi.staking.getXAlphTokenState()
        ])

        const { rewardRate, burnRate, lastUpdate, clmmFactoryId, cpmmFactoryId } = collectorState.fields

        const rewardRatePct = new Decimal(rewardRate.toString()).div(100)
        const burnRatePct = new Decimal(burnRate.toString()).div(100)

        const alphHeld = BigInt(balanceInfo.balance)
        const lastUpdateDate = new Date(Number(lastUpdate)).toISOString()

        const totalDeposited = xAlphState.fields.totalDepositedAlph
        const annualReward = (totalDeposited * rewardRate) / 10000n
        const netAnnualReward = (annualReward * (10000n - burnRate)) / 10000n

        console.log('\nRewardFeeCollector Info:')
        console.log(`- Address       : ${feeCollectorAddress}`)
        console.log(`- ALPH held     : ${formatAmount(alphHeld, 18)} ALPH`)
        console.log(`- Reward rate   : ${rewardRatePct.toFixed(4)}% / year (of total staked ALPH)`)
        console.log(`- Burn rate     : ${burnRatePct.toFixed(4)}% of rewards`)
        console.log(`- Last update   : ${lastUpdateDate}`)
        console.log(`- CLMM Factory  : ${clmmFactoryId || 'None'}`)
        console.log(`- CPMM Factory  : ${cpmmFactoryId || 'None'}`)
        console.log(`\nProjected annual output (on ${formatAmount(totalDeposited, 18)} ALPH staked):`)
        console.log(`- Gross reward  : ${formatAmount(annualReward, 18)} ALPH/year`)
        console.log(`- Net to stakers: ${formatAmount(netAnnualReward, 18)} ALPH/year`)
        console.log(`- Burnt         : ${formatAmount(annualReward - netAnnualReward, 18)} ALPH/year`)
      } catch (error) {
        console.error('Failed to fetch collector info:', error)
      }
    } else if (action === 'rr' || action === 'br') {
      const pctStr = args[2]
      if (!pctStr) {
        console.log(`Usage: collector ${action} <percent>`)
        return
      }

      try {
        const pct = new Decimal(pctStr)
        const newRate = BigInt(pct.mul(100).floor().toFixed(0))

        const result =
          action === 'rr' ? await powfi.staking.setRewardRate(newRate) : await powfi.staking.setBurnRate(newRate)

        console.log(`${action === 'rr' ? 'Reward' : 'Burn'} rate set to ${pctStr}% (TX: ${result.txId})`)
        await waitForTx(result.txId)
        console.log('Update confirmed.')
      } catch (error) {
        console.error(`Failed to set ${action === 'rr' ? 'reward' : 'burn'} rate:`, error)
      }
    } else if (action === 'distribute') {
      try {
        const stakingConfig = powfi.staking.getConfig()
        const feeCollectorId = stakingConfig.feeCollectorId
        const result = await powfi.staking.distributeRewards(feeCollectorId)
        console.log(`Rewards distribution triggered: ${result.txId}`)
        console.log('Waiting for confirmation...')

        await waitForTx(result.txId)

        const events = await powfi.nodeProvider.events.getEventsTxIdTxid(result.txId)
        const xAlphAddress = addressFromContractId(stakingConfig.xAlphTokenId)
        const collectorAddress = addressFromContractId(feeCollectorId)

        // XAlphToken emits RewardDeposited(from, amount) as event index 3
        const rewardEvent = events.events.find((e) => e.contractAddress === xAlphAddress)
        // RewardFeeCollector emits Burnt(amount) as event index 0
        const burntEvent = events.events.find((e) => e.contractAddress === collectorAddress)

        console.log('\nDistribution results:')
        if (rewardEvent) {
          const rewardAmount = BigInt((rewardEvent.fields as { type: string; value: string }[])[1].value)
          console.log(`- Rewards shared with stakers : ${formatAmount(rewardAmount, 18)} ALPH`)
        } else {
          console.log('- No rewards were distributed to stakers.')
        }

        if (burntEvent) {
          const burntAmount = BigInt((burntEvent.fields as { type: string; value: string }[])[0].value)
          console.log(`- Tokens burnt                : ${formatAmount(burntAmount, 18)} ALPH`)
        } else if (rewardEvent) {
          console.log('- No tokens were burnt.')
        }
      } catch (error) {
        console.error('Failed to distribute rewards:', error)
      }
    } else if (action === 'enable') {
      const symbol = args[2]
      if (!symbol) {
        console.log('Usage: collector enable <symbol>')
        return
      }
      try {
        const tokenInfo = await getTokenInfo(symbol)
        const result = await powfi.staking.enableToken(tokenInfo.id)
        console.log(`Token ${symbol} enabled for collector. TX: ${result.txId}`)
        await waitForTx(result.txId)
        console.log(`Token ${symbol} enabled confirmed.`)
      } catch (error) {
        console.error(`Failed to enable token ${symbol}:`, error)
      }
    } else if (action === 'vault-upgrade') {
      const symbol = args[2]
      if (!symbol) {
        console.log('Usage: collector vault-upgrade <symbol>')
        return
      }
      try {
        const tokenInfo = await getTokenInfo(symbol)
        console.log(`Upgrading DistributorVault for ${tokenInfo.symbol}...`)
        const result = await powfi.staking.migrateDistributorVault(tokenInfo.id)
        console.log(`Vault upgrade submitted: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('Vault upgrade confirmed.')
      } catch (error) {
        console.error(`Failed to upgrade vault for ${symbol}:`, error)
      }
    } else if (action === 'upgrade') {
      console.log('Upgrading RewardFeeCollector...')
      try {
        const result = await powfi.staking.migrateRewardFeeCollector()
        console.log(`Collector upgrade submitted: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('Collector upgrade confirmed.')
      } catch (error) {
        console.error('Failed to upgrade collector:', error)
      }
    } else if (action === 'set-clmm-factory') {
      try {
        const factoryId = powfi.clmm.getClmmConfig().factoryId
        const result = await powfi.staking.setClmmFactoryId(factoryId)
        console.log(`CLMM factory ID updated to ${factoryId}. TX: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('CLMM factory ID update confirmed.')
      } catch (error) {
        console.error('Failed to update CLMM factory ID:', error)
      }
    } else if (action === 'set-cpmm-factory') {
      try {
        const factoryId = powfi.cpmm.getCpmmConfig().factoryId
        const result = await powfi.staking.setCpmmFactoryId(factoryId)
        console.log(`CPMM factory ID updated to ${factoryId}. TX: ${result.txId}`)
        await waitForTx(result.txId)
        console.log('CPMM factory ID update confirmed.')
      } catch (error) {
        console.error('Failed to update CPMM factory ID:', error)
      }
    } else {
      console.log(`Unknown action ${action} for module collector`)
    }
  } else if (command === 'ref') {
    const action = args[1]
    if (!action) {
      console.log('Usage: npx ts-node src/cli.ts ref <action> [args]')
      console.log('Actions:')
      console.log('  create [referrer] # Create a new referral account')
      console.log('  info [address]    # Show referral account info/stats')
      console.log('  set-parents       # Set protocol factories as account parents')
      console.log('  upgrade [address] # Upgrade referral account bytecode')
      console.log('  migrate           # Migrate root account template bytecode')
      return
    }

    if (action === 'create') {
      const referrer = args[2] || (await powfi.signer.getSelectedAccount()).address
      console.log(`Creating referral account with referrer ${referrer}...`)
      try {
        const res = await powfi.clmm.createDexAccount(referrer)
        console.log(`- Submitted: ${res.txId}`)
        await waitForTx(res.txId)
        console.log('Referral account created.')
      } catch (error) {
        console.error('Failed to create referral account:', error)
      }
    } else if (action === 'info') {
      const address = args[2] || (await powfi.signer.getSelectedAccount()).address
      try {
        const info = await powfi.clmm.getDexAccountState(address)
        console.log(`\nReferral Account Info for ${address}:`)
        console.log(`- Address:   ${info.address}`)
        console.log(`- ID:        ${info.id}`)
        console.log(`- Owner:     ${info.state.fields.owner}`)
        console.log(`- Referrer:  ${info.state.fields.referrer}`)
        console.log(`- Min Swap Count: ${info.state.fields.minSwapCount}`)
      } catch (error) {
        console.error(`Failed to get referral account info for ${address}:`, error)
      }
    } else if (action === 'set-parents') {
      console.log('Setting up referral account parents...')
      try {
        const clmmFactory = powfi.clmm.getConfig().factoryId
        const cpmmFactory = powfi.cpmm.getCpmmConfig().factoryId
        console.log(`- CLMM Factory: ${clmmFactory}`)
        console.log(`- CPMM Factory: ${cpmmFactory}`)

        const res = await powfi.clmm.setParents([clmmFactory, cpmmFactory])
        console.log(`- Submitted: ${res.txId}`)
        await waitForTx(res.txId)
        console.log('Referral account parents setup completed.')
      } catch (error) {
        console.error('Failed to setup referral account parents:', error)
      }
    } else if (action === 'migrate') {
      const newCode = DexAccountRoot.contract.bytecode
      console.log(`Migrating referral account root template...`)
      try {
        const res = await powfi.clmm.migrateDexAccount(newCode)
        console.log(`- Submitted: ${res.txId}`)
        await waitForTx(res.txId)
        console.log('Root template migrated.')
      } catch (error) {
        console.error('Failed to migrate root template:', error)
      }
    } else if (action === 'upgrade') {
      const address = args[2] || (await powfi.signer.getSelectedAccount()).address
      const newCode = DexAccount.contract.bytecode
      console.log(`Upgrading referral account for ${address}...`)
      try {
        const res = await powfi.clmm.upgradeUserDexAccount(address, newCode)
        console.log(`- Submitted: ${res.txId}`)
        await waitForTx(res.txId)
        console.log('Referral account upgraded.')
      } catch (error) {
        console.error('Failed to upgrade referral account:', error)
      }
    } else {
      console.log(`Unknown action ${action} for module ref`)
    }
  } else {
    console.log(`Unknown module ${command}`)
  }
}

main().catch(console.error)
