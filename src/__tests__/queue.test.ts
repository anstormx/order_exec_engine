import { OrderQueue } from '../services/queue';
import { OrderExecutionEngine } from '../services/orderExecutionEngine';
import { Order, OrderType, OrderStatus } from '../types';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

// Mock dependencies
jest.mock('bullmq');
jest.mock('ioredis');
jest.mock('../database/connection');
jest.mock('../services/websocketManager');
jest.mock('../services/solanaConnection');
jest.mock('../services/orderExecutionEngine');

describe('OrderQueue - Queue Behavior Tests', () => {
    let orderQueue: OrderQueue;
    let mockExecutionEngine: jest.Mocked<OrderExecutionEngine>;
    let mockQueue: jest.Mocked<Queue>;
    let mockWorker: jest.Mocked<Worker>;
    let mockRedis: jest.Mocked<Redis>;

    beforeEach(() => {
        // Setup mocks
        mockRedis = new Redis() as jest.Mocked<Redis>;
        mockQueue = {
            add: jest.fn().mockResolvedValue({ id: 'job-123' }),
            getWaiting: jest.fn().mockResolvedValue([]),
            getActive: jest.fn().mockResolvedValue([]),
            getCompleted: jest.fn().mockResolvedValue([]),
            getFailed: jest.fn().mockResolvedValue([]),
            pause: jest.fn().mockResolvedValue(undefined),
            resume: jest.fn().mockResolvedValue(undefined),
            close: jest.fn().mockResolvedValue(undefined),
            on: jest.fn()
        } as any;

        mockWorker = {
            on: jest.fn(),
            close: jest.fn().mockResolvedValue(undefined)
        } as any;

        (Queue as unknown as jest.Mock).mockImplementation(() => mockQueue);
        (Worker as unknown as jest.Mock).mockImplementation(() => mockWorker);
        (Redis as unknown as jest.Mock).mockImplementation(() => mockRedis);

        mockExecutionEngine = new OrderExecutionEngine({} as any, {} as any, {} as any) as jest.Mocked<OrderExecutionEngine>;
        mockExecutionEngine.processOrder = jest.fn().mockResolvedValue(undefined);

        orderQueue = new OrderQueue(
            { host: 'localhost', port: 6379 },
            mockExecutionEngine
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('should initialize queue with correct configuration', () => {
        expect(Queue).toHaveBeenCalledWith('order-execution', {
            connection: mockRedis,
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 2000,
                },
            },
        });
    });

    test('should initialize worker with correct concurrency and rate limiting', () => {
        expect(Worker).toHaveBeenCalledWith(
            'order-execution',
            expect.any(Function),
            {
                connection: mockRedis,
                concurrency: 10, // Process up to 10 orders concurrently
                limiter: {
                    max: 100, // 100 jobs per minute
                    duration: 60000,
                },
            }
        );
    });

    test('should add order to queue with correct priority', async () => {
        const order: Order = {
            id: 'test-order-1',
            type: OrderType.MARKET,
            tokenIn: 'SOL',
            tokenOut: 'USDC',
            tokenInMint: 'So11111111111111111111111111111111111111112',
            tokenOutMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            amountIn: '10',
            status: OrderStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
            retryCount: 0
        };

        await orderQueue.addOrder(order);

        expect(mockQueue.add).toHaveBeenCalledWith(
            `order-${order.id}`,
            {
                orderId: order.id,
                order
            },
            {
                priority: 1, // Market order priority
                delay: 0,
            }
        );
    });

    test('should assign correct priorities to different order types', async () => {
        const marketOrder: Order = {
            id: 'market-order',
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

        const limitOrder: Order = {
            id: 'limit-order',
            type: OrderType.LIMIT,
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

        const sniperOrder: Order = {
            id: 'sniper-order',
            type: OrderType.SNIPER,
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

        await orderQueue.addOrder(marketOrder);
        await orderQueue.addOrder(limitOrder);
        await orderQueue.addOrder(sniperOrder);

        expect(mockQueue.add).toHaveBeenNthCalledWith(1, 'order-market-order', expect.any(Object),
            expect.objectContaining({ priority: 1 }));
        expect(mockQueue.add).toHaveBeenNthCalledWith(2, 'order-limit-order', expect.any(Object),
            expect.objectContaining({ priority: 2 }));
        expect(mockQueue.add).toHaveBeenNthCalledWith(3, 'order-sniper-order', expect.any(Object),
            expect.objectContaining({ priority: 0 })); // Highest priority
    });

    test('should return correct queue statistics', async () => {
        mockQueue.getWaiting.mockResolvedValue(new Array(5));
        mockQueue.getActive.mockResolvedValue(new Array(3));
        mockQueue.getCompleted.mockResolvedValue(new Array(10));
        mockQueue.getFailed.mockResolvedValue(new Array(2));

        const stats = await orderQueue.getQueueStats();

        expect(stats).toEqual({
            waiting: 5,
            active: 3,
            completed: 10,
            failed: 2
        });
    });

    test('should pause and resume queue correctly', async () => {
        await orderQueue.pauseQueue();
        expect(mockQueue.pause).toHaveBeenCalled();

        await orderQueue.resumeQueue();
        expect(mockQueue.resume).toHaveBeenCalled();
    });

    test('should setup event listeners for worker events', () => {
        expect(mockWorker.on).toHaveBeenCalledWith('completed', expect.any(Function));
        expect(mockWorker.on).toHaveBeenCalledWith('failed', expect.any(Function));
        expect(mockWorker.on).toHaveBeenCalledWith('stalled', expect.any(Function));
    });

    test('should setup event listeners for queue and redis events', () => {
        expect(mockQueue.on).toHaveBeenCalledWith('error', expect.any(Function));
        expect(mockRedis.on).toHaveBeenCalledWith('error', expect.any(Function));
        expect(mockRedis.on).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    test('should close all connections properly', async () => {
        await orderQueue.close();

        expect(mockWorker.close).toHaveBeenCalled();
        expect(mockQueue.close).toHaveBeenCalled();
        expect(mockRedis.quit).toHaveBeenCalled();
    });

    test('should handle concurrent order processing within limits', async () => {
        // Simulate adding multiple orders
        const orders = Array.from({ length: 15 }, (_, i) => ({
            id: `concurrent-order-${i}`,
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
        }));

        // Add all orders
        const addPromises = orders.map(order => orderQueue.addOrder(order));
        await Promise.all(addPromises);

        // Verify all orders were added
        expect(mockQueue.add).toHaveBeenCalledTimes(15);

        // Worker should be configured to process max 10 concurrently
        const workerConfig = (Worker as unknown as jest.Mock).mock.calls[0][2];
        expect(workerConfig.concurrency).toBe(10);
    });
});
