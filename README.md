# Eterna Order Execution Engine

A high-performance DEX order execution engine for Solana that processes market orders with automatic routing between Raydium and Meteora DEXs on **Solana Mainnet**, featuring real-time WebSocket updates and robust error handling.

## Live Demo

**Public URL**: https://orderexecengine-production.up.railway.app/

**Demo Video**: https://youtu.be/9tN3yIfnwrA

**USDC -> SOL**: https://solscan.io/tx/rRAXAhH4ppdSH2idnDQZSnCdfCJe3dkAGw79KcvaUyn4irWZkY9SAdimMzw2qjTRxNk8X1MLwzvAx9waF87Xabz

**SOL -> USDC**: https://solscan.io/tx/26ZL62Sz2Cina4Q2KRHec4ievDSDkQM6bN5iSiE4mbFAhriTBHwqE3rC9D7WejRcM9MHYbYmUEWHyyxtuvssgTMZ

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Order Type Selection](#order-type-selection)
- [Quick Start](#quick-start)
- [API Documentation](#api-documentation)
- [WebSocket Protocol](#websocket-protocol)
- [Testing](#testing)
- [Performance](#performance)

## Features

- **Real Solana Mainnet Execution**: Actual swaps on Raydium and Meteora DEXs
- **Market Order Execution**: Immediate execution at current market prices  
- **DEX Routing**: Automatic routing between Raydium and Meteora for best prices
- **Real-time Updates**: WebSocket streaming of order lifecycle events
- **Concurrent Processing**: Handle up to 10 orders simultaneously, 100 orders/minute
- **Retry Logic**: Exponential backoff with circuit breaker pattern
- **Error Handling**: Comprehensive error tracking and recovery
- **Queue Management**: Redis-backed BullMQ for reliable order processing
- **Database Persistence**: PostgreSQL for order history and audit trails

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   HTTP Client   │────│  Fastify API    │────│   WebSocket     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │  Order Queue    │
                       │   (BullMQ)      │
                       └─────────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │  Order Execution Engine │
                    └─────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
            ┌───────────────┐       ┌──────────────┐
            │  DEX Router   │       │  Database    │
            │ (Raydium +    │       │ (PostgreSQL) │
            │  Meteora)     │       └──────────────┘
            └───────────────┘
```

### Core Components

1. **Fastify API Server**: HTTP endpoints with WebSocket upgrade capability
2. **Order Queue**: BullMQ-powered queue with Redis for reliable processing
3. **Order Execution Engine**: Core business logic for order lifecycle management
4. **DEX Router**: Price comparison and routing logic for Raydium/Meteora
5. **Database Layer**: PostgreSQL for persistence and audit trails
6. **WebSocket Manager**: Real-time client communication

## Order Type Selection

**Selected: Market Orders**

Market orders were chosen for this implementation because they provide immediate execution at current market prices, making them ideal for demonstrating the complete DEX routing and execution flow with real-time feedback.

**Extension Path for Other Order Types:**

- **Limit Orders**: Add price monitoring service and conditional execution triggers when target prices are reached
- **Sniper Orders**: Implement token launch detection, migration event listeners, and instant execution triggers for new token opportunities

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 13+
- Redis 6+
- npm or yarn
- **Solana Mainnet Wallet with SOL** (see setup instructions below)

### Installation

```bash
# Clone the repository
git clone https://github.com/anstormx/order_exec_engine
cd eterna-order-engine

# Install dependencies
npm install

# Generate Solana wallet
node scripts/setupWallet.js
# This will generate a new wallet and show you the private key

# Set up environment variables
cp env.example .env
# Edit .env with all credentials

# Fund your wallet with SOL

# Check wallet balance
npm run check-balance

# Set up database
psql -U postgres -c "CREATE DATABASE eterna_orders;"
psql -U postgres -d eterna_orders -f src/database/schema.sql

# Start the server
npm run start
```

### Development Mode

```bash
# Start with hot reload
npm run dev

# Run tests
npm run test
```

## API Documentation

### Submit Order

```bash
POST /api/orders/execute
Content-Type: application/json

{
  "tokenIn": "SOL",
  "tokenOut": "USDC", 
  "amountIn": 10.5,
}
```

**Response:**
```json
{
  "orderId": "uuid-v4",
  "status": "pending",
  "message": "Order submitted successfully",
  "websocketUrl": "/ws/uuid-v4",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

### Get Order Status

```bash
GET /api/orders/:orderId
```

**Response:**
```json
{
  "order": {
    "id": "uuid-v4",
    "type": "market",
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "tokenInMint": "So11111111111111111111111111111111111111112",
    "tokenOutMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amountIn": 10.5,
    "status": "confirmed",
    "executedPrice": 23.45,
    "txHash": "5J7...abc",
    "selectedDex": "Raydium",
    "createdAt": "2024-01-15T10:30:00Z",
    "executedAt": "2024-01-15T10:30:15Z"
  },
  "websocketUrl": "/ws/uuid-v4"
}
```

### Health Check

```bash
GET /health
```

## WebSocket Protocol

Connect to WebSocket for real-time order updates:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws/your-order-id');

ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log('Order Update:', update);
};
```

### WebSocket Message Format

```json
{
  "orderId": "uuid-v4",
  "status": "routing",
  "timestamp": "2024-01-15T10:30:05Z",
  "data": {
    "routeResult": {
      "selectedDex": "Raydium",
      "routingReason": "Raydium selected: better effective price"
    }
  }
}
```

### Order Status Flow

1. **pending** → Order received and queued
2. **routing** → Comparing DEX prices  
3. **building** → Creating transaction
4. **submitted** → Transaction sent to network
5. **confirmed** → Transaction successful
6. **failed** → Error occurred

## Testing

The project includes comprehensive test coverage with 15+ unit and integration tests:

```bash
# Run all tests
npm run test

# Run specific test suite
npm test -- dexRouter.test.ts

# Watch mode
npm run test:watch
```

### Test Categories

- **Unit Tests**: Individual component testing (DEX router, execution engine, error handlers)
- **Integration Tests**: End-to-end order processing workflows
- **Error Handling Tests**: Retry logic, circuit breakers, failure scenarios
- **Performance Tests**: Concurrent order processing and throughput

### Test Coverage

- DEX Router: Quote fetching, routing logic, swap execution
- Order Execution Engine: Complete lifecycle management
- Queue System: Job processing, retry mechanisms
- Error Handling: Retry logic, circuit breakers
- Integration: End-to-end order flows

## Performance

### Throughput Metrics

- **Concurrent Orders**: 10 simultaneous processing
- **Queue Throughput**: 100 orders/minute
- **Average Execution Time**: 2-4 seconds per order
- **Retry Logic**: 3 attempts with exponential backoff

### Monitoring

- WebSocket connection monitoring
- Error rate tracking and alerting

### Scalability

The system is designed for horizontal scaling:
- Stateless API servers
- Redis-backed queue for distributed processing
- Database connection pooling
- Circuit breaker pattern for external services

## Development

### Project Structure

```
src/
├── types/           # TypeScript type definitions
├── services/        # Core business logic
│   ├── dexRouter.ts           # DEX routing and price comparison
│   ├── mockDexRouter.ts           # Mock DEX routing and price comparison 
│   ├── orderExecutionEngine.ts # Order lifecycle management
│   ├── queue.ts               # BullMQ queue management
│   └── websocketManager.ts    # WebSocket connections
├── database/        # Database layer
│   ├── connection.ts          # Database operations
│   └── schema.sql            # PostgreSQL schema
├── routes/          # API endpoints
├── utils/           # Utilities and error handling
└── __tests__/       # Test suites
```

### Design Decisions

1. **Mock Implementation**: Chosen for rapid development and testing without external dependencies
2. **Fastify**: Selected for high performance and built-in WebSocket support
3. **BullMQ**: Provides reliable queue processing with retry mechanisms
4. **PostgreSQL**: ACID compliance for order audit trails
5. **Circuit Breaker**: Prevents cascade failures in DEX routing

## Postman Collection

Import the included Postman collection for API testing:

```bash
# Collection includes:
# - Order submission endpoints
# - Status checking
# - WebSocket connection examples
```
