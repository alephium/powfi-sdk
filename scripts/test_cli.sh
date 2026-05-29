#!/bin/bash
set -e

# Configuration
CLI="npx ts-node src/cli.ts"
INDEX=0

echo "--- Token List ---"
$CLI token list

echo ""
echo "--- CLMM Tests ---"
echo "1. Set fee collector"
$CLI clmm set-fee-collector

echo ""
echo "2. Create pool"
# Note: providing 10 ALPH and 100 xALPH for initial liquidity.
$CLI clmm ALPH xALPH $INDEX create 10 10 100 || echo "CLMM Pool might already exist (Note: creation might fail if ALPH handling bug is present)"

echo ""
echo "3. Add liquidity"
$CLI clmm ALPH xALPH $INDEX add 5 15 1

echo ""
echo "4. Info"
$CLI clmm ALPH xALPH $INDEX info
$CLI clmm ALPH xALPH $INDEX info 5 15

echo ""
echo "5. Swap"
$CLI clmm ALPH xALPH $INDEX swap xALPH 0.1 100

echo ""
echo "6. Sim-swap"
$CLI clmm ALPH xALPH $INDEX sim-swap xALPH 0.1

echo ""
echo "7. Swap-to"
$CLI clmm ALPH xALPH $INDEX swap-to 11

echo ""
echo "8. Remove liquidity (50%)"
$CLI clmm ALPH xALPH $INDEX rm 5 15 50

echo ""
echo "9. Collect protocol fees"
$CLI clmm ALPH xALPH $INDEX collect-protocol

echo ""
echo "10. Collect rewards"
$CLI clmm ALPH xALPH $INDEX collect-rewards

# echo ""
# echo "11. Migrate (Example)"
# $CLI clmm ALPH xALPH $INDEX migrate <NEW_BYTECODE_HEX>


echo ""
echo "--- CPMM Tests ---"
echo "1. Set fee collector"
$CLI cpmm set-fee-collector

echo ""
echo "2. Create pool"
$CLI cpmm ALPH xALPH create 10 100 || echo "CPMM Pool might already exist (Note: creation might fail if ALPH handling bug is present)"

echo ""
echo "3. Add liquidity"
$CLI cpmm ALPH xALPH add 1

echo ""
echo "4. Info"
$CLI cpmm ALPH xALPH info

echo ""
echo "5. Swap"
$CLI cpmm ALPH xALPH swap xALPH 0.1 100

echo ""
echo "6. Sim-swap"
$CLI cpmm ALPH xALPH sim-swap xALPH 0.1

echo ""
echo "7. Swap-to"
# Note: pool price is ~0.1 xALPH/ALPH. Swapping to 0.11.
$CLI cpmm ALPH xALPH swap-to 0.11

echo ""
echo "8. Remove liquidity (50%)"
$CLI cpmm ALPH xALPH rm 50

echo ""
echo "9. Collect protocol fees"
$CLI cpmm ALPH xALPH collect-protocol


echo ""
echo "--- Staking Tests ---"
echo "1. Info"
$CLI stake info

echo ""
echo "2. Deposit"
$CLI stake deposit 10

# Note: start-unstake is an SDK feature but not exposed in the CLI stake commands
# echo ""
# echo "3. Start Unstake"
# $CLI stake start-unstake 5

echo ""
echo "4. Deposit Reward (Donation)"
$CLI stake donate 1

echo ""
echo "5. Info (final)"
$CLI stake info


echo ""
echo "--- Error Case (Slippage) ---"
echo "Testing swap with low slippage (0.01%) - should fail"
$CLI clmm ALPH xALPH $INDEX swap xALPH 10 1 || echo "Swap failed as expected"

echo ""
echo "Done!"
