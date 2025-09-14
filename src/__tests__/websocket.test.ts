import { WebSocketManager } from '../services/websocketManager';
import { Database } from '../database/connection';
import { Order, OrderType, OrderStatus, WebSocketMessage } from '../types';
import { FastifyInstance } from 'fastify';

// Mock dependencies
jest.mock('../database/connection');

describe('WebSocketManager - WebSocket Lifecycle Tests', () => {
    let wsManager: WebSocketManager;
    let mockServer: jest.Mocked<FastifyInstance>;
    let mockDatabase: jest.Mocked<Database>;
    let mockSocket: any;
    let mockConnection: any;

    beforeEach(() => {
        // Mock Fastify server
        mockServer = {
            register: jest.fn().mockImplementation((fn) => fn(mockServer))
        } as any;

        mockServer.get = jest.fn().mockImplementation((path, options, handler) => {
            // Store the handler for testing
            (mockServer as any)._wsHandler = handler;
        });

        // Mock WebSocket connection
        mockSocket = {
            send: jest.fn(),
            on: jest.fn(),
            readyState: 1, // WebSocket.OPEN
        };

        mockConnection = mockSocket;

        // Mock database
        mockDatabase = new Database('test') as jest.Mocked<Database>;
        mockDatabase.getOrder = jest.fn();

        wsManager = new WebSocketManager(mockServer, mockDatabase);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('should register WebSocket route on initialization', () => {
        expect(mockServer.register).toHaveBeenCalled();
        expect(mockServer.get).toHaveBeenCalledWith(
            '/ws/:orderId',
            { websocket: true },
            expect.any(Function)
        );
    });

    test('should handle WebSocket connection and send current order status', async () => {
        const mockOrder: Order = {
            id: 'test-order-1',
            type: OrderType.MARKET,
            tokenIn: 'SOL',
            tokenOut: 'USDC',
            tokenInMint: 'So11111111111111111111111111111111111111112',
            tokenOutMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            amountIn: '10',
            status: OrderStatus.CONFIRMED,
            createdAt: new Date(),
            updatedAt: new Date(),
            retryCount: 0,
            txHash: 'mock-tx-hash',
            executedAt: new Date()
        };

        mockDatabase.getOrder.mockResolvedValue(mockOrder);

        const mockRequest = {
            params: { orderId: 'test-order-1' }
        };

        // Simulate WebSocket connection
        const handler = (mockServer as any)._wsHandler;
        await handler(mockConnection, mockRequest);

        // Verify connection was stored and current status sent
        expect(mockDatabase.getOrder).toHaveBeenCalledWith('test-order-1');
        expect(mockSocket.send).toHaveBeenCalledWith(
            expect.stringContaining('"orderId":"test-order-1"')
        );
        expect(mockSocket.send).toHaveBeenCalledWith(
            expect.stringContaining('"status":"confirmed"')
        );
    });

    test('should handle WebSocket connection for non-existent order', async () => {
        mockDatabase.getOrder.mockResolvedValue(null);

        const mockRequest = {
            params: { orderId: 'non-existent-order' }
        };

        const handler = (mockServer as any)._wsHandler;
        await handler(mockConnection, mockRequest);

        expect(mockSocket.send).toHaveBeenCalledWith(
            expect.stringContaining('"error":"Order not found"')
        );
    });

    test('should setup WebSocket event listeners', async () => {
        const mockRequest = {
            params: { orderId: 'test-order' }
        };

        mockDatabase.getOrder.mockResolvedValue({
            id: 'test-order',
            status: OrderStatus.PENDING
        } as Order);

        const handler = (mockServer as any)._wsHandler;
        await handler(mockConnection, mockRequest);

        // Verify event listeners were set up
        expect(mockSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
        expect(mockSocket.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    test('should handle ping-pong messages', async () => {
        const mockRequest = {
            params: { orderId: 'test-order' }
        };

        mockDatabase.getOrder.mockResolvedValue({
            id: 'test-order',
            status: OrderStatus.PENDING
        } as Order);

        const handler = (mockServer as any)._wsHandler;
        await handler(mockConnection, mockRequest);

        // Get the message handler
        const messageHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'message')[1];

        // Simulate ping message
        const pingMessage = Buffer.from(JSON.stringify({ type: 'ping' }));
        messageHandler(pingMessage);

        expect(mockSocket.send).toHaveBeenCalledWith(
            expect.stringContaining('"type":"pong"')
        );
    });

    test('should broadcast order updates to connected clients', () => {
        // First establish a connection
        const mockRequest = {
            params: { orderId: 'broadcast-test-order' }
        };

        mockDatabase.getOrder.mockResolvedValue({
            id: 'broadcast-test-order',
            status: OrderStatus.PENDING
        } as Order);

        const handler = (mockServer as any)._wsHandler;
        handler(mockConnection, mockRequest);

        // Clear previous calls
        mockSocket.send.mockClear();

        // Create a WebSocket message
        const wsMessage: WebSocketMessage = {
            orderId: 'broadcast-test-order',
            status: OrderStatus.CONFIRMED,
            timestamp: new Date(),
            data: {
                txHash: 'test-tx-hash',
                message: 'Order executed successfully'
            }
        };

        // Broadcast the update
        wsManager.broadcastOrderUpdate(wsMessage);

        expect(mockSocket.send).toHaveBeenCalledWith(JSON.stringify(wsMessage));
    });

    test('should handle broadcast to non-existent connection', () => {
        const wsMessage: WebSocketMessage = {
            orderId: 'non-existent-order',
            status: OrderStatus.FAILED,
            timestamp: new Date(),
            data: {
                error: 'Order not found'
            }
        };

        // Should not throw error
        expect(() => wsManager.broadcastOrderUpdate(wsMessage)).not.toThrow();
    });

    test('should handle closed WebSocket connections', () => {
        // Setup connection
        const mockRequest = {
            params: { orderId: 'closed-connection-test' }
        };

        mockDatabase.getOrder.mockResolvedValue({
            id: 'closed-connection-test',
            status: OrderStatus.PENDING
        } as Order);

        const handler = (mockServer as any)._wsHandler;
        handler(mockConnection, mockRequest);

        // Simulate closed connection
        mockSocket.readyState = 3; // WebSocket.CLOSED

        const wsMessage: WebSocketMessage = {
            orderId: 'closed-connection-test',
            status: OrderStatus.CONFIRMED,
            timestamp: new Date()
        };

        wsManager.broadcastOrderUpdate(wsMessage);

        // Should not attempt to send to closed connection
        expect(mockSocket.send).not.toHaveBeenCalledWith(JSON.stringify(wsMessage));
    });

    test('should clean up connections on close', async () => {
        const mockRequest = {
            params: { orderId: 'cleanup-test' }
        };

        mockDatabase.getOrder.mockResolvedValue({
            id: 'cleanup-test',
            status: OrderStatus.PENDING
        } as Order);

        const handler = (mockServer as any)._wsHandler;
        await handler(mockConnection, mockRequest);

        // Get the close handler
        const closeHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === 'close')[1];

        // Simulate connection close
        closeHandler();

        // Try to broadcast after close - should not send
        const wsMessage: WebSocketMessage = {
            orderId: 'cleanup-test',
            status: OrderStatus.CONFIRMED,
            timestamp: new Date()
        };

        wsManager.broadcastOrderUpdate(wsMessage);

        // Should not send because connection was cleaned up
        expect(mockSocket.send).not.toHaveBeenCalledWith(JSON.stringify(wsMessage));
    });

    test('should send heartbeat to active connections', () => {
        // Setup multiple connections
        const connections = ['order-1', 'order-2', 'order-3'].map(orderId => {
            const mockSocket = {
                send: jest.fn(),
                on: jest.fn(),
                readyState: 1 // WebSocket.OPEN
            };

            const mockRequest = { params: { orderId } };
            mockDatabase.getOrder.mockResolvedValue({
                id: orderId,
                status: OrderStatus.PENDING
            } as Order);

            const handler = (mockServer as any)._wsHandler;
            handler(mockSocket, mockRequest);

            return mockSocket;
        });

        // Clear setup calls
        connections.forEach(socket => socket.send.mockClear());

        // Send heartbeat
        wsManager.sendHeartbeat();

        // Verify heartbeat sent to all active connections
        connections.forEach(socket => {
            expect(socket.send).toHaveBeenCalledWith(
                expect.stringContaining('"type":"heartbeat"')
            );
        });
    });

    test('should handle database errors gracefully when sending current status', async () => {
        mockDatabase.getOrder.mockRejectedValue(new Error('Database error'));

        const mockRequest = {
            params: { orderId: 'db-error-test' }
        };

        const handler = (mockServer as any)._wsHandler;
        await handler(mockConnection, mockRequest);

        // Should send fallback message
        expect(mockSocket.send).toHaveBeenCalledWith(
            expect.stringContaining('Could not retrieve order status')
        );
    });
});
