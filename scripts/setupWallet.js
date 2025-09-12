const { Keypair } = require('@solana/web3.js');

function generateWallet() {
  // Generate new keypair
  const keypair = Keypair.generate();
  
  // Get public key (wallet address)
  const publicKey = keypair.publicKey.toString();
  
  // Get private key as base64 (for environment variable)
  const privateKeyBase64 = Buffer.from(keypair.secretKey).toString('base64');
  
  // Display information
  console.log(`Public Key: ${publicKey}`);
  console.log(`Private Key: ${privateKeyBase64}`);
}

// Run the script
generateWallet();
