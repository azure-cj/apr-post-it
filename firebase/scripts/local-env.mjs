// Writes the emulator's own settings into functions/, once: CLAUDE_URL pointing at the Claude stand-in on port 8799
// (functions/.env.local overrides functions/.env in the emulator only), and a made-up CLAUDE_API_KEY
// (functions/.secret.local), so the emulator never asks Secret Manager for the real key. Both files are ignored by git.

import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const functions = join(dirname(fileURLToPath(import.meta.url)), "..", "functions");

const files = {
  ".env.local": "CLAUDE_URL=http://127.0.0.1:8799\n",
  ".secret.local": "CLAUDE_API_KEY=stand-in-key-not-a-real-one\n",
};

for (const [name, content] of Object.entries(files)) {
  const path = join(functions, name);
  if (!existsSync(path)) {
    writeFileSync(path, content);
    console.log(`Wrote functions/${name} for the emulator.`);
  }
}
