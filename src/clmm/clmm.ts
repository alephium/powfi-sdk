import type { SignExecuteScriptTxResult, Token } from '@alephium/web3';
import {
  addressFromContractId,
  binToHex,
  DUST_AMOUNT,
  MINIMAL_CONTRACT_DEPOSIT,
  subContractId,
  codec,
  encodePrimitiveValues,
  groupOfAddress,
  ALPH_TOKEN_ID,
} from '@alephium/web3';
import { loadDeployments } from 'clmm/artifacts/ts/deployments';
import ModuleBase from '../moduleBase';
import type { Zeta } from '../zeta';
import type {
  AddLiquidity,
  ClmmConfig,
  CollectProtocolFees,
  CollectTokens,
  LiquidityDistribution,
  RemoveLiquidity,
  SimulateSwap,
  ClmmSwapParams,
  ClmmPoolContractState,
  ClmmPoolConfig,
  SetRewardParams,
  ExtendRewards,
  PositionPath,
  ClmmPositionInfo,
} from './types';
import type { PoolInstance, PoolTypes } from 'clmm/artifacts/ts';
import {
  CreateLiquidPool,
  Pool,
  PoolConfig,
  PoolFactory,
  PositionManager,
  SwapWithoutAccount,
} from 'clmm/artifacts/ts';
import { PoolUtils } from './pool';
import { TickUtils } from './tick';
import { ClmmLiquidityUtils } from './liquidity';
import { normalizeAddress, PoolNotFoundError, sortTokens } from '../common';

export class ClmmModule extends ModuleBase {
  private config: ClmmConfig;
  private configsByIndex = new Map<bigint, ClmmPoolConfig>();

  constructor(scope: Zeta) {
    super({ scope, moduleName: 'ClmmModule' });

    this.config = this._getClmmConfig();
  }

  setConfig(config: ClmmConfig) {
    this.config = config;
  }

  getClmmConfig(): ClmmConfig {
    return this.config;
  }

  getPoolConfigId(configIndex: bigint): string {
    const rawIndex = codec.u256Codec.encode(configIndex);
    const configPath = binToHex(rawIndex);
    const group = this.config.groupIndex;
    return subContractId(this.config.factoryId, configPath, group);
  }

  async getAllPoolConfigs(): Promise<ClmmPoolConfig[]> {
    const factoryAddress = addressFromContractId(this.config.factoryId);
    const factory = PoolFactory.at(factoryAddress);
    const state = await factory.fetchState();
    const nextConfigIndex = state.fields.nextConfigIndex;

    const configs: ClmmPoolConfig[] = [];
    for (let i = 0n; i < nextConfigIndex; i++) {
      let config = this.configsByIndex.get(i);
      if (!config) {
        config = await this.fetchConfigFromChain(i);
        this.configsByIndex.set(i, config);
      }
      configs.push(config);
    }

    return configs;
  }

  async getPoolConfig(configIndex: bigint): Promise<ClmmPoolConfig | undefined> {
    const cached = this.configsByIndex.get(configIndex);
    if (cached) {
      return cached;
    }

    try {
      const config = await this.fetchConfigFromChain(configIndex);
      this.configsByIndex.set(configIndex, config);
      return config;
    } catch (error) {
      this.logWarning(`Failed to fetch config ${configIndex.toString()}`, error);
      return undefined;
    }
  }

  private async fetchConfigFromChain(configIndex: bigint): Promise<ClmmPoolConfig> {
    const poolConfigId = this.getPoolConfigId(configIndex);
    const poolConfigAddress = addressFromContractId(poolConfigId);
    const poolConfig = PoolConfig.at(poolConfigAddress);
    const poolConfigState = await poolConfig.fetchState();
    return {
      configIndex,
      tickSpacing: poolConfigState.fields.config.tickSpacing,
      tradingFee: poolConfigState.fields.config.fee,
      protocolFee: poolConfigState.fields.config.feeProtocol,
    };
  }

