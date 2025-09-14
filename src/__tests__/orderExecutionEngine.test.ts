import { OrderExecutionEngine } from '../services/orderExecutionEngine';
import { Database } from '../database/connection';
import { WebSocketManager } from '../services/websocketManager';
import { SolanaConnectionManager } from '../services/solanaConnection';
import { Order, OrderType, OrderStatus } from '../types';
import { retryWithBackoff } from '../utils/errorHandler';

// Mock dependencies
jest.mock('../database/connection');
jest.mock('../services/websocketManager');
jest.mock('../services/solanaConnection');
jest.mock('../services/mockDexRouter');
jest.mock('../utils/errorHandler');

describe('OrderExecutionEngine - Integration Tests', () => {
  let engine: OrderExecutionEngine;
  let mockDatabase: jest.Mocked<Database>;
  let mockWsManager: jest.Mocked<WebSocketManager>;
  let mockSolanaManager: jest.Mocked<SolanaConnectionManager>;
  let mockRetryWithBackoff: jest.MockedFunction<typeof retryWithBackoff>;

  beforeEach(() => {
    mockDatabase = new Database('test') as jest.Mocked<Database>;
    mockWsManager = {
      broadcastOrderUpdate: jest.fn()
    } as any;
    mockSolanaManager = {} as any;

    mockRetryWithBackoff = retryWithBackoff as jest.MockedFunction<typeof retryWithBackoff>;
    mockRetryWithBackoff.mockImplementation(async (fn) => await fn());

    mockDatabase.updateOrderStatus = jest.fn().mockResolvedValue(undefined);

    engine = new OrderExecutionEngine(mockDatabase, mockSolanaManager, mockWsManager);

    Math.random = jest.fn().mockReturnValue(0.1); // Force success
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should validate market order correctly', () => {
    const validOrder: Order = {
      id: 'valid-order',
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

    const result = engine.validateMarketOrder(validOrder);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('should reject invalid market order - missing tokens', () => {
    const invalidOrder: Order = {
      id: 'invalid-order',
      type: OrderType.MARKET,
      tokenIn: '',
      tokenOut: 'USDC',
      tokenInMint: 'So11111111111111111111111111111111111111112',
      tokenOutMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amountIn: '10',
      status: OrderStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      retryCount: 0
    };

    const result = engine.validateMarketOrder(invalidOrder);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('Token addresses are required');
  });

  test('should reject invalid market order - same tokens', () => {
    const invalidOrder: Order = {
      id: 'invalid-order',
      type: OrderType.MARKET,
      tokenIn: 'USDC',
      tokenOut: 'USDC',
      tokenInMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      tokenOutMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amountIn: '10',
      status: OrderStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      retryCount: 0
    };

    const result = engine.validateMarketOrder(invalidOrder);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('Input and output tokens must be different');
  });

  test('should reject invalid market order - zero amount', () => {
    const invalidOrder: Order = {
      id: 'invalid-order',
      type: OrderType.MARKET,
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      tokenInMint: 'So11111111111111111111111111111111111111112',
      tokenOutMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amountIn: '0',
      status: OrderStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      retryCount: 0
    };

    const result = engine.validateMarketOrder(invalidOrder);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('Amount must be greater than zero');
  });

  test('should reject non-market order type', () => {
    const limitOrder: Order = {
      id: 'limit-order',
      type: OrderType.LIMIT,
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

    const result = engine.validateMarketOrder(limitOrder);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('This engine only processes market orders');
  });

  test('should process order through complete lifecycle', async () => {
    const order: Order = {
      id: 'lifecycle-test',
      type: OrderType.MARKET,
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      tokenInMint: 'So11111111111111111111111111111111111111112',
      tokenOutMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amountIn: '5',
      status: OrderStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      retryCount: 0
    };

    // Mock successful routing and execution
    mockRetryWithBackoff
      .mockResolvedValueOnce({
        dex: 'raydium',
        bestQuote: { dex: 'raydium', price: 1.05, fee: 0.003 },
        allQuotes: [],
        routingReason: 'Best price'
      })
      .mockResolvedValue(undefined); // For building transaction

    // Mock the dexRouter executeSwap method directly on the engine instance
    const dexRouterInstance = (engine as any).dexRouter;
    dexRouterInstance.executeSwap = jest.fn().mockResolvedValue({
      success: true,
      txHash: 'mock-tx-hash',
      executedPrice: 1.05,
      actualAmountOut: 5.25
    });

    await engine.processOrder(order);

    // Verify all status updates were called (they include additional data parameter)
    expect(mockDatabase.updateOrderStatus).toHaveBeenCalledWith(
      order.id,
      OrderStatus.ROUTING,
      expect.any(Object)
    );
    expect(mockDatabase.updateOrderStatus).toHaveBeenCalledWith(
      order.id,
      OrderStatus.BUILDING,
      expect.any(Object)
    );
    expect(mockDatabase.updateOrderStatus).toHaveBeenCalledWith(
      order.id,
      OrderStatus.SUBMITTED,
      expect.any(Object)
    );
    expect(mockDatabase.updateOrderStatus).toHaveBeenCalledWith(
      order.id,
      OrderStatus.CONFIRMED,
      expect.objectContaining({
        txHash: 'mock-tx-hash'
      })
    );

    // Verify WebSocket updates were sent
    expect(mockWsManager.broadcastOrderUpdate).toHaveBeenCalledTimes(4);
  });

  test('should handle order execution failure', async () => {
    const order: Order = {
      id: 'failure-test',
      type: OrderType.MARKET,
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      tokenInMint: 'So11111111111111111111111111111111111111112',
      tokenOutMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amountIn: '5',
      status: OrderStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      retryCount: 0
    };

    // Mock routing success but execution failure
    mockRetryWithBackoff
      .mockResolvedValueOnce({
        dex: 'meteora',
        bestQuote: { dex: 'meteora', price: 1.02, fee: 0.002 },
        allQuotes: [],
        routingReason: 'Lower fees'
      })
      .mockResolvedValue(undefined); // For building transaction

    const dexRouterInstance = (engine as any).dexRouter;
    dexRouterInstance.executeSwap = jest.fn().mockResolvedValue({
      success: false,
      error: 'Execution failed due to slippage'
    });

    await engine.processOrder(order);

    // Verify failure was handled - check the last call for FAILED status
    const statusCalls = mockDatabase.updateOrderStatus.mock.calls;
    const failedCall = statusCalls.find(call => call[1] === OrderStatus.FAILED);
    expect(failedCall).toBeTruthy();
    if (failedCall) {
      expect(failedCall[2]).toEqual(expect.objectContaining({
        errorMessage: 'Execution failed due to slippage'
      }));
    }

    expect(mockWsManager.broadcastOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: order.id,
        status: OrderStatus.FAILED
      })
    );
  });

  test('should update database and WebSocket for each status change', async () => {
    const order: Order = {
      id: 'status-update-test',
      type: OrderType.MARKET,
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      tokenInMint: 'So11111111111111111111111111111111111111112',
      tokenOutMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amountIn: '2',
      status: OrderStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      retryCount: 0
    };

    // Mock successful execution - reset mocks first
    mockRetryWithBackoff.mockReset();
    mockRetryWithBackoff
      .mockResolvedValueOnce({
        dex: 'meteora',
        bestQuote: { dex: 'meteora', price: 1.01, fee: 0.002 },
        allQuotes: [],
        routingReason: 'Best execution'
      })
      .mockResolvedValue(undefined); // For building transaction

    const dexRouterInstance = (engine as any).dexRouter;
    dexRouterInstance.executeSwap = jest.fn().mockResolvedValue({
      success: true,
      txHash: 'success-tx-hash',
      executedPrice: 1.01,
      actualAmountOut: 2.02
    });

    await engine.processOrder(order);

    // Verify database updates for each status
    const statusUpdates = mockDatabase.updateOrderStatus.mock.calls;
    expect(statusUpdates).toHaveLength(4);
    expect(statusUpdates[0][1]).toBe(OrderStatus.ROUTING);
    expect(statusUpdates[1][1]).toBe(OrderStatus.BUILDING);
    expect(statusUpdates[2][1]).toBe(OrderStatus.SUBMITTED);
    expect(statusUpdates[3][1]).toBe(OrderStatus.CONFIRMED);

    // Verify WebSocket broadcasts for each status
    const wsUpdates = mockWsManager.broadcastOrderUpdate.mock.calls;
    expect(wsUpdates).toHaveLength(4);
    expect(wsUpdates[0][0].status).toBe(OrderStatus.ROUTING);
    expect(wsUpdates[1][0].status).toBe(OrderStatus.BUILDING);
    expect(wsUpdates[2][0].status).toBe(OrderStatus.SUBMITTED);
    expect(wsUpdates[3][0].status).toBe(OrderStatus.CONFIRMED);
  });
});
