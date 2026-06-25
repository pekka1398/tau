import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../../src/core/ai/index.ts";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type Model,
} from "../../src/core/ai/index.ts";
import { createHarness, type Harness } from "./harness.ts";

function createUsage(totalTokens: number) {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function useSummaryStreamFn(
	harness: Harness,
	summary: string,
): {
	getCallCount: () => number;
	getContexts: () => Context[];
} {
	let callCount = 0;
	const contexts: Context[] = [];
	harness.session.agent.streamFn = (model, context) => {
		callCount++;
		contexts.push(context);
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			const message: AssistantMessage = {
				...fauxAssistantMessage(summary),
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: createUsage(10),
			};
			stream.push({ type: "done", reason: "stop", message });
		});
		return stream;
	};
	return {
		getCallCount: () => callCount,
		getContexts: () => contexts,
	};
}

function seedCompactableSession(harness: Harness): void {
	const now = Date.now();
	harness.sessionManager.appendMessage({
		role: "user",
		content: [{ type: "text", text: "message to compact" }],
		timestamp: now - 1000,
	});
	harness.sessionManager.appendMessage({
		...fauxAssistantMessage("assistant response", { timestamp: now - 500 }),
		api: harness.getModel().api,
		provider: harness.getModel().provider,
		model: harness.getModel().id,
		usage: createUsage(100),
	});
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

describe("AgentSession compaction characterization", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		vi.restoreAllMocks();
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("throws when compacting without a model", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.session.agent.state.model = undefined as unknown as Model<any>;

		await expect(harness.session.compact()).rejects.toThrow("No model selected");
	});

	it("throws when compacting a small session", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		await expect(harness.session.compact()).rejects.toThrow("Nothing to compact (session too small)");
	});

	it("manually compacts with a custom streamFn when registry auth is absent", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		seedCompactableSession(harness);
		const streamSpy = useSummaryStreamFn(harness, "summary from custom stream");

		const result = await harness.session.compact();

		expect(result.summary).toBe("summary from custom stream");
		expect(result.keptMessageCount).toBeGreaterThan(0);
		expect(streamSpy.getCallCount()).toBe(1);
	});

	it("reports manual compaction as in progress while the summary request is pending", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		seedCompactableSession(harness);

		let releaseSummary: (() => void) | undefined;
		harness.session.agent.streamFn = () => {
			const stream = createAssistantMessageEventStream();
			releaseSummary = () => {
				const message: AssistantMessage = {
					role: "assistant",
					content: [{ type: "text", text: "delayed summary" }],
					stopReason: "stop",
					timestamp: Date.now(),
					usage: createUsage(100),
				};
				stream.push({ type: "done", reason: "stop", message });
			};
			return stream;
		};

		const compactPromise = harness.session.compact();
		for (let i = 0; i < 20 && !releaseSummary; i++) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		expect(releaseSummary).toBeDefined();

		expect(harness.session.isCompacting).toBe(true);

		releaseSummary?.();
		await compactPromise;

		expect(harness.session.isCompacting).toBe(false);
	});

	it("creates a derived persisted session and leaves the original JSONL unchanged", async () => {
		const harness = await createHarness({ persistSession: true });
		harnesses.push(harness);
		seedCompactableSession(harness);
		const originalSessionFile = harness.sessionManager.getSessionFile();
		expect(originalSessionFile).toBeDefined();
		const originalJsonl = readFileSync(originalSessionFile!, "utf8");
		const streamSpy = useSummaryStreamFn(harness, "summary from persisted compact");

		const result = await harness.session.compact("focus on files changed");

		expect(streamSpy.getCallCount()).toBe(1);
		expect(readFileSync(originalSessionFile!, "utf8")).toBe(originalJsonl);
		expect(result.compactedFrom).toBe(originalSessionFile);
		expect(result.sessionFile).toBeDefined();
		expect(result.sessionFile).not.toBe(originalSessionFile);

		const header = harness.sessionManager.getHeader();
		expect(header?.compactedFrom).toBe(originalSessionFile);
		expect(header?.parentSession).toBe(originalSessionFile);
		expect(header?.compactInstructions).toBe("focus on files changed");
		expect(header?.compactedAt).toEqual(expect.any(String));

		const compactedContext = harness.sessionManager.buildSessionContext();
		const summaryText = compactedContext.messages[0]?.content;
		expect(JSON.stringify(summaryText)).toContain("The conversation before this point was compacted.");
		expect(JSON.stringify(summaryText)).toContain(`Full original transcript:\\n${originalSessionFile}`);
		expect(JSON.stringify(summaryText)).toContain("summary from persisted compact");

		const requestText = JSON.stringify(streamSpy.getContexts()[0]?.messages.at(-1));
		expect(requestText).toContain("Additional user instructions for this compaction:");
		expect(requestText).toContain("focus on files changed");
	});
});
