import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

export class SolanaConnectionManager {
  public connection: Connection;
  public wallet: Keypair;
  
  // Common devnet token mints
  public static readonly TOKEN_MINTS = {
    SOL: 'So11111111111111111111111111111111111111112', // Wrapped SOL
    USDC: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // Devnet USDC
  };

  constructor(rpcUrl: string, privateKeyBase64: string) {
    this.connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
    });
    
    // Decode private key from base64
    const privateKeyBytes = Buffer.from(privateKeyBase64, 'base64');
    this.wallet = Keypair.fromSecretKey(privateKeyBytes);
    
    console.log(`Connected to Solana devnet: ${rpcUrl}`);
    console.log(`Wallet address: ${this.wallet.publicKey.toString()}`);
  }

  async getBalance(): Promise<number> {
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    return balance / 1e9; // Convert lamports to SOL
  }

  async ensureTokenAccount(tokenMint: string): Promise<PublicKey> {
    const mintPubkey = new PublicKey(tokenMint);
    const tokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      this.wallet.publicKey
    );

    try {
      // Check if token account exists
      await this.connection.getTokenAccountBalance(tokenAccount);
      return tokenAccount;
    } catch (error) {
      // Token account doesn't exist, we'll need to create it
      console.log(`Token account for ${tokenMint} needs to be created`);
      return tokenAccount;
    }
  }

  async checkDevnetConnection(): Promise<boolean> {
    try {
      const version = await this.connection.getVersion();
      console.log(`Solana devnet version: ${version['solana-core']}`);
      
      const balance = await this.getBalance();
      console.log(`Wallet SOL balance: ${balance.toFixed(4)} SOL`);
      
      return true;
    } catch (error) {
      console.error('Failed to connect to Solana devnet:', error);
      return false;
    }
  }
}