  async getPoolState(poolId: string): Promise<ClmmPoolContractState> {
    try {
      const poolAddress = addressFromContractId(poolId);
      const pool = Pool.at(poolAddress);
      const state = await pool.fetchState();
      const token0Info = await this.scope.token.getTokenById(state.fields.token0);
      const token1Info = await this.scope.token.getTokenById(state.fields.token1);

      return {
        poolId,
        token0Info,
        token1Info,
        liquidity: state.fields.liquidity,
        tradingFee: state.fields.fee,
        protocolFee: state.fields.slot0.feeProtocol,
        tick: state.fields.slot0.tick,
        tickSpacing: state.fields.tickSpacing,
        sqrtPriceX96: state.fields.slot0.sqrtPriceX96,
        configIndex: state.fields.configIndex,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new PoolNotFoundError(poolId);
      }
      this.logAndThrowError(`Failed to fetch CLMM pool state on ${poolId}`, error);
    }
  }

  async getPoolTokenBalances(poolId: string): Promise<{ token0Balance: bigint; token1Balance: bigint }> {
    try {
      const poolAddress = addressFromContractId(poolId);
      const state = await Pool.at(poolAddress).fetchState();
      const { token0, token1 } = state.fields;

      const balance = await this.scope.nodeProvider.addresses.getAddressesAddressBalance(poolAddress);

      const getBalance = (tokenId: string) =>
        tokenId === ALPH_TOKEN_ID
          ? BigInt(balance.balance)
          : BigInt(balance.tokenBalances?.find((t) => t.id === tokenId)?.amount || '0');

      return {
        token0Balance: getBalance(token0),
        token1Balance: getBalance(token1),
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new PoolNotFoundError(poolId);
      }
      this.logAndThrowError(`Failed to fetch CLMM pool token balances for ${poolId}`, error);
    }
  }

  getPoolId(tokenA: string, tokenB: string, configIndex: bigint): string {
    const [token0, token1] = sortTokens(tokenA, tokenB);
    const group = this.config.groupIndex;
    const factoryId = this.config.factoryId;
    const rawIndex = codec.u256Codec.encode(configIndex);
    const configPath = binToHex(rawIndex);
    const configId = subContractId(factoryId, configPath, group);
    const path = token0 + token1 + configId;
    return subContractId(factoryId, path, group);
  }

  getPositionId(poolId: string, owner: string, tickLower: bigint, tickUpper: bigint): string {
    const group = groupOfAddress(addressFromContractId(poolId));
    const path = encodePrimitiveValues([
      { type: 'U256', value: Pool.consts.PathPrefixes.Position },
      { type: 'Address', value: owner },
      { type: 'I256', value: tickLower },
      { type: 'I256', value: tickUpper },
    ]);
    return subContractId(poolId, binToHex(path), group);
  }

  getPoolAddress(tokenA: string, tokenB: string, configIndex: bigint): string {
    const poolId = this.getPoolId(tokenA, tokenB, configIndex);
    return addressFromContractId(poolId);
  }

  getPool(tokenA: string, tokenB: string, configIndex: bigint): PoolInstance {
    const poolAddress = this.getPoolAddress(tokenA, tokenB, configIndex);
    return Pool.at(poolAddress);
  }

