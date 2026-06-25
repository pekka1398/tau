import { spawn } from "node:child_process";

/**
 * Open a URL or file in the platform browser/default handler.
 */
export function openBrowser(target: string): void {
	// spawn reports launcher failures (for example, missing xdg-open) via an
	// error event. Browser launch is best-effort: callers still present the target
	// to the user, so keep the launcher failure from becoming a process crash.
	spawn("xdg-open", [target], { stdio: "ignore", detached: true })
		.on("error", () => {})
		.unref();
}
