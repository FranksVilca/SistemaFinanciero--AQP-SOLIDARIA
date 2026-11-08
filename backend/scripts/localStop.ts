/**
 * Stops what `npm run local` started: removes its stack from the emulator and stops Floci.
 *
 *   npm run local:stop       (from the repository root)
 */
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_STACK_NAME } from "../test/floci/helpers/localStack.js";
import { deleteStack } from "../test/floci/helpers/stack.js";

const COMPOSE_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../test/floci/docker-compose.lambda.yml");

async function main(): Promise<void> {
  try {
    await deleteStack(LOCAL_STACK_NAME);
  } catch {
    // The emulator may already be stopped: nothing to remove.
  }
  execSync(`docker compose -f "${COMPOSE_FILE}" down`, { stdio: "inherit" });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
