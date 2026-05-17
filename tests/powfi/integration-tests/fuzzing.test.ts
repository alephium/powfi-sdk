import { web3, stringToHex, ONE_ALPH, subContractId, addressFromContractId, DUST_AMOUNT, MINIMAL_CONTRACT_DEPOSIT, ALPH_TOKEN_ID, codec, binToHex } from '@alephium/web3'
import { getSigners } from '@alephium/web3-test'
import { FuzzCreateFactories, FuzzingTestFactory, PoolFactory, Pool, FuzzClmmAddLiquidity, FuzzSwapAllPools, PositionManager } from 'clmm'
import { TokenPairFactory, TokenPair } from 'cpmm'
import { describe, test } from 'vitest'
import { Powfi } from '../../../src/powfi'
import { TickUtils } from '../../../src/clmm/tick'
import { loadClmmDeployments, loadCpmmDeployments, loadStakingDeployments } from '../../../src'

async function run() {
    web3.setCurrentNodeProvider('http://127.0.0.1:22973')

    const signersCount = 8
    console.log(`Setting up ${signersCount} signers...`)
    const signers = await getSigners(signersCount, 200n * ONE_ALPH)

    const clmmDeployments = loadClmmDeployments('devnet')
    const cpmmDeployments = loadCpmmDeployments('devnet')
    loadStakingDeployments('devnet')

    const powfi = new Powfi({ networkId: 'devnet', signer: signers[0] })
    powfi.setCurrentProviders()

    // 2. Deploy the Test Factory
    const fakeClmmTemplateId = clmmDeployments.contracts.PoolFactory.contractInstance.contractId
    const fakeCpmmTemplateId = cpmmDeployments.contracts.TokenPairFactory.contractInstance.contractId
    console.log(addressFromContractId(fakeClmmTemplateId), addressFromContractId(fakeCpmmTemplateId))
    const {
        contractInstance: factory
    } = await FuzzingTestFactory.deploy(signers[0], {
        initialFields: {
            fakeClmmTemplateId,
            fakeCpmmTemplateId,
            poolTemplate: clmmDeployments.contracts.Pool.contractInstance.contractId,
            positionTemplate: clmmDeployments.contracts.Position.contractInstance.contractId,
            tickTemplate: clmmDeployments.contracts.Tick.contractInstance.contractId,
            wordTemplate: clmmDeployments.contracts.BitmapWord.contractInstance.contractId,
            poolConfigTemplate: clmmDeployments.contracts.PoolConfig.contractInstance.contractId,
            clmmDexAccountRoot: clmmDeployments.contracts.DexAccount.contractInstance.contractId,
            cpmmPairTemplateId: cpmmDeployments.contracts.TokenPair.contractInstance.contractId,
            cpmmDexAccount0: clmmDeployments.contracts.DexAccount.contractInstance.contractId
        }
    })

    const userTokens: string[] = []
    const userCpmmFactories: string[] = []
    const userClmmFactories: string[] = []
    const userPositions: Record<string, {
        clmmPoolId: string;
        tokenId0: string;
        tokenId1: string;
        tickLower: bigint;
        tickUpper: bigint;
        liquidity: bigint;
        configIndex: bigint;
    }[]> = {}
    const poolToOwner: Record<string, { signer: any, clmmFactoryId: string }> = {}

    console.log(`Each signer is deploying their own factories and token...`)
    for (let i = 0; i < signers.length; i++) {
        const signer = signers[i]
        const tx = await FuzzCreateFactories.execute({
            signer: signer,
            attoAlphAmount: 10n * ONE_ALPH,
            initialFields: {
                fuzzFactory: factory.contractId,
                index: BigInt(i)
            }
        })

        const events = await web3.getCurrentNodeProvider().events.getEventsTxIdTxid(tx.txId)
        const creationEvent = events.events.find(e => e.eventIndex === 0)
        if (!creationEvent) throw new Error('FactoriesCreated event not found')

        // fields: caller, clmmFactoryId, cpmmFactoryId, tokenId
        const clmmFactoryId = creationEvent.fields[1].value as string
        const cpmmFactoryId = creationEvent.fields[2].value as string
        const tokenId = creationEvent.fields[3].value as string

        userClmmFactories.push(clmmFactoryId)
        userCpmmFactories.push(cpmmFactoryId)
        userTokens.push(tokenId)

        console.log(`Signer ${i} created token ${tokenId} and 3 pool configs.`)
    }

    console.log(`Distributing tokens...`)
    const amountPerUser = (1n << 128n) / BigInt(signersCount)

    for (let i = 0; i < signers.length; i++) {
        const signer = signers[i]
        const tokenId = userTokens[i]

        const destinations = signers
            .filter((_, idx) => idx !== i)
            .map(s => ({
                address: s.address,
                attoAlphAmount: DUST_AMOUNT,
                tokens: [{ id: tokenId, amount: amountPerUser }]
            }))

        await signer.signAndSubmitTransferTx({
            signerAddress: signer.address,
            destinations: destinations
        })
        console.log(`Signer ${i} distributed their tokens.`)
    }

    console.log(`Creating CPMM and CLMM pairs for all asset combinations...`)
    const allTokens = [ALPH_TOKEN_ID, ...userTokens]

    const clmmConfigs = [
        { index: 0n, tickSpacing: 10n },
        { index: 1n, tickSpacing: 60n },
        { index: 2n, tickSpacing: 200n },
        { index: 3n, tickSpacing: 1n },
        { index: 4n, tickSpacing: 1n },
        { index: 5n, tickSpacing: 10n }
    ]

    for (let i = 0; i < signers.length; i++) {
        const signer = signers[i]
        const cpmmFactoryId = userCpmmFactories[i]
        const clmmFactoryId = userClmmFactories[i]

        console.log(`Signer ${i} creating pairs...`)
        powfi.signer = signer
        const originalCpmmFactory = powfi.cpmm.getConfig().factoryId
        const originalClmmFactory = powfi.clmm.getConfig().factoryId

        powfi.cpmm.getConfig().factoryId = cpmmFactoryId
        powfi.clmm.getConfig().factoryId = clmmFactoryId

        const myToken = userTokens[i]

        for (let t = i + 1; t < allTokens.length; t++) {
            const otherToken = allTokens[t]
            if (myToken === otherToken) continue

            const tokenAId = myToken
            const tokenBId = otherToken

            const randomCpmmAmount = BigInt(Math.floor(Number(ONE_ALPH) * 10 * (Math.random() * 10 + 0.1)))

            const [token0Id, token1Id] = tokenAId < tokenBId ? [tokenAId, tokenBId] : [tokenBId, tokenAId]
            const amount0Cpmm = tokenAId < tokenBId ? ONE_ALPH * 10n : randomCpmmAmount
            const amount1Cpmm = tokenAId < tokenBId ? randomCpmmAmount : ONE_ALPH * 10n

            const cpmmFactory = TokenPairFactory.at(addressFromContractId(cpmmFactoryId))
            await cpmmFactory.transact.createPair({
                signer,
                attoAlphAmount: ONE_ALPH * 2n,
                tokens: [
                    { id: token0Id, amount: ONE_ALPH },
                    { id: token1Id, amount: ONE_ALPH }
                ],
                args: {
                    payer: signer.address,
                    alphAmount: ONE_ALPH,
                    tokenAId: tokenAId,
                    tokenBId: tokenBId
                }
            })

            const cpmmPairId = subContractId(cpmmFactoryId, token0Id + token1Id, 0)
            const cpmmPair = TokenPair.at(addressFromContractId(cpmmPairId))
            await cpmmPair.transact.mint({
                signer,
                tokens: [
                    { id: token0Id, amount: amount0Cpmm },
                    { id: token1Id, amount: amount1Cpmm }
                ],
                args: {
                    sender: signer.address,
                    amount0: amount0Cpmm,
                    amount1: amount1Cpmm
                }
            })

            for (const config of clmmConfigs) {
                const randomPriceFactor = Math.random() * 10 + 0.1 // Random between 0.1 and 10.1
                const amount0 = ONE_ALPH * 10n
                const amount1 = BigInt(Math.floor(Number(ONE_ALPH) * 10 * randomPriceFactor))
                const price = Number(amount1) / Number(amount0)

                const currentTick = TickUtils.getAlignedTick(price, 18, 18, config.tickSpacing)
                const tickLower = TickUtils.getAlignedTick(price * 0.5, 18, 18, config.tickSpacing)
                const tickUpper = TickUtils.getAlignedTick(price * 2.0, 18, 18, config.tickSpacing)

                const [tokenId0, tokenId1] = tokenAId < tokenBId ? [tokenAId, tokenBId] : [tokenBId, tokenAId]

                const sqrtPriceX96 = TickUtils.getSqrtRatioAtTick(currentTick)
                const sqrtRatioAX96 = TickUtils.getSqrtRatioAtTick(tickLower)
                const sqrtRatioBX96 = TickUtils.getSqrtRatioAtTick(tickUpper)

                const { returns: liquidity } = await factory.view.calculateLiquidity({
                    args: {
                        sqrtPriceX96,
                        sqrtRatioAX96,
                        sqrtRatioBX96,
                        amount0,
                        amount1
                    }
                })

                let rewardTokenId = userTokens[(i + 1) % signers.length]
                const clmmFactory = PoolFactory.at(addressFromContractId(clmmFactoryId))
                await clmmFactory.transact.create({
                    signer,
                    attoAlphAmount: ONE_ALPH,
                    args: {
                        token0: tokenId0,
                        token1: tokenId1,
                        configIndex: config.index,
                        sqrtPriceX96: sqrtPriceX96,
                        rewardToken: rewardTokenId
                    }
                })

                const configPath = binToHex(codec.u256Codec.encode(config.index))
                const configId = subContractId(clmmFactoryId, configPath, 0)
                const clmmPoolId = subContractId(clmmFactoryId, tokenId0 + tokenId1 + configId, 0)

                const clmmPool = Pool.at(addressFromContractId(clmmPoolId))
                await clmmPool.transact.mint({
                    signer,
                    tokens: [
                        { id: tokenId0, amount: amount0 },
                        { id: tokenId1, amount: amount1 }
                    ],
                    args: {
                        payer: signer.address,
                        tickLower: BigInt(tickLower),
                        tickUpper: BigInt(tickUpper),
                        amount: liquidity,
                        owner: signer.address
                    }
                })

                // Initialize rewards
                rewardTokenId = userTokens[(i + 1) % signers.length]
                const rewardAmount = ONE_ALPH * 100n
                await clmmFactory.transact.setRewardParams({
                    signer,
                    attoAlphAmount: DUST_AMOUNT,
                    tokens: [{ id: rewardTokenId, amount: rewardAmount }],
                    args: {
                        token0: tokenId0,
                        token1: tokenId1,
                        configIndex: config.index,
                        amount: rewardAmount,
                        index: 2n,
                        openTime: BigInt(Date.now()),
                        endTime: BigInt(Date.now() + 1000 * 3600 * 24),
                        payer: signer.address,
                        tokenId: rewardTokenId
                    }
                })
                poolToOwner[clmmPoolId] = { signer, clmmFactoryId }

                if (!userPositions[signer.address]) userPositions[signer.address] = []
                userPositions[signer.address].push({
                    clmmPoolId,
                    tokenId0,
                    tokenId1,
                    tickLower: BigInt(tickLower),
                    tickUpper: BigInt(tickUpper),
                    liquidity,
                    configIndex: config.index
                })
            }
        }
        powfi.cpmm.getConfig().factoryId = originalCpmmFactory
        powfi.clmm.getConfig().factoryId = originalClmmFactory
    }

    console.log(`Fuzzing random operations for all signers...`)

    for (let s = 0; s < 100000; s++) {
        if (s % 1000 === 0) {
            console.log(`Iteration ${s}/100000...`)
        }

        const swapSigner = signers[Math.floor(Math.random() * signers.length)]
        powfi.signer = swapSigner
        powfi.cpmm.getConfig().factoryId = userCpmmFactories[signers.indexOf(swapSigner)]
        powfi.clmm.getConfig().factoryId = userClmmFactories[signers.indexOf(swapSigner)]

        const positions = userPositions[swapSigner.address] || []
        if (positions.length === 0) continue

        const pos = positions[Math.floor(Math.random() * positions.length)]

        try {
            const clmmPool = Pool.at(addressFromContractId(pos.clmmPoolId))
            const positionId = powfi.clmm.getPositionId(pos.clmmPoolId, swapSigner.address, pos.tickLower, pos.tickUpper)
            const positionManager = PositionManager.at(addressFromContractId(clmmDeployments.contracts.PositionManager.contractInstance.contractId))

            // Collect tokens/rewards first
            await positionManager.transact.collect({
                signer: swapSigner,
                attoAlphAmount: DUST_AMOUNT * 3n,
                tokens: [{ id: positionId, amount: 1n }],
                args: {
                    liquidity: 0n, // just collect, don't remove liquidity
                    operator: swapSigner.address,
                    p: {
                        configIndex: pos.configIndex,
                        token0: pos.tokenId0,
                        token1: pos.tokenId1,
                        owner: swapSigner.address,
                        recipient: swapSigner.address,
                        tickLower: pos.tickLower,
                        tickUpper: pos.tickUpper,
                        amount0Max: 10n ** 30n,
                        amount1Max: 10n ** 30n
                    }
                }
            })

            if (Math.random() > 0.5) {
                // Add liquidity
                const addAmount = pos.liquidity / 4n // Add 25% of current liquidity
                if (addAmount > 0n) {
                    await clmmPool.transact.mint({
                        signer: swapSigner,
                        attoAlphAmount: ONE_ALPH,
                        tokens: [
                            { id: pos.tokenId0, amount: 10n ** 30n },
                            { id: pos.tokenId1, amount: 10n ** 30n },
                            { id: positionId, amount: 1n }
                        ],
                        args: {
                            owner: swapSigner.address,
                            payer: swapSigner.address,
                            tickLower: pos.tickLower,
                            tickUpper: pos.tickUpper,
                            amount: addAmount
                        }
                    })
                    pos.liquidity += addAmount
                }
            } else {
                // Remove liquidity
                const burnAmount = pos.liquidity / 2n // Burn 50%
                if (burnAmount > 0n) {
                    await clmmPool.transact.burn({
                        signer: swapSigner,
                        attoAlphAmount: ONE_ALPH / 10n,
                        tokens: [
                            { id: positionId, amount: 1n }
                        ],
                        args: {
                            operator: swapSigner.address,
                            owner: swapSigner.address,
                            tickLower: pos.tickLower,
                            tickUpper: pos.tickUpper,
                            amount: burnAmount
                        }
                    })
                    pos.liquidity -= burnAmount
                }
            }

            // Random reward operations
            const rand = Math.random()
            if (rand < 0.1) {
                // Owner updates reward params
                const ownerInfo = poolToOwner[pos.clmmPoolId]
                const clmmFactory = PoolFactory.at(addressFromContractId(ownerInfo.clmmFactoryId))
                const rewardTokenId = userTokens[(signers.indexOf(ownerInfo.signer) + 1) % signers.length]
                const rewardAmount = ONE_ALPH * 10n
                await clmmFactory.transact.setRewardParams({
                    signer: ownerInfo.signer,
                    attoAlphAmount: DUST_AMOUNT,
                    tokens: [{ id: rewardTokenId, amount: rewardAmount }],
                    args: {
                        token0: pos.tokenId0,
                        token1: pos.tokenId1,
                        configIndex: pos.configIndex,
                        amount: rewardAmount,
                        index: 2n,
                        openTime: BigInt(Date.now()),
                        endTime: BigInt(Date.now() + 1000 * 3600 * 24),
                        payer: ownerInfo.signer.address,
                        tokenId: rewardTokenId
                    }
                })
            } else if (rand < 0.2) {
                // Random user extends rewards
                const otherSigner = signers[Math.floor(Math.random() * signers.length)]
                const rewardTokenId = userTokens[(signers.indexOf(poolToOwner[pos.clmmPoolId].signer) + 1) % signers.length]
                const extendAmount = ONE_ALPH * 5n
                await clmmPool.transact.extendRewards({
                    signer: otherSigner,
                    attoAlphAmount: DUST_AMOUNT,
                    tokens: [{ id: rewardTokenId, amount: extendAmount }],
                    args: {
                        payer: otherSigner.address,
                        index: 2n,
                        amount: extendAmount
                    }
                })
            }
        } catch (e) {
            console.error(`Error at iteration ${s} for signer ${swapSigner.address}:`, e)
            // If it's a contract error (e.g., throw in Ralph), we want to see it but keep going
        }
    }
}

describe('Powfi Fuzzing Gas Tests', () => {
    test.skip('Create max users in single tx', async () => {
        await run()
    }, 2_000_000_000)
})
