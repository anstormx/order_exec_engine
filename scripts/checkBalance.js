const { Connection, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddress } = require('@solana/spl-token');
const { Keypair } = require('@solana/web3.js');

require('dotenv').config();

const TOKEN_MINTS = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Mainnet USDC
};

async function checkBalances() {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Get wallet address
  const privateKeyBytes = Buffer.from(process.env.PRIVATE_KEY, 'base64');
  const keypair = Keypair.fromSecretKey(privateKeyBytes);
  const walletAddress = keypair.publicKey.toString();
  
  console.log('Checking balances for wallet:', walletAddress);
  
  const publicKey = new PublicKey(walletAddress);
  
  try {
    // Check SOL balance
    const solBalance = await connection.getBalance(publicKey);
    console.log(`SOL Balance: ${(solBalance / 1e9).toFixed(4)} SOL`);

    // Check token balances
    for (const [symbol, mint] of Object.entries(TOKEN_MINTS)) {
      try {
        const tokenAccount = await getAssociatedTokenAddress(
          new PublicKey(mint),
          publicKey
        );
        
        const balance = await connection.getTokenAccountBalance(tokenAccount);
        console.log(`${symbol} Balance: ${balance.value.uiAmount || 0} ${symbol}`);
      } catch (error) {
        console.log(`${symbol} Balance: 0 ${symbol} (no token account)`);
      }
    }
    
  } catch (error) {
    console.error('Error checking balances:', error.message);
    process.exit(1);
  }
}

checkBalances();
