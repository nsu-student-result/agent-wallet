# Technical Documentation — Agent Wallet

## 1. System Overview

Agent Wallet is a self-guarding autonomous on-chain wallet. It allows an
AI agent to plan and execute blockchain transactions while guaranteeing
that the agent can never exceed the authority granted by the wallet
owner. This is achieved through a strict three-layer separation:

    ┌────────────────────┐
    │   AI Planner       │   Proposes an action (JSON proposal)
    │  (off-chain, JS)   │
    └─────────┬──────────┘
              │ proposal
              ▼
    ┌────────────────────┐
    │  Security Guardian │   Reads on-chain policy. Approves / rejects.
    │  (off-chain, JS)   │   Explains the reason.
    └─────────┬──────────┘
              │ approved proposal
              ▼
    ┌────────────────────┐
    │  AgentWallet.sol   │   Final authority. Enforces every rule
    │  (on-chain)        │   even if the guardian is bypassed.
    └────────────────────┘

The core principle is: **autonomy without unrestricted authority**.

## 2. Separation of Powers

The design deliberately avoids trusting the AI. It never holds the keys
to a rule that decides whether an action is allowed. Instead:

- The **Planner** is the only component that can be replaced or upgraded
  freely (rule-based today, LLM tomorrow) without affecting security.
- The **Guardian** is a deterministic policy reader. It has no authority
  of its own — it simply asks the contract `checkPolicy()` and reports
  the answer.
- The **Contract** is the sole source of truth. It holds all state
  (allowlists, limits, pause flag, spending counters) and will revert
  any transaction that breaks a rule.

Because the guardian is only a *messenger*, an attacker who compromises
it gains nothing: the contract would still reject the transaction. And
because the planner has no on-chain authority, a compromised AI cannot
change its own permissions.

## 3. Core Algorithms

### 3.1 Proposal generation (Planner)

The planner receives a context object (token, recipient, target amount,
reason) and returns a structured proposal:

    {
      planId:  <uint>,
      token:   <address>,
      to:      <address>,
      amount:  <uint>,
      reason:  <string>
    }

The shape is intentionally stable so an LLM can be dropped in later
without touching the guardian or the contract.

### 3.2 Policy check (Guardian, on-chain truth)

The guardian calls the contract's read-only `checkPolicy` function:

    function checkPolicy(token, to, amount)
        returns (bool ok, string reason)

The contract checks, in order:

1. Wallet not paused
2. Token is allowlisted
3. Recipient is allowlisted
4. Amount is non-zero
5. Amount ≤ maxPerTx
6. projectedSpend + amount ≤ dailyLimit

The first failing condition determines the returned reason string.
This gives the guardian a clear, human-readable message to log.

### 3.3 Bounded safe recovery (Executor)

If a guardian-approved transaction reverts on-chain (for example, the
wallet does not hold enough tokens), the agent performs a controlled
recovery:

1. Halve the amount.
2. Re-run the guardian check on the halved proposal.
3. If the guardian approves, retry once.
4. If the retry fails, stop.

At no point are the rules relaxed. The retry must pass the same policy
checks as the original proposal. This is what makes the recovery
"safe" rather than "escape".

Pseudo-code:

    attempt = proposal
    for i in 1..maxAttempts:
        result = executeOnce(attempt)
        if result.ok: return success
        halved = attempt.amount / 2
        replanned = { ...attempt, amount: halved }
        decision = guardian(replanned)
        if not decision.approved: return "replan rejected"
        attempt = replanned
    return "gave up safely"

### 3.4 Daily spending window

The contract tracks `spentToday` and `lastSpendDay`:

    day = block.timestamp / 1 days
    if day != lastSpendDay:
        spentToday = 0
        lastSpendDay = day

This provides a rolling 24-hour window keyed to UTC days without needing
an external oracle. It is simple, gas-cheap, and easy to audit.

## 4. Smart Contract Security Implementation

### 4.1 Roles

- `owner`  — configures the wallet (allowlists, limits, pause, agent).
- `agent`  — the only address allowed to call `executeTransfer`.

Modifiers `onlyOwner` and `onlyAgent` gate every privileged function.

### 4.2 Allowlists

Two mappings:

    mapping(address => bool) public allowedToken;
    mapping(address => bool) public allowedRecipient;

Both default to `false`. A token or recipient must be explicitly
enabled by the owner. This prevents the agent from interacting with
arbitrary contracts or addresses.

### 4.3 Spending limits

- `maxPerTx`   — hard cap on any single transfer.
- `dailyLimit` — cap on total spend within a UTC day.

Both are enforced inside `checkPolicy`, which is called by
`executeTransfer` before any state change or token movement.

### 4.4 Emergency pause

`pause()` / `unpause()` are owner-only and inherited from OpenZeppelin's
`Pausable`. `executeTransfer` is decorated with `whenNotPaused`, so a
paused wallet cannot execute any transaction even if the guardian
approves it.

### 4.5 Reentrancy protection

`executeTransfer` uses OpenZeppelin's `nonReentrant` modifier. Even
though the current implementation only performs outbound ERC-20
transfers, the modifier is kept in place so that future extensions
(such as swap routing) remain safe.

### 4.6 Safe token transfers

All ERC-20 movements use OpenZeppelin's `SafeERC20` wrapper, which
handles non-standard tokens that do not return a boolean.

### 4.7 Event audit trail

Every meaningful action emits an event:

    event AgentSet(address indexed agent);
    event TokenAllowed(address indexed token, bool allowed);
    event RecipientAllowed(address indexed recipient, bool allowed);
    event LimitsSet(uint256 maxPerTx, uint256 dailyLimit);
    event Executed(uint256 indexed planId, address token, address to,
                   uint256 amount, bytes32 policyHash);
    event PolicyRejected(uint256 indexed planId, string reason);
    event Deposited(address indexed token, address from, uint256 amount);

`Executed` carries a `policyHash` derived from the plan ID, token,
recipient, amount, and timestamp. This forms the on-chain "decision
passport" — an auditable link between the agent's plan and its
execution.

## 5. Threat Model and Mitigations

| Threat                                 | Mitigation                                                |
|----------------------------------------|-----------------------------------------------------------|
| AI proposes an oversized transfer      | `maxPerTx` enforced on-chain                              |
| AI attempts to drain over time         | `dailyLimit` enforced on-chain                            |
| AI interacts with a malicious token    | `allowedToken` allowlist                                  |
| AI sends to an attacker address        | `allowedRecipient` allowlist                              |
| Compromised guardian approves anything | Contract still reverts policy violations                  |
| Compromised planner changes its rules  | Planner has no on-chain authority; owner-only config      |
| Reentrancy from a hostile token        | `nonReentrant` modifier                                   |
| Owner needs to stop everything         | `pause()` halts all execution                             |
| Silent failures                        | `Executed` / `PolicyRejected` events + reason strings      |

## 6. Why This Design Matters

Most "AI + crypto" systems today either:

- Give the AI full signing power (catastrophic if compromised), or
- Require human approval for every action (no autonomy).

Agent Wallet takes the third path: the AI can act autonomously, but only
within boundaries that are enforced by code the AI cannot modify. If
the AI is wrong, the contract says no. If the AI is right, the contract
executes. The guardian exists to explain, not to permit.

## 7. Limitations

- The planner is rule-based in this prototype. An LLM can be dropped in
  without changing the guardian or the contract.
- Swaps are simulated with plain ERC-20 transfers against mock tokens.
- No third-party audit has been performed.
- Daily window is based on `block.timestamp`, which is subject to
  minor validator manipulation. This is acceptable for the intended
  use case but should be reconsidered for high-value deployments.
