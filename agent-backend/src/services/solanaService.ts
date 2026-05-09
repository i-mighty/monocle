import { Connection, PublicKey, Transaction, SystemProgram, Keypair, sendAndConfirmTransaction } from "@solana/web3.js";
import { query } from "../db/client";

const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";

let payer: Keypair | null = null;
try {
  const secret = process.env.SOLANA_PAYER_SECRET;
  if (secret) {
    payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(secret)));
  } else {
    console.warn("⚠️  SOLANA_PAYER_SECRET not set. Solana payments will fail.");
  }
} catch (e) {
  console.error("Failed to load Solana payer:", e);
}

export function isSolanaPayerReady(): boolean {
  return payer !== null;
}

export function getPayerPublicKey(): string | null {
  return payer ? payer.publicKey.toBase58() : null;
}

/**
 * Pay a Solana wallet from the platform's payer keypair.
 * Used by the auto-settlement cron to send earned lamports to an agent's
 * registered settlement wallet.
 *
 * Returns the tx signature on success. Throws on failure (caller logs + marks
 * the settlement attempt 'failed' in DB).
 */
export async function settleToAgentWallet(
  toPubkey: string,
  amountLamports: number
): Promise<string> {
  if (!payer) {
    throw new Error("SOLANA_PAYER_SECRET not configured");
  }
  if (amountLamports <= 0) {
    throw new Error(`amountLamports must be positive (got ${amountLamports})`);
  }

  const connection = new Connection(RPC, "confirmed");
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: new PublicKey(toPubkey),
      lamports: amountLamports,
    })
  );

  // sendAndConfirmTransaction polls until the cluster confirms or times out.
  return await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
    maxRetries: 3,
  });
}

/**
 * @deprecated Legacy helper kept for any callers still importing it.
 * Use settleToAgentWallet for new code — sender is always the platform payer.
 */
export async function sendMicropayment(_sender: string, receiver: string, amountLamports: number) {
  const sig = await settleToAgentWallet(receiver, amountLamports);
  await query("insert into payments(sender, receiver, amount, tx_signature) values ($1,$2,$3,$4)", [
    getPayerPublicKey() ?? "platform",
    receiver,
    amountLamports / 1e9,
    sig,
  ]);
  return sig;
}

