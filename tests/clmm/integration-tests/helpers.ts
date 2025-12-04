import type { SignerProvider, SignExecuteScriptTxResult } from '@alephium/web3';
import {
  MINIMAL_CONTRACT_DEPOSIT,
  ONE_ALPH,
  addressFromContractId,
  binToHex,
  subContractId,
  web3,
  contractIdFromAddress,
  groupOfAddress,
  DUST_AMOUNT,
  encodePrimitiveValues,
} from '@alephium/web3';
import { getSigners, mintToken } from '@alephium/web3-test';
import type {
  DexAccountInstance,
  PoolFactoryInstance,
  PoolInstance,
} from '../../../clmm/artifacts/ts';
import {
  BitmapWord,
  DexAccount,
  Pool,
  PoolFactory,
  PoolConfig,
  Position,
  Tick,
  PositionManager,
} from '../../../clmm/artifacts/ts';
import { TickUtils } from '../../../src/clmm/tick';
import { Zeta } from '../../../src/zeta';
import { ClmmLiquidityUtils, PoolUtils, sortTokens } from '../../../src';

export interface Balances {
  alph: bigint;
  tokens: Record<string, bigint>;
}

export async function getBalances(address: string, tokenIds: string[]): Promise<Balances> {
  const balance = await web3.getCurrentNodeProvider().addresses.getAddressesAddressBalance(address);
  const tokens: Record<string, bigint> = {};
  for (const id of tokenIds) {
    const token = balance.tokenBalances?.find((t) => t.id === id);
    tokens[id] = token ? BigInt(token.amount) : 0n;
  }
  return { alph: BigInt(balance.balance), tokens };
}

export async function assertBalancesChange(params: {
  pool: PoolInstance;
  signer: SignerProvider;
  tokenIds: string[];
  action: () => Promise<unknown>;
  expect: {
    signer: Record<string, bigint>;
    pool: Record<string, bigint>;
    poolLiquidityDelta: bigint;
  };
}) {
  const { pool, signer: actor, tokenIds, action, expect: expected } = params;
  const signerAddr = (await actor.getSelectedAccount()).address;

  const signerBefore = await getBalances(signerAddr, tokenIds);
  const poolBefore = await getBalances(pool.address, tokenIds);
  const poolStateBefore = await pool.fetchState();

  await action();

  const signerAfter = await getBalances(signerAddr, tokenIds);
  const poolAfter = await getBalances(pool.address, tokenIds);
  const poolStateAfter = await pool.fetchState();

  const check = (before: Balances, after: Balances, expectations: Record<string, bigint>) => {
    for (const [tokenId, exp] of Object.entries(expectations)) {
      const delta = after.tokens[tokenId] - before.tokens[tokenId];
      expect(delta).toBe(exp);
    }
  };

  check(signerBefore, signerAfter, expected.signer);
  check(poolBefore, poolAfter, expected.pool);

  expect(poolStateAfter.fields.liquidity - poolStateBefore.fields.liquidity).toBe(
    expected.poolLiquidityDelta,
  );
}

export class Fixture {
  constructor(
    readonly factory: PoolFactoryInstance,
    readonly dexAccountTemplate: DexAccountInstance,
    readonly tokenId0: string,
    readonly tokenId1: string,
    readonly tokenDecimal: number,
    readonly zeta: Zeta,
    readonly deployer: SignerProvider,
  ) {}

