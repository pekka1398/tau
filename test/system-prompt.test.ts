import { describe, expect, test } from "vitest";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

describe("buildSystemPrompt", () => {
	test("uses the canonical Tau prompt", () => {
		const prompt = buildSystemPrompt({
			selectedTools: [],
			contextFiles: [],
			skills: [],
			cwd: process.cwd(),
		});

		expect(prompt).toContain("You are Tau, an interactive software engineering agent.");
		expect(prompt).toContain("Tau documentation (read only when the user asks about tau itself):");
		expect(prompt).toContain("Current date: $date");
		expect(prompt).toContain("Current working directory: $promptCwd");
	});

	test("does not synthesize the removed generated tool section", () => {
		const prompt = buildSystemPrompt({
			selectedTools: ["bash", "dynamic_tool"],
			toolSnippets: {
				dynamic_tool: "Run dynamic test behavior",
			},
			promptGuidelines: ["Use dynamic_tool for project summaries."],
			contextFiles: [],
			skills: [],
			cwd: process.cwd(),
		});

		expect(prompt).not.toContain("Available tools:");
		expect(prompt).not.toContain("Run dynamic test behavior");
		expect(prompt).not.toContain("Use dynamic_tool for project summaries.");
	});
});
