import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** Absolute path to the ai-dash binary. */
export const AI_DASH = join(__dirname, "bin", "ai-dash");
