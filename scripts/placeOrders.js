// Simple script to place 5 orders simultaneously using the exact format provided
const fetch = require('node-fetch');

const API_URL = "http://127.0.0.1:3000/api/orders/execute";

// Order configurations
const orders = [
  { tokenIn: "SOL", tokenOut: "USDC", amountIn: 0.001 },
  { tokenIn: "SOL", tokenOut: "USDC", amountIn: 0.002 },
  { tokenIn: "USDC", tokenOut: "SOL", amountIn: 1.0 },
  { tokenIn: "SOL", tokenOut: "USDC", amountIn: 0.005 },
  { tokenIn: "USDC", tokenOut: "SOL", amountIn: 2.0 }
];

// Function to place a single order
async function placeOrder(orderData, orderNumber) {
  console.log(`Placing Order ${orderNumber}: ${orderData.amountIn} ${orderData.tokenIn} → ${orderData.tokenOut}`);
  
  const myHeaders = new Headers();
  myHeaders.append("Content-Type", "application/json");

  const raw = JSON.stringify(orderData);

  const requestOptions = {
    method: "POST",
    headers: myHeaders,
    body: raw,
    redirect: "follow"
  };

  try {
    const response = await fetch(API_URL, requestOptions);
    const result = await response.text();
    
    if (response.ok) {
      const orderResult = JSON.parse(result);
      console.log(`Order ${orderNumber} SUCCESS:`, orderResult.orderId);
      return { success: true, orderId: orderResult.orderId, data: orderResult };
    } else {
      console.log(`Order ${orderNumber} FAILED:`, result);
      return { success: false, error: result };
    }
  } catch (error) {
    console.log(`Order ${orderNumber} ERROR:`, error.message);
    return { success: false, error: error.message };
  }
}

// Place all orders simultaneously
async function placeAllOrders() {
  console.log('Placing 5 orders simultaneously...\n');
  
  const startTime = Date.now();
  
  // Create promises for all orders
  const orderPromises = orders.map((order, index) => 
    placeOrder(order, index + 1)
  );
  
  // Execute all orders concurrently
  const results = await Promise.allSettled(orderPromises);
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  // Count results
  const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failed = results.length - successful;
  
  console.log('\nRESULTS:');
  console.log(`Successful: ${successful}/5`);
  console.log(`Failed: ${failed}/5`);
  console.log(`Total Time: ${duration}ms`);
  
  // Show successful order IDs
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.success) {
      console.log(`Order ${index + 1} ID: ${result.value.orderId}`);
    }
  });
}

// Run the script
placeAllOrders().catch(console.error);
