import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { runDemo } from "../agent/demo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/run", async (req, res) => {
  try {
    const results = await runDemo(() => {});
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/wallet", (req, res) => {
  res.json({
    wallet: process.env.WALLET_ADDRESS,
    token: process.env.TOKEN_ADDRESS,
    recipient: process.env.RECIPIENT,
    rpc: process.env.RPC_URL,
  });
});

app.listen(PORT, () => {
  console.log(`Dashboard: http://localhost:${PORT}`);
});
