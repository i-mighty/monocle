import { Connection, PublicKey, Transaction, SystemProgram, Keypair, sendAndConfirmTransaction } from "@solana/web3.js";
import { query } from "../db/client";

const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(process.env.SOLANA_PAYER_SECRET || "[]")));

export async function sendMicropayment(sender: string, receiver: string, amountLamports: number) {
  const connection = new Connection(RPC, "confirmed");
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(sender),
      toPubkey: new PublicKey(receiver),
      lamports: amountLamports
    })
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  await query("insert into payments(sender, receiver, amount, tx_signature) values ($1,$2,$3,$4)", [
    sender,
    receiver,
    amountLamports / 1e9,
    sig
  ]);
  return sig;
}

