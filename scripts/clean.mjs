import { rmSync, readdirSync, existsSync } from "node:fs";

const entries = readdirSync(".");
for (const entry of entries) {
  if (entry.endsWith(".tsbuildinfo")) {
    rmSync(entry, { recursive: true, force: true });
  }
}
if (existsSync("dist")) {
  rmSync("dist", { recursive: true, force: true });
}
