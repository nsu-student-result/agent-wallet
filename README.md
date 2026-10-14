# Agent Wallet — Self-Guarding Autonomous On-Chain Wallet

An autonomous, risk-aware blockchain wallet that can plan and execute
transactions within user-approved limits. The AI agent proposes actions;
an independent security layer decides whether they are permitted; the
smart contract enforces the rules on-chain.

## Core Idea

**Autonomy without unrestricted authority.**

The agent can act independently, but only within the boundaries the
wallet owner has approved. The AI can never override the contract.

## Architecture

    ┌──────────────┐     proposal     ┌──────────────┐
    │   Planner    │ ───────────────▶ │   Guardian   │
    │ (off-chain)  │                  │ (off-chain)  │
    └──────────────┘                  └──────┬───────┘
                                             │ approved?
                                             ▼
                                      ┌──────────────┐
                                      │ AgentWallet  │
                                      │  (on-chain)  │
                                      │  enforces    │
                                      │  all rules   │
                                      └──────────────┘

Three layers:

1. **Planner** — proposes a transaction (rule-based for now; swappable
   with an LLM that produces the same JSON shape).
2. **Guardian** — validates the proposal by reading the contract's own
   `checkPolicy` view. Explains rejections in plain language.
3. **AgentWallet contract** — the final authority. Even if the guardian
   is bypassed, the contract will revert any rule-breaking transaction.

On failure, the agent performs **bounded safe recovery**: it halves the
amount, re-checks with the guardian, and retries once. Security rules
are never relaxed.

## Smart Contract

`src/AgentWallet.sol` implements:

- Owner-controlled configuration
- Authorized agent role
- Approved-token allowlist
- Approved-recipient allowlist
- Max amount per transaction
- Daily spending limit
- Emergency pause
- Reentrancy protection (OpenZeppelin)
- On-chain events for every decision and execution

## Project Layout

    src/AgentWallet.sol          Smart contract wallet
    src/MockToken.sol            Test ERC-20 token
    test/AgentWallet.t.sol       Foundry tests (10 tests)
    script/Deploy.s.sol          Deploy script
    agent/planner.js             Off-chain planner
    agent/guardian.js            Off-chain policy checker
    agent/executor.js            Bounded retry executor
    agent/demo.js                Full demo orchestration
    agent/run.js                 CLI entry point
    server/index.js              Dashboard web server
    server/public/index.html     Dashboard UI

## Setup

    # 1. Install Foundry dependencies
    forge install

    # 2. Install JS dependencies
    npm install

    # 3. Copy .env.example to .env and fill in addresses after deploy
    cp .env.example .env

### Terminal 1 — Start a local chain

    anvil

### Terminal 2 — Deploy the wallet and token

    forge script script/Deploy.s.sol \
      --rpc-url http://127.0.0.1:8545 \
      --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
      --broadcast

Copy the two printed addresses (`MockToken`, `AgentWallet`) into `.env`.

### Terminal 3 — Run the CLI demo

    node agent/run.js

### Terminal 3 — Or run the dashboard

    node server/index.js

Then open http://localhost:3000 and click **Run Demo**.

## Demo Output

    --- Plan #1 ---
    Amount : 500 mUSD
    Guardian: REJECTED (exceeds max per transaction)
    → Skipped. Contract would revert.

    --- Plan #2 ---
    Amount : 50 mUSD
    Guardian: APPROVED (ok)
    → Attempt 1: 50000000000000000000 (raw units)
    → Executed in 1 attempt(s). tx: 0x...

    --- Plan #3 ---
    Amount : 80 mUSD
    Guardian: APPROVED (ok)
    → Attempt 1: 80000000000000000000 (raw units)
    → Failed: reverted (insufficient balance)
    → Replanned to 40000000000000000000 (raw units), retrying...
    → Attempt 2: 40000000000000000000 (raw units)
    → Executed in 2 attempt(s). tx: 0x...

The demo shows three distinct outcomes:

- **Rejection** — an unsafe action is blocked before execution.
- **Success** — a valid action runs on-chain.
- **Recovery** — a failing action is safely replanned and succeeds
  without weakening any security rule.

## Testing

    forge test

All 10 tests pass, covering:

- Owner-only configuration
- Agent-only execution
- Token allowlist enforcement
- Recipient allowlist enforcement
- Per-transaction limit
- Daily spending limit
- Pause behavior
- Policy reason strings

## Security Notes

- All limits are enforced by the smart contract, not the AI.
- The agent cannot modify its own permissions.
- Pausing is owner-only.
- Reentrancy is blocked.
- Test keys in `.env.example` are well-known Foundry defaults and must
  never be used with real funds.

## Limitations

- The planner is rule-based in this prototype; an LLM can be dropped in
  without changing the guardian or contract.
- Swaps are simulated with plain ERC-20 transfers against mock tokens.
- No production audit has been performed.
- The dashboard links to transaction hashes but does not yet include a
  block explorer — deploy to a public testnet for clickable links.

## License

MIT