  async poolExists(tokenA: string, tokenB: string, configIndex: bigint): Promise<boolean> {
    const poolAddress = this.getPoolAddress(tokenA, tokenB, configIndex);
    const pool = Pool.at(poolAddress);
    try {
      await pool.fetchState();
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return false;
      }
      this.logAndThrowError(`Failed to fetch pool state on ${poolAddress}`, error);
    }
  }

  async createPool(
    configIndex: bigint,
    token0: string,
    token1: string,
    rewardToken: string,
    tick: bigint,
    amount0: bigint,
    amount1: bigint,
    tickLower: bigint,
    tickUpper: bigint,
    dustAmount?: bigint,
  ): Promise<{ poolAddress: string; result: SignExecuteScriptTxResult }> {
    const sqrtPriceX96 = TickUtils.getSqrtRatioAtTick(tick);
    const tokens = [token0, token1];
    const amounts = [amount0, amount1];
    const ticks = [tickLower, tickUpper];
    if (token0 > token1) {
      tokens.reverse();
      amounts.reverse();
    }
    if (tickLower > tickUpper) {
      ticks.reverse();
    }
    const sqrtPriceX96A = TickUtils.getSqrtRatioAtTick(ticks[0]);
    const sqrtPriceX96B = TickUtils.getSqrtRatioAtTick(ticks[1]);
    const liquidity = ClmmLiquidityUtils.getLiquidityFromAmounts(
      sqrtPriceX96,
      sqrtPriceX96A,
      sqrtPriceX96B,
      amounts[0],
      amounts[1],
    );
    const result = await CreateLiquidPool.execute({
      signer: this.scope.signer,
      initialFields: {
        factory: this.config.factoryId,
        token0: tokens[0],
        token1: tokens[1],
        rewardToken,
        liquidity,
        tickLower: ticks[0],
        tickUpper: ticks[1],
        sqrtPriceX96,
        configIndex,
        amount0: amounts[0],
        amount1: amounts[1],
      },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT * 6n,
      tokens: [
        { id: tokens[0], amount: amounts[0] },
        { id: tokens[1], amount: amounts[1] },
      ],
      dustAmount: dustAmount ?? MINIMAL_CONTRACT_DEPOSIT * 2n,
    });
    const poolAddress = this.getPoolAddress(tokens[0], tokens[1], configIndex);
    return { poolAddress, result };
  }

  async addLiquidity(
    p: AddLiquidity,
  ): Promise<{ positionId: string; result: SignExecuteScriptTxResult }> {
    const poolAddress = this.getPoolAddress(p.token0, p.token1, p.configIndex);
    const pool = Pool.at(poolAddress);
    const positionManagerAddress = addressFromContractId(this.config.positionManagerId);
    const positionManager = PositionManager.at(positionManagerAddress);

    const signerAccount = await this.scope.signer.getSelectedAccount();
    const owner = p.owner || signerAccount.address;

    const group = this.config.groupIndex;
    const normalizedOwner = normalizeAddress(owner, group);
    const normalizedPayer = normalizeAddress(signerAccount.address, group);

    const {
      returns: [sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, deposit],
    } = await positionManager.view.getSqrtPricesX96({
      args: {
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        pool: pool.contractId,
        owner: normalizedOwner,
      },
    });
    const currentTick = TickUtils.getTickAtSqrtRatio(sqrtPriceX96);
    const minTick = currentTick - p.slippage;
    const maxTick = currentTick + p.slippage;
    const minSqrtPriceX96 = TickUtils.getSqrtRatioAtTick(minTick);
    const maxSqrtPriceX96 = TickUtils.getSqrtRatioAtTick(maxTick);

    const liquidity = ClmmLiquidityUtils.getLiquidityFromAmounts(
      sqrtPriceX96,
      sqrtRatioAX96,
      sqrtRatioBX96,
      p.amount0,
      p.amount1,
    );
    const [spotAmount0, spotAmount1] = ClmmLiquidityUtils.getAmountsForLiquidity(
      sqrtPriceX96,
      sqrtRatioAX96,
      sqrtRatioBX96,
      -liquidity,
    );
    const [minAmount0, minAmount1] = ClmmLiquidityUtils.getAmountsForLiquidity(
      minSqrtPriceX96,
      sqrtRatioAX96,
      sqrtRatioBX96,
      -liquidity,
    );
    const [maxAmount0, maxAmount1] = ClmmLiquidityUtils.getAmountsForLiquidity(
      maxSqrtPriceX96,
      sqrtRatioAX96,
      sqrtRatioBX96,
      -liquidity,
    );

    const positionId = PoolUtils.getPositionId(poolAddress, owner, p.tickLower, p.tickUpper);
    const tokens: Token[] = [
      { id: p.token0, amount: -minAmount0 },
      { id: p.token1, amount: -maxAmount1 },
    ];

    if (p.existingPosition) {
      tokens.push({ id: positionId, amount: 1n });
    }
    const result = await positionManager.transact.addLiquidity({
      signer: this.scope.signer,
      args: {
        payer: normalizedPayer,
        p: {
          token0: p.token0,
          token1: p.token1,
          configIndex: p.configIndex,
          owner: normalizedOwner,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          amount0Desired: -spotAmount0,
          amount1Desired: -spotAmount1,
          amount0Min: -maxAmount0,
          amount1Min: -minAmount1,
        },
      },
      tokens,
      attoAlphAmount: deposit,
    });

    return { positionId, result };
  }

  async removeLiquidity(
    p: RemoveLiquidity,
  ): Promise<{ positionId: string; result: SignExecuteScriptTxResult }> {
    const poolAddress = this.getPoolAddress(p.token0, p.token1, p.configIndex);
    const positionManagerAddress = addressFromContractId(this.config.positionManagerId);
    const positionManager = PositionManager.at(positionManagerAddress);
    const signerAccount = await this.scope.signer.getSelectedAccount();

    const group = this.config.groupIndex;
    const normalizedOwner = normalizeAddress(p.owner, group);
    const normalizedOperator = normalizeAddress(signerAccount.address, group);

    const positionId = PoolUtils.getPositionId(poolAddress, p.owner, p.tickLower, p.tickUpper);

    // Determine minimum amounts based on base token selection (Raydium pattern)
    // For remove liquidity: base amount is what we expect, other amount is the minimum we'll accept
    const amount0Min = p.base === 'token0' ? p.baseAmount : p.otherAmountMax;
    const amount1Min = p.base === 'token0' ? p.otherAmountMax : p.baseAmount;

    const result = await positionManager.transact.decreaseLiquidity({
      signer: this.scope.signer,
      args: {
        liquidity: p.liquidity,
        operator: normalizedOperator,
        p: {
          configIndex: p.configIndex,
          token0: p.token0,
          token1: p.token1,
          owner: normalizedOwner,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          amount0Min: amount0Min,
          amount1Min: amount1Min,
        },
      },
      tokens: [{ id: positionId, amount: 1n }],
      attoAlphAmount: DUST_AMOUNT * 3n,
    });
    return { positionId, result };
  }

  async positionInfo({ poolId, ...args }: PositionPath): Promise<ClmmPositionInfo> {
    const pool = Pool.at(addressFromContractId(poolId));
    const { returns } = await pool.view.positionInfo({ args });
    return returns;
  }
  async collectTokens(
    p: CollectTokens,
  ): Promise<{ positionId: string; result: SignExecuteScriptTxResult }> {
    const poolAddress = this.getPoolAddress(p.token0, p.token1, p.configIndex);
    const positionId = PoolUtils.getPositionId(poolAddress, p.owner, p.tickLower, p.tickUpper);
    const positionManagerAddress = addressFromContractId(this.config.positionManagerId);
    const signerAccount = await this.scope.signer.getSelectedAccount();

    const group = this.config.groupIndex;
    const normalizedOwner = normalizeAddress(p.owner, group);
    const normalizedOperator = normalizeAddress(signerAccount.address, group);
    const normalizedRecipient = normalizeAddress(p.recipient, group);

    const positionManager = PositionManager.at(positionManagerAddress);
    const result = await positionManager.transact.collect({
      signer: this.scope.signer,
      args: {
        liquidity: p.liquidity,
        operator: normalizedOperator,
        p: {
          configIndex: p.configIndex,
          token0: p.token0,
          token1: p.token1,
          owner: normalizedOwner,
          recipient: normalizedRecipient,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          amount0Max: p.amount0Max,
          amount1Max: p.amount1Max,
        },
      },
      tokens: [{ id: positionId, amount: 1n }],
      attoAlphAmount: DUST_AMOUNT * 3n,
    });

    return { positionId, result };
  }

  async findBestRoute(token0: string, token1: string): Promise<bigint> {
    const poolFactoryAddress = addressFromContractId(this.config.factoryId);
    const poolFactory = PoolFactory.at(poolFactoryAddress);
    const state = await poolFactory.fetchState();
    const f = (_: number, i: number) => this.getPoolAddress(token0, token1, BigInt(i));
    const addresses = Array.from({ length: Number(state.fields.nextConfigIndex) }, f);
    const pools = await Promise.all(
      addresses.map(async (addr, i) =>
        (await this.poolExists(token0, token1, BigInt(i))) ? Pool.at(addr).fetchState() : undefined,
      ),
    );
    const [index] = pools.reduce<[bigint, bigint]>(
      ([index, liquidity], pool, i) => {
        const liquidity2 = pool?.fields.liquidity || 0n;
        return liquidity2 > liquidity ? [BigInt(i), liquidity2] : [index, liquidity];
      },
      [-1n, 0n],
    );

    if (index === -1n) {
      throw new PoolNotFoundError(`No concentrated liquidity pool found for token pair ${token0}/${token1}`);
    }

    return index;
  }

  async simulateSwap(p: SimulateSwap): Promise<LiquidityDistribution> {
    const poolAddress = this.getPoolAddress(p.token0, p.token1, p.configIndex);
    const pool = Pool.at(poolAddress);
    const result = await pool.view.simulateSwap({
      args: {
        amountSpecified: p.amount,
        zeroForOne: p.zeroForOne,
        data: '',
        maxSteps: 500n,
      },
    });

    const poolState = result.contracts.at(0)?.fields as PoolTypes.Fields;
    const startEvent = result.events.at(0) as PoolTypes.SwapStartEvent;
    return {
      sqrtPriceX96: poolState.slot0.sqrtPriceX96,
      baseSqrtPriceX96: startEvent.fields.sqrtPriceX96,
      liquidity: poolState.liquidity,
      fee: poolState.fee,
      rows: result.events.slice(1).map((e) => {
        const event = e as PoolTypes.SwapStepEvent;
        return {
          sqrtPriceX96: event.fields.sqrtPriceX96,
          liquidity: event.fields.liquidity,
        };
      }),
    };
  }

  async swap(p: ClmmSwapParams): Promise<SignExecuteScriptTxResult> {
    const configIndex = p.routePlan[0];
    const pool = this.getPool(p.token0, p.token1, configIndex);
    const poolState = await pool.fetchState();
    const sqrtPriceX96 = poolState.fields.slot0.sqrtPriceX96;
    const zeroForOne = poolState.fields.token0 === p.token0;
    const sqrtPriceLimitX96 = TickUtils.getSqrtPriceLimitX96(sqrtPriceX96, p.slippage, zeroForOne);

    const tokens = sortTokens(p.token0, p.token1);
    const [tokenIn, tokenOut] = zeroForOne ? tokens : tokens.reverse();
    return await SwapWithoutAccount.execute({
      signer: this.scope.signer,
      initialFields: {
        dexAccount: this.config.accountRoot,
        pool: pool.contractId,
        tokenIn,
        tokenOut,
        zeroForOne,
        amountSpecified: p.amount,
        sqrtPriceLimitX96,
        data: '',
      },
      tokens: [{ id: tokenIn, amount: p.amount }],
      attoAlphAmount: DUST_AMOUNT * 2n,
    });
  }

  async collectProtocolFees(p: CollectProtocolFees): Promise<SignExecuteScriptTxResult> {
    const poolFactoryAddress = addressFromContractId(this.config.factoryId);
    const poolFactory = PoolFactory.at(poolFactoryAddress);
    const result = await poolFactory.transact.collectProtocolFees({
      signer: this.scope.signer,
      args: {
        recipient: p.recipient,
        configIndex: p.configIndex,
        token0: p.token0,
        token1: p.token1,
      },
    });
    return result;
  }

  async setRewardParams(p: SetRewardParams): Promise<SignExecuteScriptTxResult> {
    const poolFactoryAddress = addressFromContractId(this.config.factoryId);
    const poolFactory = PoolFactory.at(poolFactoryAddress);
    const index = p.rewardToken === p.token0 ? 0n : p.rewardToken === p.token1 ? 1n : 2n;
    const result = await poolFactory.transact.setRewardParams({
      signer: this.scope.signer,
      args: {
        token0: p.token0,
        token1: p.token1,
        configIndex: p.configIndex,
        amount: p.amount,
        index,
        openTime: p.openTime,
        endTime: p.endTime,
        payer: p.payer,
        tokenId: p.rewardToken,
      },
      tokens: [{ id: p.rewardToken, amount: p.amount }],
      attoAlphAmount: DUST_AMOUNT,
    });
    return result;
  }

  async extendRewards(p: ExtendRewards): Promise<SignExecuteScriptTxResult> {
    const poolAddress = this.getPoolAddress(p.token0, p.token1, p.configIndex);
    const pool = Pool.at(poolAddress);
    const index = p.rewardToken === p.token0 ? 0n : p.rewardToken === p.token1 ? 1n : 2n;
    const result = await pool.transact.extendRewards({
      signer: this.scope.signer,
      args: {
        payer: p.payer,
        index,
        amount: p.amount,
      },
      tokens: [{ id: p.rewardToken, amount: p.amount }],
      attoAlphAmount: DUST_AMOUNT,
    });
    return result;
  }

  private _getClmmConfig(): ClmmConfig {
    const networkId = this.scope.network.id;
    try {
      const deployments = loadDeployments(networkId);
      return {
        groupIndex: deployments.contracts.PoolFactory.contractInstance.groupIndex,
        factoryId: deployments.contracts.PoolFactory.contractInstance.contractId,
        positionManagerId: deployments.contracts.PositionManager.contractInstance.contractId,
        defaultConfigIndex: 0n,
        accountRoot: deployments.contracts.DexAccount.contractInstance.contractId,
      };
    } catch (error) {
      this.logAndThrowError(`Failed to load deployments on ${networkId}`, error);
    }
  }
}
