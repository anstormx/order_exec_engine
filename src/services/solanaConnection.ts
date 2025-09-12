import { Connection, Keypair } from '@solana/web3.js';
import { ethers } from 'ethers';

export class SolanaConnectionManager {
  public connection: Connection;
  public wallet: Keypair;

  constructor(rpcUrl: string, privateKeyBase64: string) {
    this.connection = new Connection(rpcUrl);
    
    // Decode private key from base64
    const privateKeyBytes = Buffer.from(privateKeyBase64, 'base64');
    this.wallet = Keypair.fromSecretKey(privateKeyBytes);
    
    console.log(`Connected to Solana devnet: ${rpcUrl}`);
    console.log(`Wallet address: ${this.wallet.publicKey.toString()}`);
  }

  async getBalance(): Promise<string> {
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    return ethers.formatUnits(balance, 9); // Convert lamports to SOL
  }

  async checkDevnetConnection(): Promise<boolean> {
    try {
      const version = await this.connection.getVersion();
      console.log(`Solana devnet version: ${version['solana-core']}`);
      
      const balance = await this.getBalance();
      console.log(`Wallet SOL balance: ${balance} SOL`);
      
      return true;
    } catch (error) {
      console.error('Failed to connect to Solana devnet:', error);
      return false;
    }
  }
}
