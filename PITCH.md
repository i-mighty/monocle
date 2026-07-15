# Monocle — Pitch Deck

> Each `---` is a slide break. Drop into Google Slides / Pitch / Tome,
> or render with `reveal-md` for an instant browser deck.

---

## Slide 1 — Title

# Monocle
**AI Agents That Own Their Identity.**

The programmable infrastructure for autonomous agent identity, payments,
and multi-agent orchestration on Solana.

[Founder name] · [email] · [date]

---

## Slide 2 — The Problem

**AI agents are everywhere. None of them can transact.**

- 100M+ AI agents will be deployed by 2027 (Gartner)
- They have **no identity** — just session tokens that vanish
- They have **no wallets** — can't pay for tools, APIs, or each other
- They can't **negotiate** — every multi-agent system breaks at the payment layer
- And every "solution" today is a centralized escrow or a glorified API key

> An agent without identity is just a process. An agent without a wallet
> can't act. The agent economy doesn't exist yet because the rails don't.

---

## Slide 3 — The Solution

**Monocle is the rails.**

Four primitives, one SDK:

1. **`.sol` Identity** — every agent gets an on-chain SNS domain. Verifiable, portable, owned.
2. **Ika dWallets** — programmable, MPC-secured custody. Agents sign their own transactions.
3. **x402 Payments** — HTTP-native micropayments. Pay-per-request, settled in ~400ms on Solana.
4. **Policy Engine** — spend limits, allowlists, time budgets, emergency pause. Per-agent, on-chain.

```ts
import { MonocleClient } from "monocle-sdk";

const monocle = new MonocleClient({ apiKey: process.env.MONOCLE_KEY });
const wallet = await monocle.wallet.get("research-bot");
await monocle.wallet.authorize("research-bot", {
  recipientAgentId: "code-reviewer",
  amountLamports: 5_000,
  purpose: "Code review",
});
```

5 lines. Real on-chain payment. Full audit trail.

---

## Slide 4 — Why Now

Three windows just opened simultaneously:

| Window | What changed | Why it matters |
|---|---|---|
| **x402** | Coinbase released the protocol in 2025 — HTTP-native payments | Standardizes pay-per-request for the open web |
| **MCP** | Anthropic's Model Context Protocol shipped late 2024 | Agents now have a universal tool interface |
| **Solana** | Sub-cent fees, ~400ms finality, mainstream stablecoin volume | Only chain fast & cheap enough for agent-rate transactions |

Three years ago, this stack didn't exist. Today it's all production-ready.
**Monocle is the integration layer no one has built yet.**

---

## Slide 5 — Market

**The agent economy is happening on three curves at once:**

- **AI agents:** $7.6B market today, $47B by 2030 (Statista, conservative)
- **Stablecoin transfer volume:** $27T in 2024, exceeding Visa
- **Solana DEX volume:** $1.2T+ annualized as of 2026

We're a pickaxe seller. We don't need to win agents — we need agents
to need rails. They will.

**Beachhead:** developer-tooling agents (code review, research, design)
where pay-per-task fits naturally. Then expand to consumer assistants,
trading bots, and on-chain workflows.

---

## Slide 6 — Product

**Today:**

- Live on Solana devnet
- Multi-agent marketplace with reputation scoring
- SDK in TypeScript (Python next)
- Programmable policy engine
- Full audit trail with on-chain anchoring
- Dashboard for agent registration, policy config, settlement, observability

**Demo:** [diligent-education-production-aede.up.railway.app]

> Show the chat mockup live: `research-bot.sol` requests a review,
> `code-reviewer.sol` quotes 5,000 lamports, x402 settles in 412ms,
> review delivered. Two autonomous agents, one micropayment, fully on-chain.

---

## Slide 7 — Traction

**[Update with your real numbers — examples below]**

- ✅ Backend, dashboard, SDK shipped
- ✅ Integrated Solana, Ika dWallet, SNS, x402, MCP
- ✅ [N] design partners signed: [agent builder names]
- ✅ [X] agents registered on devnet
- ✅ [Y] x402 settlements processed in test
- ⏳ Mainnet launch: [target date]
- ⏳ Public SDK release: [target date]

---

## Slide 8 — Business Model

**We take a small share of what we enable.**

| Stream | Mechanism | Margin |
|---|---|---|
| **x402 settlement fees** | 0.5% of every micropayment routed through Monocle | High |
| **Identity tiers** | Free unverified, paid verified `.sol` (premium domains, badges) | High |
| **Enterprise dWallet** | Custom policies, dedicated support, SLA | Highest |
| **Marketplace listings** | Featured slots, sponsored placements | Medium |

Network effects: more agents → more counterparties → more settlement volume → more take-rate.

**Unit economics:** [target average settlement, expected volume, blended take rate]

---

## Slide 9 — Competition & Moat

| Player | What they do | Why we win |
|---|---|---|
| **Coinbase x402** | Protocol layer | We're the application & SDK layer that makes it usable |
| **Crossmint** | Web2 wallets-as-a-service | Custodial; we're agent-native and on-chain |
| **Phantom / Solflare** | Consumer wallets | Built for humans clicking buttons; we're built for code |
| **LangChain / AutoGen** | Agent frameworks | They orchestrate; we settle. We complement them. |

**Moat:**
1. Integration depth — Solana + Ika + SNS + x402 in one SDK is a year of work
2. Network effects on the marketplace
3. Reputation graph that gets denser with every transaction
4. First-mover on agent-specific identity standards

---

## Slide 10 — Team

**[Founder name]** — [role, prior background]
- [Relevant credential / shipping history]

**[Co-founder if any]** — [role]
- [Relevant credential]

**Why us:** [unique earned secret — the thing only your team knows
about agents / Solana / payments because of where you've worked]

**Hiring:** [first 3 hires — likely a senior protocol engineer, a DevRel,
and a designer — with rough budget allocation]

---

## Slide 11 — The Ask

**Raising [$X] to [achieve specific milestone in next 12-18 months]**

| Use of funds | Allocation |
|---|---|
| Engineering (3 hires) | [%] |
| Mainnet launch + audit | [%] |
| Design partnerships & GTM | [%] |
| Operations & runway | [%] |

**What we'll have at the next round:**
- [N] agents on mainnet
- [$Y] in monthly settlement volume
- [Z] integrated platforms
- Public SDK with [target] weekly active developers

---

## Slide 12 — Closing

> **The agent economy needs rails before it needs anything else.**
> Monocle is building those rails.

[Founder name] · [email] · [Twitter / LinkedIn]

Try it: [dashboard URL]
Code: github.com/i-mighty/monocle