  static async create(): Promise<Fixture> {
    const [deployer] = await getSigners(1, 5_000n * ONE_ALPH);

    const zeta = new Zeta({ networkId: 'devnet', signer: deployer });
    zeta.setCurrentProviders();

    const poolTemplate = (await Pool.deployTemplate(deployer)).contractInstance;
    const positionTemplate = (await Position.deployTemplate(deployer)).contractInstance;
    const tickTemplate = (await Tick.deployTemplate(deployer)).contractInstance;
    const wordTemplate = (await BitmapWord.deployTemplate(deployer)).contractInstance;
    const poolConfigTemplate = (await PoolConfig.deployTemplate(deployer)).contractInstance;
    const dexAccountTemplate = (
      await DexAccount.deploy(deployer, {
        initialFields: {
          counter: 0n,
          owner: deployer.address,
          refferer: deployer.address,
          parents: ['', ''],
        },
      })
    ).contractInstance;

    const factory = (
      await PoolFactory.deploy(deployer, {
        initialFields: {
          owner: deployer.address,
          poolTemplate: poolTemplate.contractId,
          positionTemplate: positionTemplate.contractId,
          tickTemplate: tickTemplate.contractId,
          wordTemplate: wordTemplate.contractId,
          poolConfigTemplate: poolConfigTemplate.contractId,
          dexAccountTemplate: dexAccountTemplate.contractId,
          nextConfigIndex: 0n,
        },
      })
    ).contractInstance;

    const { contractInstance: positionManager } = await PositionManager.deploy(deployer, {
      initialFields: {
        parent: factory.address,
      },
    });

    const initialAmount = 1_000_000n * ONE_ALPH;
    const { tokenId: tokenA } = await mintToken(deployer.address, initialAmount);
    const { tokenId: tokenB } = await mintToken(deployer.address, initialAmount);
    const [tokenId0, tokenId1] = sortTokens(tokenA, tokenB);

    zeta.clmm.setConfig({
      groupIndex: 0,
      factoryId: factory.contractId,
      positionManagerId: positionManager.contractId,
      defaultConfigIndex: 0n,
      accountRoot: dexAccountTemplate.contractId,
    });

    return new Fixture(factory, dexAccountTemplate, tokenId0, tokenId1, 18, zeta, deployer);
  }

  async createConfigIndex(tickSpacing: bigint, fee: bigint, feeProtocol: bigint): Promise<bigint> {
    const configTx = await this.factory.transact.createConfig({
      signer: this.deployer,
      args: {
        config: {
          tickSpacing,
          fee,
          feeProtocol,
        },
      },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT,
    });
    const configEvents = await this.zeta.nodeProvider.events.getEventsTxIdTxid(configTx.txId);
    const configCreated = configEvents.events.find((e) => e.eventIndex === 0);
    if (
      !configCreated ||
      configCreated.fields.length !== 1 ||
      typeof configCreated.fields[0].value !== 'string'
    ) {
      throw new Error('ConfigCreated event not found');
    }
    const configIndex = BigInt(configCreated.fields[0].value);
    return configIndex;
  }

  async createPoolWithInitialLiquidity(
    configIndex: bigint,
    amount0: bigint,
    amount1: bigint,
    tickSpacing: bigint = 1n,
  ): Promise<PoolInstance> {
    const price = Number(amount1 / amount0);
    const currentTick = TickUtils.getAlignedTick(price, 18, 18, tickSpacing);
    const tickLower = TickUtils.getAlignedTick(price * 0.9, 18, 18, tickSpacing);
    const tickUpper = TickUtils.getAlignedTick(price * 1.1, 18, 18, tickSpacing);

    await this.zeta.clmm.createPool(
      configIndex,
      this.tokenId0,
      this.tokenId1,
      '',
      currentTick,
      amount0,
      amount1,
      tickLower,
      tickUpper,
    );

    return this.zeta.clmm.getPool(this.tokenId0, this.tokenId1, configIndex);
  }

  getPoolAddress(
    factoryAddress: string,
    token0: string,
    token1: string,
    configIndex: bigint,
  ): string {
    const group = groupOfAddress(factoryAddress);
    const factoryId = binToHex(contractIdFromAddress(factoryAddress));
    const configId = this.getConfigId(factoryAddress, configIndex);
    const path = token0 + token1 + configId;
    const poolId = subContractId(factoryId, path, group);
    return addressFromContractId(poolId);
  }

  getConfigId(factoryAddress: string, configIndex: bigint): string {
    const rawIndex = encodePrimitiveValues([{ type: 'U256', value: configIndex }]);
    const configPath = binToHex(rawIndex);
    const group = groupOfAddress(factoryAddress);
    const factoryId = binToHex(contractIdFromAddress(factoryAddress));
    return subContractId(factoryId, configPath, group);
  }

  async swapExactIn(
    trader: SignerProvider,
    configIndex: bigint,
    amountIn: bigint,
    slippage: number,
  ) {
    this.zeta.signer = trader;
    return await this.zeta.clmm.swap({
      token0: this.tokenId0,
      token1: this.tokenId1,
      amount: amountIn,
      routePlan: [configIndex],
      slippage: BigInt(slippage),
    });
  }

  async getTokenBalance(address: string, tokenId: string): Promise<bigint> {
    const balances = await web3
      .getCurrentNodeProvider()
      .addresses.getAddressesAddressBalance(address);
    const tokenBalance = balances.tokenBalances?.find((t) => t.id === tokenId);
    return tokenBalance === undefined ? 0n : BigInt(tokenBalance.amount);
  }

