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
import { MIN_SQRT_RATIO } from '../../../clmm/artifacts/ts/constants';
import { ClmmLiquidityUtils } from '../../../src/clmm/liquidity';
import { TickUtils } from '../../../src/clmm/tick';
import { Zeta } from '../../../src/zeta';
import { PoolUtils, UNLIMITED_AMOUNT } from '../../../src';

web3.setCurrentNodeProvider('http://127.0.0.1:22973', undefined, fetch);

interface Balances {
  alph: bigint;
  tokens: Record<string, bigint>;
}

async function getBalances(address: string, tokenIds: string[]): Promise<Balances> {
  const balance = await web3.getCurrentNodeProvider().addresses.getAddressesAddressBalance(address);
  const tokens: Record<string, bigint> = {};
  for (const id of tokenIds) {
    const token = balance.tokenBalances?.find((t) => t.id === id);
    tokens[id] = token ? BigInt(token.amount) : 0n;
  }
  return { alph: BigInt(balance.balance), tokens };
}

function sortTokens(a: string, b: string): [string, string] {
  return BigInt('0x' + a) < BigInt('0x' + b) ? [a, b] : [b, a];
}

class Fixture {
  constructor(
    readonly factory: PoolFactoryInstance,
    readonly dexAccountTemplate: DexAccountInstance,
    readonly tokenId0: string,
    readonly tokenId1: string,
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
    const dexAccountTemplate = (await DexAccount.deploy(deployer, {
      initialFields: {
        counter: 0n,
        owner: deployer.address,
        refferer: deployer.address,
        parents: ['', ''],
      }
    })).contractInstance;

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

    return new Fixture(factory, dexAccountTemplate, tokenId0, tokenId1, zeta, deployer);
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
}

describe('CLMM basic pool flow', () => {
  test('mint liquidity and swap while tracking balances', async () => {
    const fixture = await Fixture.create();
    const [lp, trader] = await getSigners(2, 3_000n * ONE_ALPH);

    await fixture.transferToken(fixture.tokenId0, 2000n * ONE_ALPH, lp);
    await fixture.transferToken(fixture.tokenId1, 2000n * ONE_ALPH, lp);
    await fixture.transferToken(fixture.tokenId0, 1000n * ONE_ALPH, trader);
    await fixture.transferToken(fixture.tokenId1, 1000n * ONE_ALPH, trader);

    const tickSpacing = 1n;
    const fee = 3_000n;
    const feeProtocol = 0n;
    const configIndex = await fixture.createConfigIndex(tickSpacing, fee, feeProtocol);

    const pool = await fixture.createPoolWithInitialLiquidity(
      configIndex,
      100n * ONE_ALPH,
      1000n * ONE_ALPH,
    );

    const poolStateBefore = await pool.fetchState();
    const sqrtPriceCurrent = poolStateBefore.fields.slot0.sqrtPriceX96;
    const currentLiquidity = poolStateBefore.fields.liquidity;
    const decimals = 18;

    const currentPrice = TickUtils.sqrtPriceX96ToPrice(sqrtPriceCurrent, decimals, decimals);
    const tickLower = TickUtils.getAlignedTick(currentPrice * 0.9, decimals, decimals, tickSpacing);
    const tickUpper = TickUtils.getAlignedTick(currentPrice * 1.1, decimals, decimals, tickSpacing);

    // Calculate the actual amounts for token0 and token1
    const [token0Amount, token1Amount, liquidity] = ClmmLiquidityUtils.getPositionAmountsFromPrice(
      sqrtPriceCurrent,
      fixture.tokenId0,
      fixture.tokenId1,
      tickLower,
      tickUpper,
      100n * ONE_ALPH,
      UNLIMITED_AMOUNT,
    );

    const lpBefore = await getBalances(lp.address, [fixture.tokenId0, fixture.tokenId1]);
    const poolBefore = await getBalances(pool.address, [fixture.tokenId0, fixture.tokenId1]);

    const liquiditySlippage = 30n; // allow +/- 30 ticks around the current tick
    await fixture.addLiquidity(
      lp,
      configIndex,
      token0Amount,
      token1Amount,
      liquiditySlippage,
      tickLower,
      tickUpper,
    );

    const lpAfter = await getBalances(lp.address, [fixture.tokenId0, fixture.tokenId1]);
    const poolAfter = await getBalances(pool.address, [fixture.tokenId0, fixture.tokenId1]);
    const poolStateAfter = await pool.fetchState();

    expect(lpBefore.tokens[fixture.tokenId0] - lpAfter.tokens[fixture.tokenId0]).toBe(token0Amount);
    expect(lpBefore.tokens[fixture.tokenId1] - lpAfter.tokens[fixture.tokenId1]).toBe(token1Amount);
    expect(poolAfter.tokens[fixture.tokenId0] - poolBefore.tokens[fixture.tokenId0]).toBe(
      token0Amount,
    );
    expect(poolAfter.tokens[fixture.tokenId1] - poolBefore.tokens[fixture.tokenId1]).toBe(
      token1Amount,
    );
    expect(poolStateAfter.fields.liquidity).toBe(currentLiquidity + liquidity);

    const swapIn = 5n * ONE_ALPH;
    const outputAmount = await fixture.computeSwapBaseIn(
      configIndex,
      fixture.tokenId0,
      fixture.tokenId1,
      swapIn,
    );
    console.log('outputAmount', outputAmount);

    const swapSlippage = 30;
    await fixture.swapExactIn(trader, configIndex, swapIn, swapSlippage);
  }, 60000);
});
