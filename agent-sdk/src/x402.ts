/**
 * x402 Client Library
 * 
 * HTTP 402 Payment Required client for AI agent micropayments.
 * Handles the x402 payment flow automatically.
 */

import { Keypair, Connection, Transaction, SystemProgram, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";

export interface X402ClientConfig {
  /** Solana keypair for signing payments */
  keypair: Keypair;
  /** Solana RPC connection */
  connection: Connection;
  /** Maximum amount willing to pay per request (lamports) */
  maxPaymentPerRequest?: number;
  /** Auto-pay when receiving 402? Default: true */
  autoPayEnabled?: boolean;
}

export interface X402PaymentRequirement {
  amount: number;
  recipient: string;
  network: string;
  expires: string;
  nonce: string;
  description?: string;
  resourceId?: string;
}

export interface X402PaymentResult {
  signature: string;
  payer: string;
  amount: number;
  nonce: string;
}

export interface X402Response<T> {
  success: boolean;
  data?: T;
  payment?: X402PaymentResult;
  paymentRequired?: X402PaymentRequirement;
  error?: string;
}

/**
 * x402 Payment Client
 * 
 * Handles automatic payment for 402 responses.
 */
export class X402Client {
  private keypair: Keypair;
  private connection: Connection;
  private maxPayment: number;
  private autoPayEnabled: boolean;

  constructor(config: X402ClientConfig) {
    this.keypair = config.keypair;
    this.connection = config.connection;
    this.maxPayment = config.maxPaymentPerRequest ?? 1_000_000_000; // 1 SOL default max
    this.autoPayEnabled = config.autoPayEnabled ?? true;
  }

  /**
   * Make a payment to fulfill a 402 requirement
   */
  async makePayment(requirement: X402PaymentRequirement): Promise<X402PaymentResult> {
    // Check if expired
    if (new Date(requirement.expires) < new Date()) {
      throw new Error("Payment requirement has expired");
    }

    // Check max payment limit
    if (requirement.amount > this.maxPayment) {
      throw new Error(
        `Payment amount ${requirement.amount} exceeds max allowed ${this.maxPayment}`
      );
    }

    // Create and send payment transaction
    const recipient = new PublicKey(requirement.recipient);
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.keypair.publicKey,
        toPubkey: recipient,
        lamports: requirement.amount,
      })
    );

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.keypair],
      { commitment: "confirmed" }
    );

    return {
      signature,
      payer: this.keypair.publicKey.toBase58(),
      amount: requirement.amount,
      nonce: requirement.nonce,
    };
  }

  /**
   * Add payment proof headers to a request
   */
  static addPaymentHeaders(
    headers: Record<string, string>,
    payment: X402PaymentResult
  ): Record<string, string> {
    return {
      ...headers,
      "X-Payment-Signature": payment.signature,
      "X-Payment-Payer": payment.payer,
      "X-Payment-Amount": payment.amount.toString(),
      "X-Payment-Nonce": payment.nonce,
    };
  }

  /**
   * Parse payment requirement from 402 response headers
   */
  static parsePaymentRequirement(
    headers: Headers | Record<string, string>
  ): X402PaymentRequirement | null {
    const get = (name: string): string | null => {
      if (headers instanceof Headers) {
        return headers.get(name);
      }
      return headers[name] || headers[name.toLowerCase()] || null;
    };

    const required = get("X-Payment-Required");
    if (required !== "true") return null;

    const amount = get("X-Payment-Amount");
    const recipient = get("X-Payment-Recipient");
    const network = get("X-Payment-Network");
    const expires = get("X-Payment-Expires");
    const nonce = get("X-Payment-Nonce");

    if (!amount || !recipient || !network || !expires || !nonce) {
      return null;
    }

    return {
      amount: parseInt(amount, 10),
      recipient,
      network,
      expires,
      nonce,
      description: get("X-Payment-Description") || undefined,
      resourceId: get("X-Payment-Resource-Id") || undefined,
    };
  }

  /**
   * Make an x402-aware fetch request
   * 
   * Automatically handles 402 responses by making payment and retrying.
   */
  async fetch<T = any>(
    url: string,
    init?: RequestInit
  ): Promise<X402Response<T>> {
    // First request
    const res1 = await fetch(url, init);

    // If not 402, return normally
    if (res1.status !== 402) {
      if (!res1.ok) {
        return {
          success: false,
          error: `HTTP ${res1.status}: ${res1.statusText}`,
        };
      }
      return {
        success: true,
        data: await res1.json(),
      };
    }

    // Parse 402 payment requirement
    const requirement = X402Client.parsePaymentRequirement(res1.headers);
    if (!requirement) {
      return {
        success: false,
        error: "Received 402 but could not parse payment requirements",
      };
    }

    // If auto-pay disabled, return requirement
    if (!this.autoPayEnabled) {
      return {
        success: false,
        paymentRequired: requirement,
        error: "Payment required (auto-pay disabled)",
      };
    }

    // Make payment
    let payment: X402PaymentResult;
    try {
      payment = await this.makePayment(requirement);
    } catch (err) {
      return {
        success: false,
        paymentRequired: requirement,
        error: `Payment failed: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }

    // Retry with payment proof
    const headersWithPayment = X402Client.addPaymentHeaders(
      init?.headers as Record<string, string> || {},
      payment
    );

    const res2 = await fetch(url, {
      ...init,
      headers: headersWithPayment,
    });

    if (!res2.ok) {
      return {
        success: false,
        payment,
        error: `HTTP ${res2.status} after payment: ${res2.statusText}`,
      };
    }

    return {
      success: true,
      data: await res2.json(),
      payment,
    };
  }

  /**
   * Convenience method for POST requests
   */
  async post<T = any>(
    url: string,
    body: object,
    headers?: Record<string, string>
  ): Promise<X402Response<T>> {
    return this.fetch<T>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * Convenience method for GET requests
   */
  async get<T = any>(
    url: string,
    headers?: Record<string, string>
  ): Promise<X402Response<T>> {
    return this.fetch<T>(url, {
      method: "GET",
      headers,
    });
  }

  /**
   * Get the payer wallet address
   */
  getPayerAddress(): string {
    return this.keypair.publicKey.toBase58();
  }

  /**
   * Set maximum payment per request
   */
  setMaxPayment(lamports: number): void {
    this.maxPayment = lamports;
  }

  /**
   * Enable/disable auto-payment
   */
  setAutoPayEnabled(enabled: boolean): void {
    this.autoPayEnabled = enabled;
  }
}

/**
 * Create an x402 client from a secret key
 */
export function createX402Client(
  secretKey: Uint8Array,
  rpcUrl: string,
  options?: Partial<X402ClientConfig>
): X402Client {
  const keypair = Keypair.fromSecretKey(secretKey);
  const connection = new Connection(rpcUrl, "confirmed");
  return new X402Client({
    keypair,
    connection,
    ...options,
  });
}

/**
 * Create an x402 client from a base58 private key
 */
export function createX402ClientFromBase58(
  privateKeyBase58: string,
  rpcUrl: string,
  options?: Partial<X402ClientConfig>
): X402Client {
  const { decode } = require("bs58");
  const secretKey = decode(privateKeyBase58);
  return createX402Client(secretKey, rpcUrl, options);
}
