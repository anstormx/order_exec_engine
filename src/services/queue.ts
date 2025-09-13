import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { QueueJobData, Order } from '../types';
import { OrderExecutionEngine } from './orderExecutionEngine';

export class OrderQueue {
  private redis: Redis;
  private queue: Queue<QueueJobData>;
  private worker: Worker<QueueJobData>;
  private executionEngine: OrderExecutionEngine;

  constructor(
    redisConfig: { host: string; port: number; url?: string },
    executionEngine: OrderExecutionEngine
  ) {
    // Use REDIS_URL if available (Railway), otherwise use host/port
    if (redisConfig.url) {
      console.log('Using REDIS_URL for connection:', redisConfig.url);

      this.redis = new Redis(redisConfig.url, {
        maxRetriesPerRequest: null,
      });
    } else {
      console.log('Using host/port for Redis connection:', redisConfig.host, redisConfig.port);
      
      this.redis = new Redis({
        host: redisConfig.host,
        port: redisConfig.port,
        maxRetriesPerRequest: null,
      });
    }

    this.queue = new Queue<QueueJobData>('order-execution', {
      connection: this.redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });

    this.executionEngine = executionEngine;

    this.worker = new Worker<QueueJobData>(
      'order-execution',
      async (job: Job<QueueJobData>) => {
        console.log(`Processing order ${job.data.orderId}`);
        return await this.executionEngine.processOrder(job.data.order);
      },
      {
        connection: this.redis,
        concurrency: 10, // Process up to 10 orders concurrently
        limiter: {
          max: 100, // 100 jobs per minute
          duration: 60000,
        },
      }
    );

    this.setupEventListeners();

    console.log('Order queue initialized');
  }

  private setupEventListeners(): void {
    this.worker.on('completed', (job: Job<QueueJobData>) => {
      console.log(`Order ${job.data.orderId} completed successfully`);
    });

    this.worker.on('failed', (job: Job<QueueJobData> | undefined, error: Error) => {
      if (job) {
        console.error(`Order ${job.data.orderId} failed:`, error.message);
      } else {
        console.error('Job failed:', error.message);
      }
    });

    this.worker.on('stalled', (jobId: string) => {
      console.warn(`Order job ${jobId} stalled`);
    });

    this.queue.on('error', (error: Error) => {
      console.error('Queue error:', error);
    });

    this.redis.on('error', (error: Error) => {
      console.error('Redis connection error:', error);
    });

    this.redis.on('connect', () => {
      console.log('Connected to Redis');
    });
  }

  async addOrder(order: Order): Promise<void> {
    const jobData: QueueJobData = {
      orderId: order.id,
      order,
    };

    await this.queue.add(`order-${order.id}`, jobData, {
      priority: this.getOrderPriority(order),
      delay: 0,
    });

    console.log(`Added order ${order.id} to queue`);
  }

  private getOrderPriority(order: Order): number {
    // Higher priority for market orders (lower number = higher priority)
    switch (order.type) {
      case 'market':
        return 1;
      case 'limit':
        return 2;
      case 'sniper':
        return 0; // Highest priority for sniper orders
      default:
        return 3;
    }
  }

  async getQueueStats() {
    const waiting = await this.queue.getWaiting();
    const active = await this.queue.getActive();
    const completed = await this.queue.getCompleted();
    const failed = await this.queue.getFailed();

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
    };
  }

  async pauseQueue(): Promise<void> {
    await this.queue.pause();
    console.log('Queue paused');
  }

  async resumeQueue(): Promise<void> {
    await this.queue.resume();
    console.log('Queue resumed');
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    await this.redis.quit();
    console.log('Queue and Redis connections closed');
  }
}
