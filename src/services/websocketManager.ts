import { FastifyInstance } from 'fastify';
import { WebSocketMessage } from '../types';
import { Database } from '../database/connection';

export class WebSocketManager {
  private connections: Map<string, any> = new Map(); // orderId -> WebSocket connection
  private server: FastifyInstance;
  private database: Database;

  constructor(server: FastifyInstance, database: Database) {
    this.server = server;
    this.database = database;
    this.setupWebSocketHandlers();
  }

  private setupWebSocketHandlers(): void {
    const self = this;
    
    this.server.register(async function (fastify) {
      fastify.get('/ws/:orderId', { websocket: true }, (connection, request) => {
        const orderId = (request.params as any).orderId;
        
        console.log(`WebSocket connection established for order ${orderId}`);
        
        // In @fastify/websocket, the connection object IS the WebSocket
        const socket = connection;
        
        // Validate connection object
        if (!socket) {
          console.error(`Invalid WebSocket connection for order ${orderId}`);
          return;
        }
        
        // Store the connection
        self.connections.set(orderId, socket);

        // Send current order status instead of generic welcome message
        self.sendCurrentOrderStatus(orderId, socket);

        // Handle connection close
        socket.on('close', () => {
          console.log(`WebSocket connection closed for order ${orderId}`);
          self.connections.delete(orderId);
        });

        // Handle connection errors
        socket.on('error', (error: Error) => {
          console.error(`WebSocket error for order ${orderId}:`, error);
          self.connections.delete(orderId);
        });
      });
    });
  }

  /**
   * Send current order status when WebSocket connection is established
   */
  private async sendCurrentOrderStatus(orderId: string, socket: any): Promise<void> {
    try {
      // Query database for current order status
      const order = await this.database.getOrder(orderId);
      
      if (!order) {
        // Order not found - send error message
        socket.send(JSON.stringify({
          orderId,
          status: 'failed',
          timestamp: new Date(),
          data: { 
            error: 'Order not found',
            message: 'WebSocket connection established, but order does not exist'
          }
        }));
        console.log(`Order ${orderId} not found - sent error message`);
        return;
      }

      // Send current order status
      socket.send(JSON.stringify({
        orderId,
        status: order.status,
        timestamp: new Date(),
        data: {
          message: 'WebSocket connection established',
          txHash: order.txHash,
          error: order.errorMessage,
          dex: order.dex,
          executedAt: order.executedAt,
          amountIn: order.amountIn,
          tokenIn: order.tokenIn,
          tokenOut: order.tokenOut,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt
        }
      }));
      
      console.log(`Sent current status (${order.status}) for order ${orderId}`);
    } catch (error) {
      console.error(`Failed to send current order status for ${orderId}:`, error);
      
      // Send fallback message
      socket.send(JSON.stringify({
        orderId,
        status: 'failed',
        timestamp: new Date(),
        data: { 
          message: 'WebSocket connection established',
          error: 'Could not retrieve order status'
        }
      }));
    }
  }

  /**
   * Broadcast order update to specific order's WebSocket connection
   */
  broadcastOrderUpdate(message: WebSocketMessage): void {
    const connection = this.connections.get(message.orderId);
    
    if (!connection) {
      console.log(`No WebSocket connection found for order ${message.orderId}`);
      return;
    }
    
    try {
      if (connection.readyState === 1) { // 1 = OPEN
        connection.send(JSON.stringify(message));
        console.log(`Sent WebSocket update for order ${message.orderId}: ${message.status}`);
      } else {
        console.log(`WebSocket connection not open for order ${message.orderId} (readyState: ${connection.readyState})`);
        this.connections.delete(message.orderId);
      }
    } catch (error) {
      console.error(`Failed to send WebSocket message for order ${message.orderId}:`, error);
      // Remove broken connection
      this.connections.delete(message.orderId);
    }
  }

  /**
   * Send heartbeat to all connections (keep-alive)
   */
  sendHeartbeat(): void {
    const heartbeat = {
      type: 'heartbeat',
      timestamp: new Date(),
      server_time: Date.now()
    };

    let activeCount = 0;
    const connectionsToRemove: string[] = [];
    
    this.connections.forEach((connection, orderId) => {
      // Check if connection exists and is valid
      if (!connection) {
        connectionsToRemove.push(orderId);
        return;
      }
      
      try {
        if (connection.readyState === 1) { // WebSocket.OPEN
          connection.send(JSON.stringify(heartbeat));
          activeCount++;
        } else {
          // Connection is not open, mark for removal
          connectionsToRemove.push(orderId);
        }
      } catch (error) {
        console.error(`Heartbeat failed for order ${orderId}:`, error);
        connectionsToRemove.push(orderId);
      }
    });
    
    // Clean up invalid connections
    connectionsToRemove.forEach(orderId => {
      this.connections.delete(orderId);
    });

    if (activeCount > 0) {
      console.log(`Heartbeat sent to ${activeCount} active connections`);
    }
  }
}
