# DeepBook Trading Agent — 3-Minute Demo Script

## [0:00-0:15] Opening

**Visual:** Dark-themed title screen with DeepBook logo + animated orderbook bars

**Narrator:**
"Meet DeepBook Trading Agent — an AI-powered TypeScript library that lets autonomous agents trade on Sui's native orderbook, DeepBook, with a verifiable audit trail on Walrus."

## [0:15-0:45] Architecture Overview

**Visual:** Architecture diagram showing: AI Agent → AgentTradingSession → PTBTrader → DeepBookClient → Sui (with Walrus off to the side)

**Narrator:**
"Here's how it works. An AI agent — whether it's a purpose-built bot or a general-purpose LLM — issues trading decisions through our AgentTradingSession. That session validates the decision, constructs a Programmable Transaction Block through the PTBTrader, and executes it on Sui's DeepBook orderbook. Every single trade is automatically stored on Walrus for permanent, verifiable auditing."

## [0:45-1:15] Code Demo — Connecting and Trading

**Visual:** Code scrolling on screen showing:
```typescript
const client = new DeepBookClient({ keypair });
const trader = new PTBTrader(client);

// Place a limit order
const result = await client.placeOrder({
  poolId: '0x...',
  side: 'bid',
  price: '1000',
  quantity: '500',
});
```

**Narrator:**
"Getting started is straightforward. Create a DeepBookClient with your keypair — it handles all the RPC connections and transaction signing. Then use the PTBTrader to build atomic trades. A limit order is just one method call, and the PTB ensures it's executed atomically on-chain."

## [1:15-1:45] Automated Strategies

**Visual:** Split screen: Left shows MarketMakingStrategy code, right shows animated orderbook with bid/ask lines bouncing

**Narrator:**
"For automated trading, we've built in four production-ready strategies. Market Making places and refreshes bid-ask orders around the mid price. Arbitrage monitors pools for price discrepancies and executes when profitable. Hedge protects positions across correlated markets. And Liquidity Strategy earns fees by providing liquidity to outcome token pools."

## [1:45-2:15] AI Agent Integration

**Visual:** Code showing executeAgentDecision with AI reasoning, then Walrus blob ID appearing

**Narrator:**
"The real power is AI agent integration. An agent can say 'I see a technical breakout, confidence 85%' and the session will execute it, store the decision and reasoning on Walrus, and track the resulting P&L. Every decision is auditable forever — no trust required."

## [2:15-2:45] Walrus Audit Trail

**Visual:** Animated Walrus blob being stored, then retrieved with TradingReport

**Narrator:**
"Walrus provides permanent storage on Sui. Every trade decision, market snapshot, and performance report gets stored as an immutable blob. You can retrieve the full audit history anytime — perfect for compliance, backtesting, and proving your bot's track record."

## [2:45-3:00] Closing

**Visual:** GitHub repo QR code + "Star on GitHub" callout

**Narrator:**
"DeepBook Trading Agent is open source and ready to use. Clone the repo, run the demo, and start building your own AI trading agents on Sui. Star us on GitHub and join the future of agentic finance."

---

## Production Notes

- **Music:** Low-fi electronic beat, copyright-free
- **Tone:** Professional, enthusiastic, tech-forward
- **Narrator Voice:** Clear, moderate pace, slightly warm
- **Visual Style:** Dark theme (#0a0e1a background), Sui green (#00d4aa) accents
- **Screen Recordings:** 1920x1080, terminal with dark theme
- **Code Font:** Monospace, 16pt, with syntax highlighting
