import { PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram } from '@solana/web3.js';
import {
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    NATIVE_MINT,
    createSyncNativeInstruction,
    createCloseAccountInstruction,
    getAccount,
    getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { DexQuote, RouteResult, ExecutionResult, Order } from '../types';
import { SolanaConnectionManager } from './solanaConnection';
import { ApiV3PoolInfoStandardItem, Raydium, TxVersion } from '@raydium-io/raydium-sdk-v2';
import { AmmImpl } from '@meteora-ag/dynamic-amm-sdk';
import BN from 'bn.js';
import { ethers } from 'ethers';

export const TOKEN_MINTS = {
    SOL: {
        mint: NATIVE_MINT.toString(),
        decimals: 9
    },
    USDC: {
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        decimals: 6
    }
  };

export class dexRouter {
    private solanaManager: SolanaConnectionManager;
    private initialized = false;
    private raydium: Raydium | null = null;
    private meteora: AmmImpl | null = null;

    // Pool addresses as PublicKeys
    private readonly POOL_ADDRESSES = {
        raydium: '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2', // Raydium SOL/USDC pool
        meteora: '6SWtsTzXrurtVWZdEHvnQdE9oM8tTtyg8rfEo3b4nM93'  // Meteora SOL/USDC pool
    };

    constructor(solanaManager: SolanaConnectionManager) {
        this.solanaManager = solanaManager;
    }

    /**
     * Initialize the DEX router
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        // Initialize Raydium SDK
        try {
            this.raydium = await Raydium.load({
                owner: this.solanaManager.wallet,
                connection: this.solanaManager.connection,
                cluster: 'mainnet',
                blockhashCommitment: 'finalized',
                disableFeatureCheck: true,
            });

            this.raydium.account.updateTokenAccount(await this.solanaManager.fetchTokenAccountData())

            console.log('Raydium SDK initialized');
        } catch (error) {
            console.warn('Raydium SDK initialization failed:', error);
        }

        // Initialize Meteora SDK
        try {
            // Initialize Meteora SDK for specific pool
            this.meteora = await AmmImpl.create(
                this.solanaManager.connection as any, // Type assertion to handle compatibility
                new PublicKey(this.POOL_ADDRESSES.meteora)
            );
        } catch (error) {
            console.warn('Meteora SDK initialization failed:', error);
        }

        this.initialized = true;
        console.log('DEX Router initialized successfully');
    }

    /**
     * Get quote from Raydium
     */
    async getRaydiumQuote(tokenIn: string, tokenOut: string, amount: string): Promise<DexQuote> {
        console.log(`Getting Raydium quote: ${amount} ${tokenIn} -> ${tokenOut}`);

        try {
            if (!this.raydium) {
                throw new Error('Raydium SDK not initialized');
            }

            // Get RPC data for more accurate calculations
            const data = await this.raydium.api.fetchPoolById({ ids: this.POOL_ADDRESSES.raydium })
            const poolInfo = data[0] as ApiV3PoolInfoStandardItem

            const normalizedPrice = tokenIn === 'SOL' ? poolInfo.price : 1 / poolInfo.price;

            const quote: DexQuote = {
                dex: 'raydium',
                price: normalizedPrice,
            };

            return quote;
        } catch (error) {
            console.error('Raydium quote failed:', error);
            throw new Error(`Raydium quote failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get quote from Meteora
     */
    async getMeteoraQuote(tokenIn: string, tokenOut: string, amount: string): Promise<DexQuote> {
        try {
            console.log(`Getting Meteora quote: ${amount} ${tokenIn} -> ${tokenOut}`);

            if (!this.meteora) {
                throw new Error('Meteora SDK not initialized');
            }

            // Get quote for 1 SOL input to get USDC output
            const quote = this.meteora.getSwapQuote(new PublicKey(TOKEN_MINTS["SOL"].mint), new BN(ethers.parseUnits("1", 9)), 0);
            const usdcPerSol = parseFloat(ethers.formatUnits(quote.swapOutAmount.toString(), 6));

            const normalizedPrice = tokenIn === 'SOL' ? usdcPerSol : 1 / usdcPerSol;

            const dexQuote: DexQuote = {
                dex: 'meteora',
                price: normalizedPrice,
            };

            return dexQuote;
        } catch (error) {
            console.error('Meteora quote failed:', error);
            throw new Error(`Meteora quote failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Route order to the best DEX
     */
    async selectBestDex(tokenIn: string, tokenOut: string, amount: string): Promise<RouteResult> {
        console.log(`Routing order: ${amount} ${tokenIn} -> ${tokenOut}`);

        await this.initialize();

        try {
            // Get quotes from both DEXs with retry logic
            const [raydiumQuote, meteoraQuote] = await Promise.all([
                this.getRaydiumQuote(tokenIn, tokenOut, amount),
                this.getMeteoraQuote(tokenIn, tokenOut, amount)
            ]);

            console.log('Raydium quotes:', raydiumQuote);
            console.log('Meteora quotes:', meteoraQuote);

            let bestQuote: DexQuote;
            let routingReason: string;

            // Select the best DEX - higher normalized price is always better
            if (raydiumQuote.price > meteoraQuote.price) {
                bestQuote = raydiumQuote;
                routingReason = `raydium selected: better effective price (${raydiumQuote.price.toFixed(6)} vs ${meteoraQuote.price.toFixed(6)})`;
            } else {
                bestQuote = meteoraQuote;
                routingReason = `meteora selected: better effective price (${meteoraQuote.price.toFixed(6)} vs ${raydiumQuote.price.toFixed(6)})`;
            }

            return {
                dex: bestQuote.dex,
                bestQuote: bestQuote,
                allQuotes: [raydiumQuote, meteoraQuote],
                routingReason: routingReason
            };

        } catch (error) {
            console.error('DEX routing failed:', error);
            throw new Error(`DEX routing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Execute swap on the selected DEX using real SDK
     */
    async executeSwap(dex: string, order: Order): Promise<ExecutionResult> {
        console.log(`Executing ${dex} swap on Solana for order ${order.id}`);

        try {
            return dex === 'raydium' ? await this.executeRaydiumSwap(order) : await this.executeMeteorSwap(order);
        } catch (error) {
            console.error(`${dex} swap execution failed:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown execution error'
            };
        }
    }

    /**
     * Execute Raydium swap using real SDK
     */
    private async executeRaydiumSwap(order: Order): Promise<ExecutionResult> {
        if (!this.raydium) {
            throw new Error('Raydium SDK not initialized');
        }

        const inputToken = TOKEN_MINTS[order.tokenIn as keyof typeof TOKEN_MINTS];
        const outputToken = TOKEN_MINTS[order.tokenOut as keyof typeof TOKEN_MINTS];
        const poolId = this.POOL_ADDRESSES.raydium;

        try {
            // Get pool info
            const data = await this.raydium.api.fetchPoolById({ ids: poolId })
            const poolInfo = data[0] as ApiV3PoolInfoStandardItem
            const poolKeys = await this.raydium.liquidity.getAmmPoolKeys(poolId)
            const rpcData = await this.raydium.liquidity.getRpcPoolInfo(poolId)

            const [baseReserve, quoteReserve, status] = [rpcData.baseReserve, rpcData.quoteReserve, rpcData.status.toNumber()]

            // swap pool mintA for mintB
            const out = this.raydium.liquidity.computeAmountOut({
                poolInfo: {
                    ...poolInfo,
                    baseReserve,
                    quoteReserve,
                    status,
                    version: 4,
                },
                amountIn: new BN(order.amountIn),
                mintIn: inputToken.mint,
                mintOut: outputToken.mint,
                slippage: 0.01, // range: 1 ~ 0.0001, means 100% ~ 0.01%
            })

            console.log('Out:', out);

            const { execute } = await this.raydium.liquidity.swap({
                poolInfo,
                poolKeys,
                amountIn: new BN(order.amountIn),
                amountOut: out.minAmountOut, // out.amountOut means amount 'without' slippage
                fixedSide: 'in',
                inputMint: inputToken.mint,
                txVersion: TxVersion.V0,
            })

            const { txId } = await execute({ sendAndConfirm: true })
            console.log('Swap transaction signature: https://solscan.io/tx/' + txId);

            return {
                success: true,
                txHash: txId,
                executedPrice: inputToken.decimals == 9 ? poolInfo.price : 1 / poolInfo.price,
                actualAmountOut: parseFloat(ethers.formatUnits(out.minAmountOut.toString(), outputToken.decimals)),
            };

        } catch (error) {
            console.error('Raydium swap execution failed:', error);
            throw error;
        }
    }

    /**
     * Execute Meteora swap using real SDK
     */
    private async executeMeteorSwap(order: Order): Promise<ExecutionResult> {
        const inputToken = TOKEN_MINTS[order.tokenIn as keyof typeof TOKEN_MINTS];
        const outputToken = TOKEN_MINTS[order.tokenOut as keyof typeof TOKEN_MINTS];

        try {
            if (!this.meteora) {
                throw new Error('Meteora SDK not initialized');
            }
            const priceQuote = this.meteora.getSwapQuote(new PublicKey(TOKEN_MINTS["SOL"].mint), new BN(ethers.parseUnits("1", 9)), 0);
            const usdcPerSol = parseFloat(ethers.formatUnits(priceQuote.swapOutAmount.toString(), 6));

            const quote = this.meteora.getSwapQuote(new PublicKey(inputToken.mint), new BN(order.amountIn), 0.01);

            const swapTx = await this.meteora.swap(
                this.solanaManager.wallet.publicKey,
                new PublicKey(inputToken.mint),
                new BN(order.amountIn),
                new BN(0));

            swapTx.sign(this.solanaManager.wallet);
            const sig = await this.solanaManager.connection.sendRawTransaction(swapTx.serialize());

            console.log('Swap transaction signature: https://solscan.io/tx/' + sig);

            return {
                success: true,
                txHash: sig,
                executedPrice: inputToken.decimals == 9 ? usdcPerSol : 1 / usdcPerSol,
                actualAmountOut: parseFloat(ethers.formatUnits(quote.swapOutAmount.toString(), outputToken.decimals)),
            };

        } catch (error) {
            console.error('Meteora swap execution failed:', error);
            throw error;
        }
    }
}