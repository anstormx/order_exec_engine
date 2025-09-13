import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { Order, OrderRequest, OrderType, OrderStatus } from '../types';
import { Database } from '../database/connection';
import { OrderQueue } from '../services/queue';
import { OrderExecutionEngine } from '../services/orderExecutionEngine';
import { executeOrderSchema } from '../models/schema';

interface OrderRouteContext {
  database: Database;
  orderQueue: OrderQueue;
  executionEngine: OrderExecutionEngine;
}

export async function orderRoutes(
  fastify: FastifyInstance,
  context: OrderRouteContext
): Promise<void> {
  const { database, orderQueue, executionEngine } = context;

  /**
   * POST /api/orders/execute
   * Submit a new market order for execution
   */
  fastify.post<{ Body: OrderRequest }>('/api/orders/execute', {
    schema: executeOrderSchema,
    handler: async (request: FastifyRequest<{ Body: OrderRequest }>, reply: FastifyReply) => {
      try {
        const { tokenIn, tokenOut, amountIn } = request.body;

        // Create order object
        const order: Order = {
          id: uuidv4(),
          type: OrderType.MARKET,
          tokenIn,
          tokenOut,
          amountIn,
          status: OrderStatus.PENDING,
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // Validate market order
        const validation = executionEngine.validateMarketOrder(order);
        if (!validation.isValid) {
          return reply.code(400).send({
            error: 'Invalid order',
            message: validation.error
          });
        }

        // Save order to database
        await database.createOrder(order);

        // Add to execution queue
        await orderQueue.addOrder(order);

        console.log(`Order ${order.id} submitted successfully`);

        // Return order ID and WebSocket URL
        reply.code(201).send({
          orderId: order.id,
          status: 'pending',
          message: 'Order submitted successfully',
          websocketUrl: `/ws/${order.id}`,
          createdAt: order.createdAt
        });

      } catch (error) {
        console.error('Error creating order:', error);
        reply.code(500).send({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  });

  /**
   * GET /api/orders/:orderId
   * Get order details and status
   */
  fastify.get<{ Params: { orderId: string } }>('/api/orders/:orderId', {
    handler: async (request: FastifyRequest<{ Params: { orderId: string } }>, reply: FastifyReply) => {
      try {
        const { orderId } = request.params;

        const order = await database.getOrder(orderId);
        if (!order) {
          return reply.code(404).send({
            error: 'Order not found',
            message: `Order ${orderId} does not exist`
          });
        }

        reply.send({
          order,
          websocketUrl: `/ws/${orderId}`
        });

      } catch (error) {
        console.error(`Error fetching order ${request.params.orderId}:`, error);
        reply.code(500).send({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  });
}
