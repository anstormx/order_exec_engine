import { FastifyInstance } from 'fastify';
import { orderRoutes } from '../routes/orders';
import { WebSocketManager } from '../services/websocketManager';
import { Database } from '../database/connection';
import { OrderQueue } from '../services/queue';
import { OrderExecutionEngine } from '../services/orderExecutionEngine';
import { MockDexRouter } from '../services/mockDexRouter';
import { SolanaConnectionManager } from '../services/solanaConnection';

// Mock external dependencies
jest.mock('../database/connection');
jest.mock('../services/solanaConnection');
jest.mock('ioredis');
jest.mock('bullmq');

describe('Integration Tests - API and WebSocket', () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    // Build the app
    app = await build({ logger: false });
    
    // Start the server
    await app.listen({ port: 0 });
    const address = app.server.address();
    if (address && typeof address !== 'string') {
      port = address.port;
    }
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  test('should accept valid order submission', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orders/execute',
      payload: {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 10
      }
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('orderId');
    expect(body).toHaveProperty('status', 'pending');
    expect(body).toHaveProperty('message', 'Order submitted successfully');
    expect(body).toHaveProperty('websocketUrl');
    expect(body.websocketUrl).toMatch(/^\/ws\/.+$/);
  });

  test('should reject invalid order - missing tokenIn', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orders/execute',
      payload: {
        tokenOut: 'USDC',
        amountIn: 10
      }
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('error');
  });

  test('should reject invalid order - zero amount', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orders/execute',
      payload: {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 0
      }
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('error', 'Invalid order');
  });

  test('should reject invalid order - same tokens', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orders/execute',
      payload: {
        tokenIn: 'USDC',
        tokenOut: 'USDC',
        amountIn: 5
      }
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('error', 'Invalid order');
  });

  test('should reject invalid order - invalid amount', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orders/execute',
      payload: {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 'invalid-amount' // Should be number
      }
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('error');
  });

  test('should handle concurrent order submissions', async () => {
    const orderPromises = Array.from({ length: 10 }, (_, i) => 
      app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        payload: {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amountIn: i + 1
        }
      })
    );

    const responses = await Promise.all(orderPromises);

    responses.forEach(response => {
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('orderId');
      expect(body.status).toBe('pending');
    });

    // All orders should have unique IDs
    const orderIds = responses.map(r => JSON.parse(r.body).orderId);
    const uniqueIds = new Set(orderIds);
    expect(uniqueIds.size).toBe(orderIds.length);
  });

  test('should get order details by ID', async () => {
    // First create an order
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/orders/execute',
      payload: {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 7
      }
    });

    const { orderId } = JSON.parse(createResponse.body);

    // Then get the order details
    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/orders/${orderId}`
    });

    expect(getResponse.statusCode).toBe(200);
    const order = JSON.parse(getResponse.body);
    expect(order).toHaveProperty('order');
    expect(order).toHaveProperty('websocketUrl', `/ws/${orderId}`);
    expect(order.order.id).toBe(orderId);
  });

  test('should return 404 for non-existent order', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/orders/non-existent-id'
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('error', 'Order not found');
  });

  test('should handle health check endpoint', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('status', 'ok');
    expect(body).toHaveProperty('timestamp');
  });
});

// Helper function to build app with real services
async function build(opts: any): Promise<FastifyInstance> {
  const fastify = require('fastify')(opts);
  
  // Register WebSocket support
  await fastify.register(require('@fastify/websocket'));
  
  // Create mock services
  const mockDatabase = new Database('test') as jest.Mocked<Database>;
  const mockDexRouter = new MockDexRouter();
  const mockSolanaManager = new SolanaConnectionManager('https://api.mainnet-beta.solana.com', 'test-key') as jest.Mocked<SolanaConnectionManager>;
  const mockWebSocketManager = new WebSocketManager(fastify, mockDatabase);
  const mockExecutionEngine = new OrderExecutionEngine(mockDatabase, mockSolanaManager, mockWebSocketManager);
  const mockOrderQueue = new OrderQueue({ host: 'localhost', port: 6379 }, mockExecutionEngine);
  
  // Mock database methods
  mockDatabase.createOrder = jest.fn().mockResolvedValue(undefined);
  mockDatabase.getOrder = jest.fn().mockImplementation((orderId: string) => {
    if (orderId === 'non-existent-id' || orderId === 'non-existent-order') {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      id: orderId,
      type: 'market' as any,
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 10,
      status: 'pending' as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      retryCount: 0
    });
  });
  mockDatabase.updateOrderStatus = jest.fn().mockResolvedValue(undefined);
  
  // Mock queue methods
  mockOrderQueue.addOrder = jest.fn().mockResolvedValue(undefined);
  
  // Register order routes with real implementation
  await fastify.register(orderRoutes, {
    database: mockDatabase,
    orderQueue: mockOrderQueue,
    executionEngine: mockExecutionEngine
  });
  
  // Health check endpoint
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date() };
  });
  
  return fastify;
}
