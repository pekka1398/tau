import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR, getProjectDir } from "../src/config.ts";

const cliPath = resolve(__dirname, "../src/cli.ts");
const runtimePath = join(homedir(), ".bun", "bin", "bun");

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-stdout-clean-"));
	tempDirs.push(dir);
	return dir;
}

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
	const tempRoot = createTempDir();
	const agentDir = join(tempRoot, "agent");
	const projectDir = join(tempRoot, "project");
	const projectConfigDir = getProjectDir(projectDir, agentDir);
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(projectDir, { recursive: true });
	mkdirSync(projectConfigDir, { recursive: true });

	writeFileSync(
		join(projectConfigDir, "settings.json"),
		JSON.stringify(
			{
				extensions: ["missing-extension.ts"],
			},
			null,
			2,
		),
		"utf-8",
	);

	return await new Promise((resolvePromise, reject) => {
		const child = spawn(runtimePath, [cliPath, ...args], {
			cwd: projectDir,
			env: {
				...process.env,
				[ENV_AGENT_DIR]: agentDir,
				TSX_TSCONFIG_PATH: resolve(__dirname, "../../../tsconfig.json"),
			},
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			resolvePromise({ stdout, stderr, code });
		});
	});
}

describe("stdout cleanliness in non-interactive modes", () => {
	it("prints --mode json --help to stdout without startup chatter", async () => {
		const result = await runCli(["--mode", "json", "--help", "--approve"]);

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("Usage:");
		expect(result.stderr).not.toContain("Usage:");
	});

	it("prints -p --help to stdout without startup chatter", async () => {
		const result = await runCli(["-p", "--help", "--approve"]);

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("Usage:");
		expect(result.stderr).not.toContain("Usage:");
	});

	it("ignores untrusted project resources for help", async () => {
		const result = await runCli(["-p", "--help"]);

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("Usage:");
		expect(result.stderr).not.toContain("Usage:");
	});
});
