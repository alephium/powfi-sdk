import type { SignExecuteScriptTxResult } from '@alephium/web3';
import {
  addressFromContractId,
  binToHex,
  DUST_AMOUNT,
  MINIMAL_CONTRACT_DEPOSIT,
  subContractId,
  codec,
} from '@alephium/web3';
import { loadDeployments } from '../../clmm/artifacts/ts/deployments';
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
  ClmmPoolState,
  ClmmPoolConfig,
} from './types';
import type { PoolInstance, PoolTypes } from '../../clmm/artifacts/ts';
import { Pool, PoolConfig, PoolFactory, PositionManager } from '../../clmm/artifacts/ts';
import { PoolUtils } from './pool';
import { TickUtils } from './tick';
import { ClmmLiquidityUtils } from './liquidity';
import { PoolNotFoundError } from '../common';

export class ClmmModule extends ModuleBase {
  private config: ClmmConfig;
  private configsByIndex = new Map<bigint, ClmmPoolConfig>();

  constructor(scope: Zeta) {
    super({ scope, moduleName: 'ClmmModule' });

    this.config = this._getClmmConfig();
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

  async getPoolState(poolId: string): Promise<ClmmPoolState> {
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
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new PoolNotFoundError(poolId);
      }
      this.logAndThrowError(`Failed to fetch CLMM pool state on ${poolId}`, error);
    }
  }

  getPoolId(token0: string, token1: string, configIndex: bigint): string {
    const group = this.config.groupIndex;
    const factoryId = this.config.factoryId;
    const configId = this.getPoolConfigId(configIndex);
    const path = token0 + token1 + configId;
    return subContractId(factoryId, path, group);
  }

  getPoolAddress(token0: string, token1: string, configIndex: bigint): string {
    const poolId = this.getPoolId(token0, token1, configIndex);
    return addressFromContractId(poolId);
  }

  getPool(token0: string, token1: string, configIndex: bigint): PoolInstance {
    const poolAddress = this.getPoolAddress(token0, token1, configIndex);
    return Pool.at(poolAddress);
  }

  async poolExists(token0: string, token1: string, configIndex: bigint): Promise<boolean> {
    const poolAddress = this.getPoolAddress(token0, token1, configIndex);
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
    sqrtPriceX96: bigint,
  ): Promise<{ poolAddress: string; result: SignExecuteScriptTxResult }> {
    const factoryAddress = addressFromContractId(this.config.factoryId);
    const factory = PoolFactory.at(factoryAddress);
    const result = await factory.transact.create({
      signer: this.scope.signer,
      args: {
        token0,
        token1,
        configIndex,
        sqrtPriceX96,
      },
      attoAlphAmount: MINIMAL_CONTRACT_DEPOSIT,
    });
    const poolAddress = this.getPoolAddress(token0, token1, configIndex);
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
    const {
      returns: [sqrtPriceX96, sqrtRatioAX96, sqrtRatioBX96, deposit],
    } = await positionManager.view.getSqrtPricesX96({
      args: {
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        pool: pool.contractId,
        owner,
      },
    });
    const [minSqrtPriceX96, maxSqrtPriceX96] = TickUtils.getSqrtPriceX96Bounds(
      sqrtPriceX96,
      p.slippage,
    );
    const [spotAmount0, spotAmount1] = ClmmLiquidityUtils.getAmountsAndLiquidityAtSqrtPrice(
      sqrtPriceX96,
      sqrtRatioAX96,
      sqrtRatioBX96,
      p.amount0,
      p.amount1,
    );
    const [minAmount0, minAmount1] = ClmmLiquidityUtils.getAmountsAndLiquidityAtSqrtPrice(
      minSqrtPriceX96,
      sqrtRatioAX96,
      sqrtRatioBX96,
      p.amount0,
      p.amount1,
    );
    const [maxAmount0, maxAmount1] = ClmmLiquidityUtils.getAmountsAndLiquidityAtSqrtPrice(
      maxSqrtPriceX96,
      sqrtRatioAX96,
      sqrtRatioBX96,
      p.amount0,
      p.amount1,
    );

    const positionId = PoolUtils.getPositionId(poolAddress, owner, p.tickLower, p.tickUpper);
    const amount = p.owner ? 1n : 0n;
    const result = await positionManager.transact.addLiquidity({
      signer: this.scope.signer,
      args: {
        payer: signerAccount.address,
        p: {
          token0: p.token0,
          token1: p.token1,
          configIndex: p.configIndex,
          owner,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          amount0Desired: spotAmount0,
          amount1Desired: spotAmount1,
          amount0Min: maxAmount0,
          amount1Min: minAmount1,
        },
      },
      tokens: [
        { id: p.token0, amount: minAmount0 },
        { id: p.token1, amount: maxAmount1 },
        { id: positionId, amount },
      ],
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

    const positionId = PoolUtils.getPositionId(poolAddress, p.owner, p.tickLower, p.tickUpper);

    // Determine minimum amounts based on base token selection (Raydium pattern)
    // For remove liquidity: base amount is what we expect, other amount is the minimum we'll accept
    const amount0Min = p.base === 'token0' ? p.baseAmount : p.otherAmountMax;
    const amount1Min = p.base === 'token0' ? p.otherAmountMax : p.baseAmount;

    const result = await positionManager.transact.decreaseLiquidity({
      signer: this.scope.signer,
      args: {
        liquidity: p.liquidity,
        operator: signerAccount.address,
        p: {
          configIndex: p.configIndex,
          token0: p.token0,
          token1: p.token1,
          owner: p.owner,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          amount0Min: amount0Min,
          amount1Min: amount1Min,
        },
      },
      tokens: [{ id: positionId, amount: 1n }],
    });
    return { positionId, result };
  }

  async collectTokens(
    p: CollectTokens,
  ): Promise<{ positionId: string; result: SignExecuteScriptTxResult }> {
    const poolAddress = this.getPoolAddress(p.token0, p.token1, p.configIndex);
    const positionId = PoolUtils.getPositionId(poolAddress, p.owner, p.tickLower, p.tickUpper);
    const positionManagerAddress = addressFromContractId(this.config.positionManagerId);
    const signerAccount = await this.scope.signer.getSelectedAccount();

    const positionManager = PositionManager.at(positionManagerAddress);
    const result = await positionManager.transact.collect({
      signer: this.scope.signer,
      args: {
        liquidity: p.liquidity,
        operator: signerAccount.address,
        p: {
          configIndex: p.configIndex,
          token0: p.token0,
          token1: p.token1,
          owner: p.owner,
          recipient: p.recipient,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          amount0Max: p.amount0Max,
          amount1Max: p.amount1Max,
        },
      },
      tokens: [{ id: positionId, amount: 1n }],
      attoAlphAmount: DUST_AMOUNT * 2n,
    });

    return { positionId, result };
  }

  async simulateSwap(p: SimulateSwap): Promise<LiquidityDistribution> {
    const poolAddress = this.getPoolAddress(p.token0, p.token1, p.configIndex);
    const pool = Pool.at(poolAddress);
    const result = await pool.view.simulateSwap({
      args: {
        amountSpecified: p.amount,
        zeroForOne: p.zeroForOne,
        data: '',
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
    const pool = this.getPool(p.token0, p.token1, p.configIndex);
    const signerAccount = await this.scope.signer.getSelectedAccount();
    const poolState = await pool.fetchState();
    const sqrtPriceX96 = poolState.fields.slot0.sqrtPriceX96;
    const sqrtPriceLimitX96 = TickUtils.getSqrtPriceLimitX96(
      sqrtPriceX96,
      p.slippage,
      p.zeroForOne,
    );

    const [tokenIn, tokenOut] = p.zeroForOne ? [p.token0, p.token1] : [p.token1, p.token0];
    return await pool.transact.swap({
      signer: this.scope.signer,
      args: {
        payer: signerAccount.address,
        recipient: signerAccount.address,
        token: tokenOut,
        zeroForOne: p.zeroForOne,
        amountSpecified: p.amount,
        sqrtPriceLimitX96,
        data: '',
      },
      tokens: [{ id: tokenIn, amount: p.amount }],
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

  private _getClmmConfig(): ClmmConfig {
    const networkId = this.scope.network.id;
    try {
      const deployments = loadDeployments(networkId);
      return {
        groupIndex: deployments.contracts.PoolFactory.contractInstance.groupIndex,
        factoryId: deployments.contracts.PoolFactory.contractInstance.contractId,
        positionManagerId: deployments.contracts.PositionManager.contractInstance.contractId,
        defaultConfigIndex: 0n,
      };
    } catch (error) {
      this.logAndThrowError(`Failed to load deployments on ${networkId}`, error);
    }
  }
}
