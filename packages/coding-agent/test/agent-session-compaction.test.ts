/**
 * E2E tests for AgentSession compaction behavior (Approach A).
 *
 * These tests use real LLM calls (no mocking) to verify:
 * - Manual compaction works correctly via /compact
 * - Session is rebuilt after compaction (summary as user msg + kept recent)
 * - Compaction events are emitted
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession, type AgentSessionEvent } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createCodingTools } from "../src/index.ts";
import { API_KEY, createTestResourceLoader } from "./utilities.ts";

describe.skipIf(!API_KEY)("AgentSession compaction e2e", () => {
	let session: AgentSession;
	let tempDir: string;
	let sessionManager: SessionManager;
	let events: AgentSessionEvent[];

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-compaction-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		events = [];
	});

	afterEach(async () => {
		if (session) {
			session.dispose();
		}
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	function createSession(inMemory = false) {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => API_KEY,
			initialState: {
				model,
				systemPrompt: "You are a helpful assistant. Be concise.",
				tools: createCodingTools(process.cwd()),
			},
		});

		sessionManager = inMemory ? SessionManager.inMemory() : SessionManager.create(tempDir);
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		const modelRegistry = ModelRegistry.create(authStorage);

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRegistry,
			resourceLoader: createTestResourceLoader(),
		});

		session.subscribe((event) => {
			events.push(event);
		});

		return session;
	}

	it("should trigger manual compaction via compact()", async () => {
		createSession();

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.prompt("What is 3+3? Reply with just the number.");
		await session.agent.waitForIdle();

		const result = await session.compact();

		expect(result.summary).toBeDefined();
		expect(result.summary.length).toBeGreaterThan(0);
		expect(result.keptMessageCount).toBeGreaterThanOrEqual(0);

		// After compaction, first message should be the summary (user role)
		const messages = session.messages;
		expect(messages.length).toBeGreaterThan(0);
		expect(messages[0].role).toBe("user");
	}, 120000);

	it("should maintain valid session state after compaction", async () => {
		createSession();

		await session.prompt("What is the capital of France? One word answer.");
		await session.agent.waitForIdle();

		await session.prompt("What is the capital of Germany? One word answer.");
		await session.agent.waitForIdle();

		await session.compact();

		// Session should still be usable
		await session.prompt("What is the capital of Italy? One word answer.");
		await session.agent.waitForIdle();

		expect(session.messages.length).toBeGreaterThan(0);
		const assistantMessages = session.messages.filter((m) => m.role === "assistant");
		expect(assistantMessages.length).toBeGreaterThan(0);
	}, 180000);

	it("should work with in-memory sessions", async () => {
		createSession(true);

		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.prompt("What is 3+3? Reply with just the number.");
		await session.agent.waitForIdle();

		const result = await session.compact();

		expect(result.summary).toBeDefined();
		expect(result.summary.length).toBeGreaterThan(0);
	}, 120000);

	it("should emit compaction events during manual compaction", async () => {
		createSession();

		await session.prompt("Say hello");
		await session.agent.waitForIdle();

		await session.compact();

		const compactionEvents = events.filter((e) => e.type === "compaction_start" || e.type === "compaction_end");
		expect(compactionEvents).toHaveLength(2);
		expect(compactionEvents[0]).toEqual({ type: "compaction_start", reason: "manual" });
		expect(compactionEvents[1]).toMatchObject({
			type: "compaction_end",
			reason: "manual",
			aborted: false,
			willRetry: false,
		});
	}, 120000);
});
