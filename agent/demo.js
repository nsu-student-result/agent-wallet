import "dotenv/config";
import { parseEther, formatEther } from "viem";
import { checkProposal } from "./guardian.js";
import { planDemo } from "./planner.js";
import { executeWithRetry } from "./executor.js";

/**
 * Run the full demo and return structured results.
 * Also calls `log` for streaming progress if provided.
 */
export async function runDemo(log = () => {}) {
  log("=== Agent Wallet Demo ===");

  const proposals = planDemo({
    token: process.env.TOKEN_ADDRESS,
    to: process.env.RECIPIENT,
    safeAmount: parseEther("50"),
    unsafeAmount: parseEther("500"),
    overBalanceAmount: parseEther("80"),
  });

  const results = [];

  for (const proposal of proposals) {
    const record = {
      planId: Number(proposal.planId),
      reason: proposal.reason,
      amount: formatEther(BigInt(proposal.amount)) + " mUSD",
      amountRaw: proposal.amount,
      guardian: null,
      execution: null,
      attempts: [],
    };

    log(`--- Plan #${record.planId} ---`);
    log(`Reason : ${record.reason}`);
    log(`Amount : ${record.amount}`);

    const decision = await checkProposal(proposal);
    record.guardian = decision;
    log(
      `Guardian: ${decision.approved ? "APPROVED" : "REJECTED"} (${
        decision.reason || "ok"
      })`
    );

    if (!decision.approved) {
      record.execution = { ok: false, skipped: true };
      log("Skipped. Contract would revert.");
      results.push(record);
      continue;
    }

    const result = await executeWithRetry(proposal, checkProposal, 2, (msg) => {
      record.attempts.push(msg);
      log(msg);
    });

    record.execution = result;
    if (result.ok) {
      log(`Executed in ${result.attempts} attempt(s). tx: ${result.hash}`);
    } else {
      log(`Gave up safely: ${result.error}`);
    }

    results.push(record);
  }

  log("=== Demo complete ===");
  return results;
}
