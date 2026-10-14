# Security Self-Assessment Report — Agent Wallet

**Scope:** `AgentWallet.sol`, off-chain planner, guardian, and executor.
**Status:** Prototype (competition build). Not audited.
**Date:** October 2026.

## 1. Executive Summary

Agent Wallet separates three concerns that are usually tangled together:
*proposal*, *permission*, and *enforcement*. The AI can only propose. A
deterministic off-chain guardian interprets the contract's rules. The
smart contract is the only component that can actually move funds, and
it enforces every rule regardless of what the AI or guardian claim.

This self-assessment lists what is protected, what is not, and what
must be done before any real-value deployment.

## 2. Permission Tiers

The wallet implements four distinct tiers of authority.

### Tier 0 — Observers (no authority)
Anyone can read the contract state (`allowedToken`, `maxPerTx`,
`dailyLimit`, `paused`) and call `checkPolicy()`. Reading is free and
grants no control.

### Tier 1 — Agent (execution only)
The agent can call exactly one privileged function:
`executeTransfer(planId, token, to, amount)`.
It cannot:
- change the agent address,
- add or remove allowlisted tokens or recipients,
- change spending limits,
- pause or unpause the wallet,
- withdraw funds to itself.

Every call is checked against the full policy before any token moves.

### Tier 2 — Owner (configuration)
The owner can:
- set or replace the agent,
- add or remove allowed tokens,
- add or remove allowed recipients,
- change `maxPerTx` and `dailyLimit`,
- pause / unpause,
- fund the wallet via `deposit()`.

The owner cannot bypass `checkPolicy` — even the owner calling
`executeTransfer` would fail, because `executeTransfer` is `onlyAgent`.

### Tier 3 — Contract (enforcement)
The contract itself is the only entity that can move tokens out of the
wallet. It does so only when every rule is satisfied.

## 3. Safety Guardrails

| Guardrail                  | Where enforced       | Behavior on violation              |
|----------------------------|----------------------|------------------------------------|
| Token allowlist            | Contract `checkPolicy` | Reverts with "token not allowed"  |
| Recipient allowlist        | Contract `checkPolicy` | Reverts with "recipient not allowed" |
| Max per transaction        | Contract `checkPolicy` | Reverts with "exceeds max per transaction" |
| Daily limit                | Contract `checkPolicy` | Reverts with "exceeds daily limit" |
| Zero amount rejection      | Contract `checkPolicy` | Reverts with "amount is zero"     |
| Emergency pause            | Contract `whenNotPaused` | Reverts; no execution possible  |
| Reentrancy                 | `nonReentrant`       | Reverts                            |
| Non-standard ERC-20        | `SafeERC20`          | Handled safely                     |
| Off-chain schema drift     | Guardian validation  | Proposal rejected before RPC call  |
| On-chain revert after approval | Executor retry   | Halving replan, re-checked, 1 retry |

Note: **slippage caps** are mentioned in the brief but are not applicable
to this prototype because swaps are simulated with plain ERC-20
transfers. A production swap integration would add a `minAmountOut`
field to the proposal and enforce it inside the contract — see §6.

## 4. Threat Model

### 4.1 In-scope threats (mitigated)

| Threat                                        | Mitigation                                                 |
|-----------------------------------------------|------------------------------------------------------------|
| AI proposes an oversized single transfer      | `maxPerTx`                                                |
| AI drains over many small transfers           | `dailyLimit` rolling window                               |
| AI interacts with a malicious token contract  | `allowedToken` allowlist                                  |
| AI sends to an attacker-controlled address    | `allowedRecipient` allowlist                              |
| Compromised guardian approves a bad proposal  | Contract still reverts; guardian has no signing authority |
| Compromised planner rewrites its own rules    | Planner has no on-chain role                              |
| Hostile token reenters the wallet             | `nonReentrant`                                            |
| Owner needs to halt everything immediately    | `pause()`                                                 |
| Silent failure (no record)                    | `Executed` and `PolicyRejected` events                    |

### 4.2 Out-of-scope threats (not yet addressed)

These are acknowledged and must be handled before any real-value use.

- **Owner key compromise.** A stolen owner key can reconfigure the
  wallet. Production deployments should use a multisig owner or
  timelocked configuration changes.
- **Agent key compromise.** A stolen agent key can execute any
  policy-compliant transaction until the owner calls `setAgent` or
  `pause`. This is a fundamental limit: the agent must hold a hot key
  to act autonomously.
- **Front-running.** Transactions are visible in the mempool before
  inclusion. No protection is implemented.
- **Price / oracle manipulation.** Not applicable to the current
  prototype because there are no live swaps.
- **MEV extraction.** No protection is implemented.
- **`block.timestamp` manipulation.** The daily window uses
  `block.timestamp / 1 days`. Validators can nudge this by a few
  seconds; the impact on a 24-hour window is negligible for our use
  case but should be reconsidered for high-value deployments.
- **ERC-20 tokens with transfer hooks or fee-on-transfer logic.**
  `SafeERC20` handles non-standard return values, but a fee-on-transfer
  token would still break the accounting assumption that the wallet
  sends `amount` and the recipient receives `amount`.
- **Gas griefing / denial of service.** Out of scope.

## 5. Failure Handling

The agent uses *bounded safe recovery*. If a guardian-approved
transaction reverts on-chain (e.g. insufficient balance), the agent:

1. Halves the requested amount.
2. Re-runs the same guardian policy check on the halved proposal.
3. Retries once if the guardian approves.
4. Stops if the retry also fails.

The retry is bounded (max 2 attempts) and never relaxes a security rule.
The guardian's rejection of the replanned proposal immediately ends
recovery — there is no "override" path.

## 6. Known Gaps and Recommended Next Steps

| Gap                                     | Recommended fix                                                    |
|-----------------------------------------|--------------------------------------------------------------------|
| Owner key is a single EOA               | Replace with a multisig (Safe) or timelocked admin                 |
| Agent key is a hot key                  | Consider session keys with expiry, or hardware-backed signer       |
| No slippage enforcement (prototype)     | Add `minAmountOut` to proposals; enforce in contract               |
| No on-chain swap integration            | Integrate a router and enforce slippage on-chain                   |
| Daily window uses `block.timestamp`     | Consider a more robust oracle for high-value deployments           |
| No formal verification                  | Run a symbolic checker (e.g. Halmos) on critical invariants        |
| No third-party audit                    | Commission an audit before mainnet deployment with real funds      |
| Fee-on-transfer tokens unsupported      | Reject such tokens at allowlist time or account for fee in policy  |

## 7. Test Coverage

The Foundry test suite covers the following invariants and behaviors:

- Only the owner can call `setAgent`, `setTokenAllowed`,
  `setRecipientAllowed`, `setLimits`, `pause`, `unpause`.
- Only the agent can call `executeTransfer`.
- Non-allowlisted tokens are rejected.
- Non-allowlisted recipients are rejected.
- Amounts over `maxPerTx` are rejected.
- Cumulative spending over `dailyLimit` is rejected.
- A paused wallet rejects execution.
- `checkPolicy` returns the correct reason string for each violation.

Additional adversarial and fuzz tests are recommended as future work.

## 8. Conclusion

Within its stated scope, Agent Wallet enforces the owner's rules
independently of the AI. The AI cannot widen its own authority, cannot
interact with unapproved assets or addresses, and cannot exceed spending
limits. Failures are contained by bounded retry rather than by relaxing
any rule.

The design is honest about its limits: it does not claim to be
unhackable, it does not trust the AI, and it does not pretend the
prototype is production-ready. The security posture is "autonomy
without unrestricted authority", enforced in code the AI cannot change.
