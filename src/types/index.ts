export interface Order {
  id: string;
  type: OrderType;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  executedAt?: Date;
  txHash?: string;
  errorMessage?: string;
  retryCount: number;
  dex?: string;
}

export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
  SNIPER = 'sniper'
}

export enum OrderStatus {
  PENDING = 'pending',
  ROUTING = 'routing',
  BUILDING = 'building',
  SUBMITTED = 'submitted',
  CONFIRMED = 'confirmed',
  FAILED = 'failed'
}

export interface DexQuote {
  dex: string;
  price: number;
  fee: number;
}

export interface RouteResult {
  dex: string;
  bestQuote: DexQuote;
  allQuotes: DexQuote[];
  routingReason: string;
}

export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  executedPrice?: number;
  actualAmountOut?: number;
  error?: string;
}

export interface WebSocketMessage {
  orderId: string;
  status: OrderStatus;
  timestamp: Date;
  data?: {
    txHash?: string;
    error?: string;
    routeResult?: RouteResult;
    message?: string;
    dex?: string;
    executedAt?: Date;
    amountIn?: number;
    tokenIn?: string;
    tokenOut?: string;
    createdAt?: Date;
    updatedAt?: Date;
  };
}

export interface OrderRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
}

export interface QueueJobData {
  orderId: string;
  order: Order;
}
