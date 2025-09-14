import { Order, OrderStatus, ExecutionResult, RouteResult } from '../types';
import { MockDexRouter } from './mockDexRouter';
import { dexRouter } from './dexRouter';
import { SolanaConnectionManager } from './solanaConnection';
import { Database } from '../database/connection';
import { WebSocketManager } from './websocketManager';
import { retryWithBackoff, sleep } from '../utils/errorHandler';

export class OrderExecutionEngine {
  private dexRouter: dexRouter;
  // private dexRouter: MockDexRouter;
  private database: Database;
  private wsManager: WebSocketManager;

  constructor(database: Database, solanaManager: SolanaConnectionManager, wsManager: WebSocketManager) {
    this.database = database;
    this.dexRouter = new dexRouter(solanaManager);
    // this.dexRouter = new MockDexRouter();
    this.wsManager = wsManager;

    console.log('Order execution engine initialized');
  }

  /**
   * Process a single order through its complete lifecycle
   */
  async processOrder(order: Order): Promise<void> {
    console.log(`Starting execution of order ${order.id}`);

    try {
      // Step 1: Update to routing status
      await this.updateOrderStatus(order.id, OrderStatus.ROUTING);

      // Step 2: Route to best DEX
      const routeResult = await this.routeOrder(order);

      // Step 3: Update to building status
      await this.updateOrderStatus(order.id, OrderStatus.BUILDING, {
        routeResult,
        dex: routeResult.dex
      });

      // Step 4: Build and submit transaction
      await this.buildTransaction(order);
      await this.updateOrderStatus(order.id, OrderStatus.SUBMITTED);

      // Step 5: Execute the swap
      const executionResult = await this.executeOrder(order, routeResult.dex);

      if (executionResult.success) {
        // Step 6: Confirm successful execution
        await this.updateOrderStatus(order.id, OrderStatus.CONFIRMED, {
          txHash: executionResult.txHash,
          executedPrice: executionResult.executedPrice,
          executedAt: new Date()
        });
      } else {
        // Handle execution failure
        await this.updateOrderStatus(order.id, OrderStatus.FAILED, {
          errorMessage: executionResult.error
        });
      }

    } catch (error) {
      console.error(`Order ${order.id} failed:`, error);
      await this.updateOrderStatus(order.id, OrderStatus.FAILED, {
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error; // Re-throw for queue retry mechanism
    }
  }

  /**
   * Route order to the best available DEX with retry logic
   */
  private async routeOrder(order: Order): Promise<RouteResult> {
    console.log(`Routing order ${order.id}: ${order.amountIn} ${order.tokenIn} -> ${order.tokenOut}`);

    try {
      const routeResult = await retryWithBackoff(
        async () => {
          return await this.dexRouter.selectBestDex(
            order.tokenIn,
            order.tokenOut,
            order.amountIn,
          );
        },
      );

      console.log(`Order ${order.id} routed to ${routeResult.dex}: ${routeResult.routingReason}`);
      return routeResult;
    } catch (error) {
      console.error(`Routing failed for order ${order.id}:`, error);
      throw new Error(
        `DEX routing failed for order ${order.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Build transaction (simulated for mock implementation)
   */
  private async buildTransaction(order: Order): Promise<void> {
    console.log(`Building transaction for order ${order.id}`);
    await sleep(500 + Math.random() * 500);
    console.log(`Transaction built for order ${order.id}`);
  }

  /**
   * Execute the order on the selected DEX
   */
  private async executeOrder(order: Order, dex: string): Promise<ExecutionResult> {
    console.log(`Executing order ${order.id} on ${dex}`);

    try {
      const result = await this.dexRouter.executeSwap(dex, order);

      if (result.success) {
        console.log(`Order ${order.id} executed successfully: ${result.txHash}`);
      } else {
        console.error(`Order ${order.id} execution failed: ${result.error}`);
      }

      return result;
    } catch (error) {
      console.error(`Execution error for order ${order.id}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown execution error'
      };
    }
  }

  /**
   * Update order status in database and notify WebSocket clients
   */
  private async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    additionalData?: {
      txHash?: string;
      executedPrice?: number;
      executedAt?: Date;
      errorMessage?: string;
      dex?: string;
      routeResult?: RouteResult;
    }
  ): Promise<void> {
    try {
      // Update database
      await this.database.updateOrderStatus(orderId, status, {
        txHash: additionalData?.txHash,
        executedAt: additionalData?.executedAt,
        errorMessage: additionalData?.errorMessage,
        dex: additionalData?.dex
      });

      // Send WebSocket update
      this.wsManager.broadcastOrderUpdate({
        orderId,
        status,
        timestamp: new Date(),
        data: {
          txHash: additionalData?.txHash,
          error: additionalData?.errorMessage,
          routeResult: additionalData?.routeResult
        }
      });

      console.log(`Order ${orderId} status updated to: ${status}`);
    } catch (error) {
      console.error(`Failed to update order ${orderId} status:`, error);
      throw error;
    }
  }

  /**
   * Validate order before processing (Market Order specific validation)
   */
  validateMarketOrder(order: Order): { isValid: boolean; error?: string } {
    // Basic validation
    if (!order.tokenIn || !order.tokenOut) {
      return { isValid: false, error: 'Token addresses are required' };
    }

    if (order.tokenIn === order.tokenOut) {
      return { isValid: false, error: 'Input and output tokens must be different' };
    }

    if (BigInt(order.amountIn) <= BigInt(0)) {
      return { isValid: false, error: 'Amount must be greater than zero' };
    }

    // Market order specific validation
    if (order.type !== 'market') {
      return { isValid: false, error: 'This engine only processes market orders' };
    }

    return { isValid: true };
  }
}
