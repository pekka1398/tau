import { execSync, spawn } from "child_process";
import { platform } from "os";
import { isWaylandSession } from "./clipboard-image.ts";

type NativeClipboardExecOptions = {
	input: string;
	timeout: number;
	stdio: ["pipe", "ignore", "ignore"];
};

function copyToX11Clipboard(options: NativeClipboardExecOptions): void {
	try {
		execSync("xclip -selection clipboard", options);
	} catch {
		execSync("xsel --clipboard --input", options);
	}
}

const MAX_OSC52_ENCODED_LENGTH = 100_000;

function isRemoteSession(env: NodeJS.ProcessEnv = process.env): boolean {
	return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.MOSH_CONNECTION);
}

function emitOsc52(text: string): boolean {
	const encoded = Buffer.from(text).toString("base64");
	if (encoded.length > MAX_OSC52_ENCODED_LENGTH) {
		return false;
	}
	process.stdout.write(`\x1b]52;c;${encoded}\x07`);
	return true;
}

export async function copyToClipboard(text: string): Promise<void> {
	let copied = false;

	const p = platform();

	const remote = isRemoteSession();
	if (copied && !remote) {
		return;
	}

	const options: NativeClipboardExecOptions = { input: text, timeout: 5000, stdio: ["pipe", "ignore", "ignore"] };

	if (!copied) {
		try {
			if (p === "linux") {
				const hasWaylandDisplay = Boolean(process.env.WAYLAND_DISPLAY);
				const hasX11Display = Boolean(process.env.DISPLAY);
				const isWayland = isWaylandSession();
				if (isWayland && hasWaylandDisplay) {
					try {
						// Verify wl-copy exists because spawn errors are asynchronous.
						execSync("which wl-copy", { stdio: "ignore" });
						const proc = spawn("wl-copy", [], { stdio: ["pipe", "ignore", "ignore"] });
						proc.stdin.on("error", () => {
							// Ignore EPIPE errors if wl-copy exits early.
						});
						proc.stdin.write(text);
						proc.stdin.end();
						proc.unref();
						copied = true;
					} catch {
						if (hasX11Display) {
							copyToX11Clipboard(options);
							copied = true;
						}
					}
				} else if (hasX11Display) {
					copyToX11Clipboard(options);
					copied = true;
				}
			}
		} catch {
			// Fall through to OSC 52 fallback.
		}
	}

	if (remote || !copied) {
		const osc52Copied = emitOsc52(text);
		copied = copied || osc52Copied;
	}

	if (!copied) {
		throw new Error("Failed to copy to clipboard");
	}
}
