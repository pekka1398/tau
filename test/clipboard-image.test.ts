import type { SpawnSyncReturns } from "child_process";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
	return {
		spawnSync: vi.fn<(command: string, args: string[], options: unknown) => SpawnSyncReturns<Buffer>>(),
	};
});

vi.mock("child_process", () => {
	return {
		spawnSync: mocks.spawnSync,
	};
});

function spawnOk(stdout: Buffer): SpawnSyncReturns<Buffer> {
	return {
		pid: 123,
		output: [Buffer.alloc(0), stdout, Buffer.alloc(0)],
		stdout,
		stderr: Buffer.alloc(0),
		status: 0,
		signal: null,
	};
}

function spawnError(error: Error): SpawnSyncReturns<Buffer> {
	return {
		pid: 123,
		output: [Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0)],
		stdout: Buffer.alloc(0),
		stderr: Buffer.alloc(0),
		status: null,
		signal: null,
		error,
	};
}

describe("readClipboardImage", () => {
	beforeEach(() => {
		vi.resetModules();
		mocks.spawnSync.mockReset();
	});

	test("Wayland: uses wl-paste", async () => {
		mocks.spawnSync.mockImplementation((command, args, _options) => {
			if (command === "wl-paste" && args[0] === "--list-types") {
				return spawnOk(Buffer.from("text/plain\nimage/png\n", "utf-8"));
			}
			if (command === "wl-paste" && args[0] === "--type") {
				return spawnOk(Buffer.from([1, 2, 3]));
			}
			throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
		});

		const { readClipboardImage } = await import("../src/utils/clipboard-image.ts");
		const result = await readClipboardImage({ platform: "linux", env: { WAYLAND_DISPLAY: "1" } });
		expect(result).not.toBeNull();
		expect(result?.mimeType).toBe("image/png");
		expect(Array.from(result?.bytes ?? [])).toEqual([1, 2, 3]);
	});

	test("Wayland: falls back to xclip when wl-paste is missing", async () => {
		const enoent = new Error("spawn ENOENT");
		(enoent as { code?: string }).code = "ENOENT";

		mocks.spawnSync.mockImplementation((command, args, _options) => {
			if (command === "wl-paste") {
				return spawnError(enoent);
			}

			if (command === "xclip" && args.includes("TARGETS")) {
				return spawnOk(Buffer.from("image/png\n", "utf-8"));
			}

			if (command === "xclip" && args.includes("image/png")) {
				return spawnOk(Buffer.from([9, 8]));
			}

			return spawnOk(Buffer.alloc(0));
		});

		const { readClipboardImage } = await import("../src/utils/clipboard-image.ts");
		const result = await readClipboardImage({ platform: "linux", env: { XDG_SESSION_TYPE: "wayland" } });
		expect(result).not.toBeNull();
		expect(result?.mimeType).toBe("image/png");
		expect(Array.from(result?.bytes ?? [])).toEqual([9, 8]);
	});

	test("X11: uses xclip", async () => {
		mocks.spawnSync.mockImplementation((command, args, _options) => {
			if (command === "xclip" && args.includes("TARGETS")) {
				return spawnOk(Buffer.from("image/png\n", "utf-8"));
			}
			if (command === "xclip" && args.includes("image/png")) {
				return spawnOk(Buffer.from([7]));
			}
			throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
		});

		const { readClipboardImage } = await import("../src/utils/clipboard-image.ts");
		const result = await readClipboardImage({ platform: "linux", env: {} });
		expect(result).not.toBeNull();
		expect(result?.mimeType).toBe("image/png");
		expect(Array.from(result?.bytes ?? [])).toEqual([7]);
	});

	test("X11: returns null when xclip has no image", async () => {
		mocks.spawnSync.mockImplementation((command, args, _options) => {
			if (command === "xclip" && args.includes("TARGETS")) {
				return spawnOk(Buffer.from("text/plain\n", "utf-8"));
			}
			return spawnOk(Buffer.alloc(0));
		});

		const { readClipboardImage } = await import("../src/utils/clipboard-image.ts");
		const result = await readClipboardImage({ platform: "linux", env: {} });
		expect(result).toBeNull();
	});

	test("non-Linux returns null", async () => {
		mocks.spawnSync.mockImplementation(() => {
			throw new Error("spawnSync should not be called for non-Linux platforms");
		});

		const { readClipboardImage } = await import("../src/utils/clipboard-image.ts");
		const result = await readClipboardImage({ platform: "darwin", env: {} });
		expect(result).toBeNull();
	});
});
