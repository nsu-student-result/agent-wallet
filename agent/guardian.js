import "dotenv/config";
import { createPublicClient, http } from "viem";
import { defineChain } from "viem";

// Local Anvil chain definition
export const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL] } },
});

export const publicClient = createPublicClient({
  chain: anvil,
  transport: http(process.env.RPC_URL),
});

// Minimal ABI — only the functions we need
export const walletAbi = [
  {
    type: "function",
    name: "checkPolicy",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [
      { name: "ok", type: "bool" },
      { name: "reason", type: "string" },
    ],
  },
  {
    type: "function",
    name: "executeTransfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "planId", type: "uint256" },
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
];

/**
 * Guardian: validate a proposal against the wallet's on-chain policy.
 * Returns { approved: boolean, reason: string }.
 */
export async function checkProposal(proposal) {
  // 1. Off-chain schema validation (guard against malformed AI output)
  if (!proposal || typeof proposal !== "object") {
    return { approved: false, reason: "proposal is not an object" };
  }
  const required = ["planId", "token", "to", "amount"];
  for (const key of required) {
    if (proposal[key] === undefined) {
      return { approved: false, reason: `missing field: ${key}` };
    }
  }

  // 2. Ask the contract itself — this is the source of truth
  try {
    const [ok, reason] = await publicClient.readContract({
      address: process.env.WALLET_ADDRESS,
      abi: walletAbi,
      functionName: "checkPolicy",
      args: [proposal.token, proposal.to, BigInt(proposal.amount)],
    });
    return { approved: ok, reason: reason || "" };
  } catch (err) {
    return { approved: false, reason: `policy read failed: ${err.message}` };
  }
}