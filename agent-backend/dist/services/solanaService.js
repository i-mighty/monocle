import { Connection, PublicKey, Transaction, SystemProgram, Keypair, sendAndConfirmTransaction } from "@solana/web3.js";
import { query } from "../db/client";
const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
let payer = null;
try {
    const secret = process.env.SOLANA_PAYER_SECRET;
    if (secret) {
        payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(secret)));
    }
    else {
        console.warn("⚠️  SOLANA_PAYER_SECRET not set. Solana payments will fail.");
    }
}
catch (e) {
    console.error("Failed to load Solana payer:", e);
}
export async function sendMicropayment(sender, receiver, amountLamports) {
    if (!payer) {
        throw new Error("Solana payer not configured. Set SOLANA_PAYER_SECRET environment variable.");
    }
    const connection = new Connection(RPC, "confirmed");
    const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: new PublicKey(sender),
        toPubkey: new PublicKey(receiver),
        lamports: amountLamports
    }));
    const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
    await query("insert into payments(sender, receiver, amount, tx_signature) values ($1,$2,$3,$4)", [
        sender,
        receiver,
        amountLamports / 1e9,
        sig
    ]);
    return sig;
}
