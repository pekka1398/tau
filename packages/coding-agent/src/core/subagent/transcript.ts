/**
 * Subagent transcript persistence.
 *
 * Records agent conversations to disk for debugging and resume support.
 * Transcripts are stored as JSONL files in ~/.pi/agent/transcripts/.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

const TRANSCRIPT_DIR_NAME = "transcripts";

function getTranscriptDir(): string {
	const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
	return join(home, ".pi", "agent", TRANSCRIPT_DIR_NAME);
}

function ensureTranscriptDir(): string {
	const dir = getTranscriptDir();
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

/**
 * Record messages to a transcript file.
 *
 * @param agentId - Unique ID for this agent run
 * @param messages - Messages to append
 */
export function recordTranscript(agentId: string, messages: AgentMessage[]): void {
	const dir = ensureTranscriptDir();
	const filePath = join(dir, `${agentId}.jsonl`);

	for (const msg of messages) {
		try {
			const line = JSON.stringify(msg);
			appendFileSync(filePath, `${line}\n`, "utf-8");
		} catch {
			// Ignore write errors — transcript is best-effort
		}
	}
}

/**
 * Read a transcript from disk.
 *
 * @param agentId - The agent ID
 * @returns Array of messages, or empty if not found
 */
export function readTranscript(agentId: string): AgentMessage[] {
	const dir = getTranscriptDir();
	const filePath = join(dir, `${agentId}.jsonl`);

	if (!existsSync(filePath)) return [];

	try {
		const content = readFileSync(filePath, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);
		return lines.map((line) => JSON.parse(line) as AgentMessage);
	} catch {
		return [];
	}
}

/**
 * Write agent metadata for resume support.
 *
 * @param agentId - The agent ID
 * @param metadata - Agent metadata (type, description, etc.)
 */
export function writeAgentMetadata(agentId: string, metadata: Record<string, unknown>): void {
	const dir = ensureTranscriptDir();
	const filePath = join(dir, `${agentId}.meta.json`);

	try {
		const content = JSON.stringify({ ...metadata, updatedAt: Date.now() });
		appendFileSync(filePath, `${content}\n`, "utf-8");
	} catch {
		// Ignore write errors
	}
}

/**
 * Read agent metadata.
 *
 * @param agentId - The agent ID
 * @returns Metadata object, or null if not found
 */
export function readAgentMetadata(agentId: string): Record<string, unknown> | null {
	const dir = getTranscriptDir();
	const filePath = join(dir, `${agentId}.meta.json`);

	if (!existsSync(filePath)) return null;

	try {
		const content = readFileSync(filePath, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);
		// Return the last metadata entry (most recent)
		return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
	} catch {
		return null;
	}
}

/**
 * List all agent transcripts.
 *
 * @returns Array of { agentId, metadata } for each transcript
 */
export function listTranscripts(): Array<{ agentId: string; metadata: Record<string, unknown> | null }> {
	const dir = getTranscriptDir();
	if (!existsSync(dir)) return [];

	try {
		const entries = readdirSync(dir);
		const agentIds = new Set<string>();

		for (const entry of entries) {
			if (entry.endsWith(".jsonl")) {
				agentIds.add(entry.replace(".jsonl", ""));
			}
		}

		return Array.from(agentIds).map((agentId) => ({
			agentId,
			metadata: readAgentMetadata(agentId),
		}));
	} catch {
		return [];
	}
}
