// Schema for order execution request
export const executeOrderSchema = {
    body: {
        type: 'object',
        required: ['tokenIn', 'tokenOut', 'amountIn'],
        properties: {
            tokenIn: { type: 'string', minLength: 1 },
            tokenOut: { type: 'string', minLength: 1 },
            amountIn: { type: 'number', minimum: 0.000001 },
            slippage: { type: 'number', minimum: 0, maximum: 0.5, default: 0.01 },
        }
    }
};