  async transferToken(tokenId: string, amount: bigint, to: SignerProvider) {
    const fromAddress = (await this.deployer.getSelectedAccount()).address;
    const toAddress = (await to.getSelectedAccount()).address;
    await this.deployer.signAndSubmitTransferTx({
      signerAddress: fromAddress,
      destinations: [
        { address: toAddress, attoAlphAmount: DUST_AMOUNT, tokens: [{ id: tokenId, amount }] },
      ],
    });
  }

  async addLiquidity(
    lp: SignerProvider,
    configIndex: bigint,
    amount0: bigint,
    amount1: bigint,
    slippage: bigint,
    tickLower: bigint,
    tickUpper: bigint,
  ): Promise<{ positionId: string; result: SignExecuteScriptTxResult }> {
    const lpAddress = (await lp.getSelectedAccount()).address;
    this.zeta.signer = lp;
    return await this.zeta.clmm.addLiquidity({
      token0: this.tokenId0,
      token1: this.tokenId1,
      configIndex: configIndex,
      owner: lpAddress,
      tickLower,
      tickUpper,
      slippage,
      amount0,
      amount1,
      tokenBalances: new Map([
        [this.tokenId0, amount0],
        [this.tokenId1, amount1],
      ]),
    });
  }

  async computeSwapBaseIn(
    configIndex: bigint,
    token0: string,
    token1: string,
    amountIn: bigint,
  ): Promise<bigint> {
    const distribution = await this.zeta.clmm.simulateSwap({
      configIndex: configIndex,
      token0: token0,
      token1: token1,
      zeroForOne: true,
      amount: amountIn,
    });

    const outputAmount = PoolUtils.offlineSwap(distribution, amountIn, distribution.sqrtPriceX96);

    return outputAmount;
  }

  buildRange(
    sqrtPriceX96: bigint,
    tickSpacing: bigint,
    lowerFactor: number,
    upperFactor: number,
  ): { tickLower: bigint; tickUpper: bigint } {
    const decimals = this.tokenDecimal;
    const currentPrice = TickUtils.sqrtPriceX96ToPrice(sqrtPriceX96, decimals, decimals);
    const tickLower = TickUtils.getAlignedTick(
      currentPrice * lowerFactor,
      decimals,
      decimals,
      tickSpacing,
    );
    const tickUpper = TickUtils.getAlignedTick(
      currentPrice * upperFactor,
      decimals,
      decimals,
      tickSpacing,
    );
    return { tickLower, tickUpper };
  }

  async addRangePosition({
    lp,
    pool,
    configIndex,
    sqrtPriceCurrent,
    range,
    amount0Desired,
    amount1Desired,
    slippage = 30n,
  }: {
    lp: SignerProvider;
    pool: PoolInstance;
    configIndex: bigint;
    sqrtPriceCurrent: bigint;
    range: { tickLower: bigint; tickUpper: bigint };
    amount0Desired: bigint;
    amount1Desired: bigint;
    slippage?: bigint;
  }): Promise<{ amount0: bigint; amount1: bigint; liquidity: bigint }> {
    const [amount0, amount1, liquidity] = ClmmLiquidityUtils.getPositionAmountsFromPrice(
      sqrtPriceCurrent,
      this.tokenId0,
      this.tokenId1,
      range.tickLower,
      range.tickUpper,
      amount0Desired,
      amount1Desired,
    );
    const currentTick = TickUtils.getTickAtSqrtRatio(sqrtPriceCurrent);
    const isActive = range.tickLower <= currentTick && currentTick < range.tickUpper;
    const liquidityDelta = isActive ? liquidity : 0n;

    await assertBalancesChange({
      pool,
      signer: lp,
      tokenIds: [this.tokenId0, this.tokenId1],
      action: () =>
        this.addLiquidity(
          lp,
          configIndex,
          amount0,
          amount1,
          slippage,
          range.tickLower,
          range.tickUpper,
        ),
      expect: {
        signer: {
          [this.tokenId0]: -amount0,
          [this.tokenId1]: -amount1,
        },
        pool: {
          [this.tokenId0]: amount0,
          [this.tokenId1]: amount1,
        },
        poolLiquidityDelta: liquidityDelta,
      },
    });

    return { amount0, amount1, liquidity };
  }
}
