import { MockDexRouter } from '../services/mockDexRouter';
import { Order, OrderType, OrderStatus } from '../types';

describe('MockDexRouter - Routing Logic Tests', () => {
    let router: MockDexRouter;

    beforeEach(() => {
        router = new MockDexRouter();
        Math.random = jest.fn().mockReturnValue(0.1); // Force success (> 0.05)
        // Mock sleep to speed up tests
        jest.spyOn(require('../utils/errorHandler'), 'sleep').mockImplementation(() => Promise.resolve());
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('should get Raydium quote with correct structure', async () => {
        const quote = await router.getRaydiumQuote('SOL', 'USDC', '10');

        expect(quote).toHaveProperty('price');
        expect(quote).toHaveProperty('fee');
        expect(quote.price).toBeGreaterThan(0);
        expect(quote.fee).toBe(0.003);
        expect(typeof quote.price).toBe('number');
        expect(typeof quote.fee).toBe('number');
    });

    test('should get Meteora quote with correct structure', async () => {
        const quote = await router.getMeteoraQuote('SOL', 'USDC', '10');

        expect(quote).toHaveProperty('price');
        expect(quote).toHaveProperty('fee');
        expect(quote.price).toBeGreaterThan(0);
        expect(quote.fee).toBe(0.002);
        expect(typeof quote.price).toBe('number');
        expect(typeof quote.fee).toBe('number');
    });

    test('should select best DEX based on effective price calculation', async () => {
        const result = await router.selectBestDex('SOL', 'USDC', '10');

        expect(result).toHaveProperty('dex');
        expect(result).toHaveProperty('bestQuote');
        expect(result).toHaveProperty('allQuotes');
        expect(result).toHaveProperty('routingReason');

        expect(['raydium', 'meteora']).toContain(result.dex);
        expect(result.allQuotes).toHaveLength(2);
        expect(result.routingReason).toContain(result.dex);
        expect(result.routingReason).toContain('more');
    });

    test('should include both DEX quotes in routing result', async () => {
        const result = await router.selectBestDex('SOL', 'USDC', '5');

        const raydiumQuote = result.allQuotes.find(q => q.dex === 'raydium');
        const meteoraQuote = result.allQuotes.find(q => q.dex === 'meteora');

        expect(raydiumQuote).toBeDefined();
        expect(meteoraQuote).toBeDefined();
        expect(raydiumQuote!.fee).toBe(0.003);
        expect(meteoraQuote!.fee).toBe(0.002);
    });

    test('should execute swap successfully with valid order', async () => {
        const order: Order = {
            id: 'test-order',
            type: OrderType.MARKET,
            tokenIn: 'SOL',
            tokenOut: 'USDC',
            tokenInMint: 'So11111111111111111111111111111111111111112',
            tokenOutMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            amountIn: '1',
            status: OrderStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
            retryCount: 0
        };

        const result = await router.executeSwap('raydium', order);

        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('txHash');
        expect(result).toHaveProperty('executedPrice');
        expect(result).toHaveProperty('actualAmountOut');
        expect(result.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{88}$/); // Base58 format
        expect(result.executedPrice).toBeGreaterThan(0);
        expect(result.actualAmountOut).toBeGreaterThan(0);
    });

    test('should handle execution failures gracefully', async () => {
        const order: Order = {
            id: 'test-order',
            type: OrderType.MARKET,
            tokenIn: 'SOL',
            tokenOut: 'USDC',
            tokenInMint: 'So11111111111111111111111111111111111111112',
            tokenOutMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            amountIn: '1',
            status: OrderStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
            retryCount: 0
        };

        // Mock Math.random to force failure
        const originalRandom = Math.random;
        Math.random = jest.fn().mockReturnValue(0.01); // Force failure (< 0.05)

        const result = await router.executeSwap('meteora', order);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Swap failed');
        expect(result.txHash).toBeUndefined();

        Math.random = originalRandom;
    });

    test('should throw error for unsupported DEX', async () => {
        const order: Order = {
            id: 'test-order',
            type: OrderType.MARKET,
            tokenIn: 'SOL',
            tokenOut: 'USDC',
            tokenInMint: 'So11111111111111111111111111111111111111112',
            tokenOutMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            amountIn: '1',
            status: OrderStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
            retryCount: 0
        };

        await expect(router.executeSwap('unsupported-dex', order))
            .rejects.toThrow('Unsupported DEX: unsupported-dex');
    });
});
