import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import dotenv from 'dotenv';
import { Database } from './database/connection';
import { OrderQueue } from './services/queue';
import { OrderExecutionEngine } from './services/orderExecutionEngine';
import { WebSocketManager } from './services/websocketManager';
import { SolanaConnectionManager } from './services/solanaConnection';
import { orderRoutes } from './routes/orders';

// Load environment variables
dotenv.config();

const PORT = parseInt(process.env.PORT!);
const DATABASE_URL = process.env.DATABASE_URL!;
const REDIS_URL = process.env.REDIS_URL;
const REDIS_HOST = process.env.REDIS_HOST!;
const REDIS_PORT = parseInt(process.env.REDIS_PORT!);
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;

async function startServer() {
  // Create Fastify instance
  const server = Fastify({
    logger: true
  });

  try {
    // Register WebSocket plugin
    await server.register(websocket);

    // Initialize database connection
    const database = new Database(DATABASE_URL);
    await database.connect();

    const solanaManager = new SolanaConnectionManager(SOLANA_RPC_URL, PRIVATE_KEY);

    // Verify connection and wallet balance
    const isReady = await solanaManager.checkConnection();
    if (!isReady) {
      throw new Error('Solana connection failed or insufficient balance');
    }

    const wsManager = new WebSocketManager(server, database);

    // Initialize order execution engine
    const executionEngine = new OrderExecutionEngine(database, solanaManager, wsManager);

    // Initialize order queue with Redis
    const orderQueue = new OrderQueue(
      {
        host: REDIS_HOST,
        port: REDIS_PORT,
        url: REDIS_URL
      },
      executionEngine
    );

    // Register API routes
    await server.register(orderRoutes, {
      database,
      orderQueue,
      executionEngine
    });

    // Health check endpoint
    server.get('/health', async (request, reply) => {
      try {
        // Check database connection
        await database.getActiveOrders();

        // Check queue stats
        const queueStats = await orderQueue.getQueueStats();

        return {
          status: 'healthy',
          timestamp: new Date(),
          services: {
            database: 'connected',
            redis: 'connected',
            queue: queueStats
          }
        };
      } catch (error) {
        reply.code(503).send({
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date()
        });
      }
    });

    // Root endpoint with API information
    server.get('/', async (request, reply) => {
      return {
        name: 'Eterna Order Execution Engine',
        description: 'DEX order execution engine with Raydium and Meteora routing',
        endpoints: {
          'POST /api/orders/execute': 'Submit a new market order',
          'GET /api/orders/:orderId': 'Get order details',
          'WebSocket /ws/:orderId': 'Real-time order updates'
        },
      };
    });

    // Start server
    await server.listen({ port: PORT, host: '0.0.0.0' });

    server.log.info(`Eterna Order Execution Engine started on port ${PORT}`);
    server.log.info('Available endpoints:');
    server.log.info('- POST /api/orders/execute - Submit market order');
    server.log.info('- GET /api/orders/:orderId - Get order status');

    // Setup heartbeat for WebSocket connections (every 30 seconds)
    setInterval(() => {
      wsManager.sendHeartbeat();
    }, 30000);

  } catch (error) {
    console.error('Detailed server startup error:', error);
  }
}

// Start the server
startServer().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
