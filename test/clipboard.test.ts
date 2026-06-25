import { execSync, spawn } from "child_process";
import { platform } from "os";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { copyToClipboard } from "../src/utils/clipboard.ts";

const mocks = vi.hoisted(() => {
	return {
		execSync: vi.fn(),
		spawn: vi.fn(),
		platform: vi.fn<() => NodeJS.Platform>(),
		isWaylandSession: vi.fn<() => boolean>(),
	};
});

vi.mock("child_process", () => {
	return {
		execSync: mocks.execSync,
		spawn: mocks.spawn,
	};
});

vi.mock("os", () => {
	return {
		platform: mocks.platform,
	};
});

vi.mock("../src/utils/clipboard-image.js", () => {
	return {
		isWaylandSession: mocks.isWaylandSession,
	};
});

const mockedExecSync = vi.mocked(execSync);
const mockedSpawn = vi.mocked(spawn);
const mockedPlatform = vi.mocked(platform);

let originalWrite: typeof process.stdout.write;
let stdoutWrites: string[];

function osc52Writes(): string[] {
	return stdoutWrites.filter((write) => write.startsWith("\x1b]52;c;"));
}

beforeEach(() => {
	vi.unstubAllEnvs();
	vi.stubEnv("SSH_CONNECTION", "");
	vi.stubEnv("SSH_CLIENT", "");
	vi.stubEnv("MOSH_CONNECTION", "");
	vi.stubEnv("WAYLAND_DISPLAY", "");
	vi.stubEnv("DISPLAY", ":0");
	stdoutWrites = [];
	mocks.execSync.mockReset();
	mocks.spawn.mockReset();
	mocks.platform.mockReset();
	mocks.isWaylandSession.mockReset();
	mockedPlatform.mockReturnValue("linux");
	mocks.isWaylandSession.mockReturnValue(false);
	originalWrite = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((...args: Parameters<typeof process.stdout.write>) => {
		const [chunk] = args;
		if (typeof chunk === "string" && chunk.startsWith("\x1b]52;c;")) {
			stdoutWrites.push(chunk);
			return true;
		}
		return originalWrite(...args);
	}) as typeof process.stdout.write;
});

afterEach(() => {
	process.stdout.write = originalWrite;
	vi.unstubAllEnvs();
});

describe("copyToClipboard", () => {
	test("local X11 shell success skips OSC 52", async () => {
		mockedExecSync.mockReturnValue(Buffer.alloc(0));

		await copyToClipboard("hello");

		expect(mockedExecSync).toHaveBeenCalledWith("xclip -selection clipboard", {
			input: "hello",
			stdio: ["pipe", "ignore", "ignore"],
			timeout: 5000,
		});
		expect(osc52Writes()).toHaveLength(0);
	});

	test("Wayland uses wl-copy when available", async () => {
		vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
		vi.stubEnv("DISPLAY", "");
		mocks.isWaylandSession.mockReturnValue(true);
		mockedExecSync.mockReturnValue(Buffer.alloc(0));
		const stdin = {
			on: vi.fn(),
			write: vi.fn(),
			end: vi.fn(),
		};
		const proc = {
			stdin,
			unref: vi.fn(),
		};
		mockedSpawn.mockReturnValue(proc as never);

		await copyToClipboard("hello");

		expect(mockedExecSync).toHaveBeenCalledWith("which wl-copy", { stdio: "ignore" });
		expect(mockedSpawn).toHaveBeenCalledWith("wl-copy", [], { stdio: ["pipe", "ignore", "ignore"] });
		expect(stdin.write).toHaveBeenCalledWith("hello");
		expect(stdin.end).toHaveBeenCalled();
		expect(proc.unref).toHaveBeenCalled();
		expect(osc52Writes()).toHaveLength(0);
	});

	test("remote X11 shell success also emits OSC 52", async () => {
		vi.stubEnv("SSH_CONNECTION", "client server");
		mockedExecSync.mockReturnValue(Buffer.alloc(0));

		await copyToClipboard("hello");

		expect(osc52Writes()).toHaveLength(1);
	});

	test("uses OSC 52 fallback when Linux shell tools fail", async () => {
		mockedExecSync.mockImplementation(() => {
			throw new Error("xclip failed");
		});

		await copyToClipboard("hello");

		expect(osc52Writes()).toHaveLength(1);
	});

	test("does not emit oversized OSC 52 payloads", async () => {
		mockedExecSync.mockImplementation(() => {
			throw new Error("xclip failed");
		});

		await expect(copyToClipboard("x".repeat(80_000))).rejects.toThrow("Failed to copy to clipboard");
		expect(osc52Writes()).toHaveLength(0);
	});
});
