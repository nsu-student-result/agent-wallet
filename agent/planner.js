/**
 * Planner: proposes an action.
 *
 * For this prototype we use a rule-based planner. It looks at the
 * current portfolio and proposes a transfer to move toward the target
 * allocation. Later this can be swapped for an LLM that outputs the
 * same JSON shape — the Guardian and contract do not care where the
 * proposal came from.
 */

export function proposeTransfer({ planId, token, to, amount, reason }) {
  return {
    planId,
    token,
    to,
    amount: amount.toString(),
    reason: reason || "rebalance portfolio",
  };
}

/**
 * Build the demo proposals:
 *   1. Unsafe: exceeds per-transaction limit  → Guardian rejects
 *   2. Safe: within all limits                → Guardian approves
 *   3. Over-balance: valid policy, but the wallet doesn't hold enough
 *      → Guardian approves, execution fails on-chain, agent replans
 *        by halving the amount, then succeeds.
 */
export function planDemo({ token, to, safeAmount, unsafeAmount, overBalanceAmount }) {
  return [
    proposeTransfer({
      planId: 1n,
      token,
      to,
      amount: unsafeAmount,
      reason: "Rebalance portfolio (oversized trade)",
    }),
    proposeTransfer({
      planId: 2n,
      token,
      to,
      amount: safeAmount,
      reason: "Rebalance portfolio (within limits)",
    }),
    proposeTransfer({
      planId: 3n,
      token,
      to,
      amount: overBalanceAmount,
      reason: "Rebalance portfolio (more than wallet holds)",
    }),
  ];
}
