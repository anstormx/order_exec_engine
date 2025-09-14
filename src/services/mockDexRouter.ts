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
    basePriceInUsdc = 250;
    basePriceInSol = 0.004;
    
    async getRaydiumQuote(tokenIn: string, tokenOut: string, amount: string) {
        // Simulate network delay
        await sleep(200 + Math.random() * 100);

        // Return price with some variance
        return {
            price: tokenIn === "SOL" ? this.basePriceInUsdc * (0.98 + Math.random() * 0.04) : this.basePriceInSol * (0.98 + Math.random() * 0.04),
            fee: 0.003,
        };
    }

    async getMeteoraQuote(tokenIn: string, tokenOut: string, amount: string) {
        // Simulate network delay
        await sleep(200 + Math.random() * 100);

        // Return price with some variance
        return {
            price: tokenIn === "SOL" ? this.basePriceInUsdc * (0.97 + Math.random() * 0.05) : this.basePriceInSol * (0.97 + Math.random() * 0.05),
            fee: 0.002,
        };
    }

    async selectBestDex(tokenIn: string, tokenOut: string, amount: string) {
        // Get quotes from both DEXs
        const [raydiumQuote, meteoraQuote] = await Promise.all([
            this.getRaydiumQuote(tokenIn, tokenOut, amount),
            this.getMeteoraQuote(tokenIn, tokenOut, amount)
        ]);

        // Calculate effective prices (after fees)
        const raydiumEffective = raydiumQuote.price * (1 - raydiumQuote.fee);
        const meteoraEffective = meteoraQuote.price * (1 - meteoraQuote.fee);

        // Calculate output amounts
        const raydiumOutput = BigInt(amount) * BigInt(Math.floor(raydiumEffective));
        const meteoraOutput = BigInt(amount) * BigInt(Math.floor(meteoraEffective));

        // Determine best DEX based on output amount
        const isRaydiumBetter = raydiumOutput > meteoraOutput;
        const selectedDex = isRaydiumBetter ? 'raydium' : 'meteora';
        const selectedQuote = isRaydiumBetter ? raydiumQuote : meteoraQuote;
        const outputDifference = Math.abs(Number(raydiumOutput) - Number(meteoraOutput) );

        const reason = `${selectedDex} provides ${outputDifference.toFixed(6)} more ${tokenOut}`;

        console.log(`Routing Decision: ${reason}`);

        return {
            dex: selectedDex,
            bestQuote: {
                dex: selectedDex,
                price: selectedQuote.price,
                fee: selectedQuote.fee,
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

        // Simulate 2-3 second execution
        await sleep(2000 + Math.random() * 1000);

        // Simulate occasional execution failures (2% chance)
        if (Math.random() < 0.02) {
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
            finalQuote = await this.getRaydiumQuote(order.tokenIn, order.tokenOut, order.amountIn);
        } else if (dex === 'meteora') {
            finalQuote = await this.getMeteoraQuote(order.tokenIn, order.tokenOut, order.amountIn);
        } else {
            throw new Error(`Unsupported DEX: ${dex}`);
        }

        // Calculate final execution price with slippage (simulate 0-0.5% additional slippage)
        const slippageFactor = 1 - (Math.random() * 0.005);
        const finalPrice = finalQuote.price * slippageFactor;
        const actualAmountOut = BigInt(order.amountIn) * BigInt(Math.floor(finalPrice));

        console.log(`Swap completed`);
        console.log(`Transaction: ${txHash}`);
        console.log(`Final Price: ${finalPrice.toFixed(6)} ${order.tokenOut}`);

        return {
            success: true,
            txHash,
            executedPrice: parseFloat(finalPrice.toFixed(6)),
            actualAmountOut: parseFloat(Number(actualAmountOut).toFixed(6))
        };
    }
}