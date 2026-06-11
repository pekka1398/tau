import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Absolute path to the ai-dash binary. */
export const AI_DASH = resolveAiDash();

function resolveAiDash() {
	// 1. Next to the running executable (bun compile case)
	//    process.execPath = the pi binary, ai-dash is copied alongside
	const execDir = dirname(process.execPath);
	const alongside = join(execDir, "ai-dash");
	if (existsSync(alongside)) return alongside;

	// 2. Next to process.argv[1] (node script case)
	try {
		const argvDir = dirname(process.argv[1] || "");
		const argvAlongside = join(argvDir, "ai-dash");
		if (existsSync(argvAlongside)) return argvAlongside;
	} catch {}

	// 3. Relative to this module (npm install / workspace case)
	const __dirname = dirname(new URL(import.meta.url).pathname);
	const bundled = join(__dirname, "bin", "ai-dash");
	if (existsSync(bundled)) return bundled;

	// 4. Fallback: PATH
	return "ai-dash";
}
