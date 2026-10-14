import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil, publicClient, walletAbi } from "./guardian.js";

/**
 * Execute a single approved proposal.
 * Returns { ok: boolean, hash?: string, error?: string }.
 */
export async function executeOnce(proposal) {
  const agentAccount = privateKeyToAccount(process.env.AGENT_KEY);

  const walletClient = createWalletClient({
    account: agentAccount,
    chain: anvil,
    transport: http(process.env.RPC_URL),
  });

  try {
    const hash = await walletClient.writeContract({
      address: process.env.WALLET_ADDRESS,
      abi: walletAbi,
      functionName: "executeTransfer",
      args: [
        BigInt(proposal.planId),
        proposal.token,
        proposal.to,
        BigInt(proposal.amount),
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return { ok: false, hash, error: "transaction reverted" };
    }
    return { ok: true, hash };
  } catch (err) {
    return { ok: false, error: err.shortMessage || err.message };
  }
}

/**
 * Execute an approved proposal with bounded retry.
 * If the first attempt fails, we retry ONCE at half the amount.
 * Security rules are never relaxed — the retry must still pass
 * the guardian and the contract.
 *
 * `log` is called with human-readable progress strings.
 */
export async function executeWithRetry(
  proposal,
  guardian,
  maxAttempts = 2,
  log = console.log
) {
  let attempt = proposal;

  for (let i = 1; i <= maxAttempts; i++) {
    log(`Attempt ${i}: ${attempt.amount} (raw units)`);

    const result = await executeOnce(attempt);
    if (result.ok) {
      return { ok: true, hash: result.hash, attempts: i };
    }

    log(`Failed: ${result.error}`);

    if (i === maxAttempts) break;

    const halved = (BigInt(attempt.amount) / 2n).toString();
    const replanned = { ...attempt, amount: halved };

    const decision = await guardian(replanned);
    if (!decision.approved) {
      log(`Replan rejected by guardian: ${decision.reason}`);
      return { ok: false, error: "replan rejected" };
    }

    log(`Replanned to ${halved} (raw units), retrying...`);
    attempt = replanned;
  }

  return { ok: false, error: "max attempts reached" };
}
