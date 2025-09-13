import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
}

export class OrderExecutionError extends Error implements AppError {
  statusCode: number;
  code: string;
  details?: any;

  constructor(message: string, statusCode: number = 500, code: string = 'ORDER_EXECUTION_ERROR', details?: any) {
    super(message);
    this.name = 'OrderExecutionError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends Error implements AppError {
  statusCode: number = 400;
  code: string = 'VALIDATION_ERROR';
  details?: any;

  constructor(message: string, details?: any) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class DexRoutingError extends Error implements AppError {
  statusCode: number = 503;
  code: string = 'DEX_ROUTING_ERROR';
  details?: any;

  constructor(message: string, details?: any) {
    super(message);
    this.name = 'DexRoutingError';
    this.details = details;
  }
}

export class DatabaseError extends Error implements AppError {
  statusCode: number = 500;
  code: string = 'DATABASE_ERROR';
  details?: any;

  constructor(message: string, details?: any) {
    super(message);
    this.name = 'DatabaseError';
    this.details = details;
  }
}

export class QueueError extends Error implements AppError {
  statusCode: number = 503;
  code: string = 'QUEUE_ERROR';
  details?: any;

  constructor(message: string, details?: any) {
    super(message);
    this.name = 'QueueError';
    this.details = details;
  }
}

/**
 * Global error handler for Fastify
 */
export function setupErrorHandler(fastify: any): void {
  fastify.setErrorHandler((error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;
    
    // Log the error with context
    request.log.error({
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
        code: (error as AppError).code,
        details: (error as AppError).details
      },
      requestId,
      url: request.url,
      method: request.method
    }, 'Request error occurred');

    // Determine status code
    let statusCode = 500;
    if ('statusCode' in error && typeof error.statusCode === 'number') {
      statusCode = error.statusCode;
    } else if ('status' in error && typeof error.status === 'number') {
      statusCode = error.status;
    }

    // Prepare error response
    const errorResponse: any = {
      error: true,
      message: error.message,
      requestId,
      timestamp: new Date().toISOString()
    };

    // Add error code if available
    if ('code' in error && error.code) {
      errorResponse.code = error.code;
    }

    // Add details in development mode
    if (process.env.NODE_ENV === 'development' && 'details' in error && error.details) {
      errorResponse.details = error.details;
    }

    // Don't expose stack traces in production
    if (process.env.NODE_ENV === 'development' && error.stack) {
      errorResponse.stack = error.stack;
    }

    reply.code(statusCode).send(errorResponse);
  });
}

/**
 * Retry utility with exponential backoff
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  maxDelay: number = 30000,
  backoffMultiplier: number = 2
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === maxRetries) {
        throw new OrderExecutionError(
          `Operation failed after ${maxRetries + 1} attempts: ${lastError.message}`,
          500,
          'MAX_RETRIES_EXCEEDED',
          { attempts: attempt + 1, lastError: lastError.message }
        );
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        baseDelay * Math.pow(backoffMultiplier, attempt),
        maxDelay
      );

      console.log(`Attempt ${attempt + 1} failed: ${lastError.message}. Retrying in ${delay}ms...`);
      
      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Utility function for delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sanitize error for logging (remove sensitive information)
 */
export function sanitizeError(error: any): any {
  if (!error) return error;

  const sanitized = { ...error };
  
  // Remove potentially sensitive fields
  const sensitiveFields = ['password', 'token', 'key', 'secret', 'authorization'];
  
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Create standardized error response
 */
export function createErrorResponse(
  message: string,
  code: string,
  statusCode: number = 500,
  details?: any
): AppError {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}
