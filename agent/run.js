import { runDemo } from "./demo.js";

runDemo((msg) => console.log(msg)).catch((err) => {
  console.error(err);
  process.exit(1);
});
