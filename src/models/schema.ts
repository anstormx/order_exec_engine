// Schema for order execution request
export const executeOrderSchema = {
    body: {
        type: 'object',
        required: ['tokenIn', 'tokenOut', 'amountIn'],
        properties: {
            tokenIn: { type: 'string', minLength: 1 },
            tokenOut: { type: 'string', minLength: 1 },
            amountIn: { type: 'number', minimum: 0 },
        }
    }
};