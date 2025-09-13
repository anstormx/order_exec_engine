import { Order } from "../types";
import { sleep } from "../utils/errorHandler";

function generateMockTxHash() {
    const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let txHash = '';
    
    // Generate a 88-character base58 string to mimic a real Solana transaction hash
    for (let i = 0; i < 88; i++) {
        txHash += base58Chars.charAt(Math.floor(Math.random() * base58Chars.length));
    }
    
    return txHash;
}

export class MockDexRouter {
    basePrice = 1.0;
    
    async getRaydiumQuote() {
        // Simulate network delay
        await sleep(200);

        // Return price with some variance
        return {
            price: this.basePrice * (0.98 + Math.random() * 0.04),
            fee: 0.003,
        };
    }

    async getMeteoraQuote() {
        // Simulate network delay
        await sleep(200);

        // Return price with some variance
        return {
            price: this.basePrice * (0.97 + Math.random() * 0.05),
            fee: 0.002,
        };
    }

    async selectBestDex(tokenIn: string, tokenOut: string, amount: number) {
        // Get quotes from both DEXs
        const [raydiumQuote, meteoraQuote] = await Promise.all([
            this.getRaydiumQuote(),
            this.getMeteoraQuote()
        ]);

        // Calculate effective prices (after fees)
        const raydiumEffective = raydiumQuote.price * (1 - raydiumQuote.fee);
        const meteoraEffective = meteoraQuote.price * (1 - meteoraQuote.fee);

        // Calculate output amounts
        const raydiumOutput = amount * raydiumEffective;
        const meteoraOutput = amount * meteoraEffective;

        // Determine best DEX based on output amount
        const isRaydiumBetter = raydiumOutput > meteoraOutput;
        const selectedDex = isRaydiumBetter ? 'raydium' : 'meteora';
        const selectedQuote = isRaydiumBetter ? raydiumQuote : meteoraQuote;
        const outputDifference = Math.abs(raydiumOutput - meteoraOutput);
        const percentageDifference = (outputDifference / Math.max(raydiumOutput, meteoraOutput)) * 100;

        const reason = `${selectedDex} provides ${outputDifference.toFixed(6)} more ${tokenOut} (${percentageDifference.toFixed(2)}% better)`;

        console.log(`Routing Decision: ${reason}`);

        return {
            dex: selectedDex,
            bestQuote: {
                dex: selectedDex,
                price: selectedQuote.price,
                fee: selectedQuote.fee,
                priceImpact: percentageDifference / 100
            },
            allQuotes: [
                {
                    dex: 'raydium',
                    price: raydiumQuote.price,
                    fee: raydiumQuote.fee,
                },
                {
                    dex: 'meteora',
                    price: meteoraQuote.price,
                    fee: meteoraQuote.fee,
                }
            ],
            routingReason: reason
        };
    }

    async executeSwap(dex: string, order: Order) {
        console.log(`Executing swap on ${dex.toUpperCase()}`);
        console.log(`Order: ${order.amountIn} ${order.tokenIn} → ${order.tokenOut}`);

        // Simulate 2-3 second execution
        await sleep(2000 + Math.random() * 1000);

        // Simulate occasional execution failures (5% chance)
        if (Math.random() < 0.05) {
            console.log(`Swap failed`);
            return {
                success: false,
                error: 'Swap failed'
            };
        }

        // Simulate final execution price with some slippage
        const txHash = generateMockTxHash();
        let finalQuote;

        if (dex === 'raydium') {
            finalQuote = await this.getRaydiumQuote();
        } else if (dex === 'meteora') {
            finalQuote = await this.getMeteoraQuote();
        } else {
            throw new Error(`Unsupported DEX: ${dex}`);
        }

        // Calculate final execution price with slippage (simulate 0-0.5% additional slippage)
        const slippageFactor = 1 - (Math.random() * 0.005);
        const finalPrice = finalQuote.price * slippageFactor;
        const actualAmountOut = order.amountIn * finalPrice;

        console.log(`Swap completed`);
        console.log(`Transaction: ${txHash}`);
        console.log(`Final Price: ${finalPrice.toFixed(6)} ${order.tokenOut}`);

        return {
            success: true,
            txHash,
            executedPrice: parseFloat(finalPrice.toFixed(6)),
            actualAmountOut: parseFloat(actualAmountOut.toFixed(6))
        };
    }
}