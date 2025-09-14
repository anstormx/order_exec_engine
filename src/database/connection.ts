import { Pool, PoolClient } from 'pg';
import { Order, OrderStatus } from '../types';

export class Database {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString
    });
  }

  async connect(): Promise<void> {
    try {
      await this.pool.connect();
      console.log('Connected to PostgreSQL database');
    } catch (error) {
      console.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async createOrder(order: Order): Promise<void> {
    const query = `
      INSERT INTO orders (
        id, type, token_in, token_out, token_in_mint, token_out_mint, amount_in, 
        status, retry_count, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;
    
    const values = [
      order.id,
      order.type.toString(),
      order.tokenIn,
      order.tokenOut,
      order.tokenInMint,
      order.tokenOutMint,
      order.amountIn.toString(),
      order.status.toString(),
      order.retryCount,
      order.createdAt,
      order.updatedAt
    ];

    await this.pool.query(query, values);
  }

  async updateOrderStatus(
    orderId: string, 
    status: OrderStatus, 
    data?: {
      txHash?: string;
      executedAt?: Date;
      errorMessage?: string;
      dex?: string;
    }
  ): Promise<void> {
    const client: PoolClient = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Update order
      const updateQuery = `
        UPDATE orders SET 
          status = $1, 
          updated_at = CURRENT_TIMESTAMP,
          tx_hash = COALESCE($2, tx_hash),
          executed_at = COALESCE($3, executed_at),
          error_message = COALESCE($4, error_message),
          dex = COALESCE($5, dex),
          retry_count = CASE WHEN $1 = 'failed' THEN retry_count + 1 ELSE retry_count END
        WHERE id = $6
      `;

      await client.query(updateQuery, [
        status.toString(),
        data?.txHash,
        data?.executedAt,
        data?.errorMessage,
        data?.dex,
        orderId
      ]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getOrder(orderId: string): Promise<Order | null> {
    const query = 'SELECT * FROM orders WHERE id = $1';
    const result = await this.pool.query(query, [orderId]);
    
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      type: row.type,
      tokenIn: row.token_in,
      tokenOut: row.token_out,
      tokenInMint: row.token_in_mint,
      tokenOutMint: row.token_out_mint,
      amountIn: row.amount_in,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      executedAt: row.executed_at,
      txHash: row.tx_hash,
      errorMessage: row.error_message,
      retryCount: row.retry_count,
      dex: row.dex
    };
  }
}
