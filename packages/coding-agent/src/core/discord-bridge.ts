/**
 * Discord Bridge — control Pi from your phone via Discord.
 *
 * Architecture:
 *   Phone Discord <-> Discord API <-> This bot (local) <-> Pi AgentSession
 *
 * Each /discord call creates a new Discord channel.
 * Conversation history is synced on connect.
 * Uses session.subscribe() for real-time events (no polling).
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "./agent-session.ts";
import type {
	BashExecutionMessage,
	BranchSummaryMessage,
	CompactionSummaryMessage,
	CustomMessage,
} from "./messages.ts";

// discord.js types — require("discord.js") at runtime to avoid
// bundling the dependency when the bridge is not used.
type DiscordClient = any;
type DiscordTextChannel = any;
type DiscordMessage = any;

const DISCORD_MAX_LENGTH = 2000;
const CHANNEL_PREFIX = "pi-";
const POLL_INTERVAL_MS = 1500;

// ============================================================================
// Message format conversion
// ============================================================================

/** Extract plain text from a UserMessage. */
export function formatUserMessage(msg: AgentMessage): string | null {
	if (msg.role !== "user") return null;
	const content = (msg as any).content;
	if (!content) return null;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return null;
	return (
		content
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text || "")
			.join("")
			.trim() || null
	);
}

/** Extract text + tool calls from an AssistantMessage. */
export function formatAssistantMessage(msg: AssistantMessage): string | null {
	const parts: string[] = [];
	for (const block of msg.content) {
		if (block.type === "text") {
			const text = block.text.trim();
			if (text) parts.push(text);
		} else if (block.type === "toolCall") {
			parts.push(formatToolCallBlock(block));
		}
		// Skip ThinkingContent — not shown in Discord
	}
	return parts.length > 0 ? parts.join("\n") : null;
}

/** Format a ToolCall content block for Discord. */
function formatToolCallBlock(tc: ToolCall): string {
	const argsSummary = formatToolArgs(tc.name, tc.arguments);
	return `🔧 **${tc.name}** ${argsSummary}`;
}

/** Format tool arguments as a brief summary. */
function formatToolArgs(toolName: string, args: Record<string, any>): string {
	if (!args) return "";
	switch (toolName) {
		case "bash":
			return args.command ? `\`${truncate(args.command, 120)}\`` : "";
		case "read":
			return args.path ? `\`${args.path}\`` : "";
		case "edit":
			return args.path ? `\`${args.path}\`` : "";
		case "write":
			return args.path ? `\`${args.path}\`` : "";
		default: {
			const entries = Object.entries(args).slice(0, 2);
			if (entries.length === 0) return "";
			return entries.map(([k, v]) => `${k}: \`${truncate(String(v), 80)}\``).join(", ");
		}
	}
}

/** Format a ToolResultMessage for Discord. */
export function formatToolResultMessage(msg: ToolResultMessage): string | null {
	const textBlocks = msg.content.filter((c: any) => c.type === "text");
	const text = textBlocks
		.map((c: any) => c.text || "")
		.join("\n")
		.trim();
	if (!text) return null;

	const prefix = msg.isError ? "❌" : "📄";
	const lines = text.split("\n");
	if (msg.toolName === "bash") {
		// Bash results can be long — show first 10 lines
		const preview = lines.slice(0, 10).join("\n");
		const suffix = lines.length > 10 ? `\n... (+${lines.length - 10} more)` : "";
		return `${prefix} \`\`\`\n${truncate(preview, 500)}${suffix}\n\`\`\``;
	}
	// Generic tool result — show first 5 lines
	const preview = lines.slice(0, 5).join("\n");
	const suffix = lines.length > 5 ? `\n... (+${lines.length - 5} more)` : "";
	return `${prefix} \`\`\`\n${truncate(preview, 300)}${suffix}\n\`\`\``;
}

/** Format a BashExecutionMessage for Discord. */
export function formatBashExecutionMessage(msg: BashExecutionMessage): string {
	let text = `$ \`${truncate(msg.command, 150)}\``;
	if (msg.output) {
		const lines = msg.output.split("\n");
		const preview = lines.slice(0, 8).join("\n");
		const suffix = lines.length > 8 ? `\n... (+${lines.length - 8} more)` : "";
		text += `\n\`\`\`\n${truncate(preview, 400)}${suffix}\n\`\`\``;
	}
	if (msg.exitCode != null && msg.exitCode !== 0) {
		text += `\n(exit ${msg.exitCode})`;
	}
	return text;
}

/** Format a CustomMessage for Discord. */
export function formatCustomMessage(msg: CustomMessage): string | null {
	if (!msg.display) return null;
	if (typeof msg.content === "string") return msg.content.trim() || null;
	if (Array.isArray(msg.content)) {
		const text = msg.content
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text || "")
			.join("")
			.trim();
		return text || null;
	}
	return null;
}

/** Format a BranchSummaryMessage for Discord. */
export function formatBranchSummaryMessage(msg: BranchSummaryMessage): string {
	return `🔀 **Branch summary:** ${truncate(msg.summary, 300)}`;
}

/** Format a CompactionSummaryMessage for Discord. */
export function formatCompactionSummaryMessage(msg: CompactionSummaryMessage): string {
	return `📦 **Context compacted** (${msg.tokensBefore} tokens)`;
}

/** Format any AgentMessage for Discord. Returns null if nothing to show. */
export function formatMessage(msg: AgentMessage): string | null {
	switch (msg.role) {
		case "user":
			return formatUserMessage(msg);
		case "assistant":
			return formatAssistantMessage(msg as AssistantMessage);
		case "toolResult":
			return formatToolResultMessage(msg as ToolResultMessage);
		case "bashExecution":
			return formatBashExecutionMessage(msg as BashExecutionMessage);
		case "custom":
			return formatCustomMessage(msg as CustomMessage);
		case "branchSummary":
			return formatBranchSummaryMessage(msg as BranchSummaryMessage);
		case "compactionSummary":
			return formatCompactionSummaryMessage(msg as CompactionSummaryMessage);
		default:
			return null;
	}
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen)}…`;
}

// ============================================================================
// Discord client management
// ============================================================================

interface BridgeSession {
	channel: DiscordTextChannel;
	session: AgentSession;
	lastMessageIndex: number;
	watcherInterval: ReturnType<typeof setInterval> | null;
	unsubscribe: (() => void) | null;
	/** Accumulated streaming text for the current assistant message */
	streamingBuffer: string;
}

const activeSessions = new Map<string, BridgeSession>();

let client: DiscordClient | null = null;
let onReadyResolve: (() => void) | null = null;
let onStatus: ((msg: string) => void) | null = null;

async function ensureClient(token: string, statusCb?: (msg: string) => void): Promise<DiscordClient> {
	onStatus = statusCb ?? null;
	if (client?.isReady()) return client;
	if (client) {
		client.destroy();
		client = null;
	}

	// discord.js is an optional peer dependency — only loaded when the bridge is used
	const discordMod = "discord.js";
	const { Client, GatewayIntentBits, Events } = await import(discordMod);

	client = new Client({
		intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
	});

	// Handle inbound messages from Discord → Pi
	client.on(Events.MessageCreate, async (msg: DiscordMessage) => {
		if (msg.author.id === client!.user?.id) return;
		const session = activeSessions.get(msg.channelId);
		if (!session) return;

		const text = msg.content.trim();
		if (!text) return;

		try {
			if (session.session.isStreaming) {
				await session.session.steer(text);
			} else {
				await session.session.prompt(text);
			}
		} catch (err) {
			await sendToChannel(session.channel, `❌ Error: ${(err as Error).message}`).catch(() => {});
		}
	});

	client.on(Events.Error, (error: Error) => {
		onStatus?.(`[discord] Client error: ${error.message}`);
	});

	const readyPromise = new Promise<void>((resolve) => {
		onReadyResolve = resolve;
	});

	client.on(Events.ClientReady, () => {
		onStatus?.(`[discord] Bot ready as ${client!.user?.tag}`);
		onReadyResolve?.();
	});

	await client.login(token);
	await readyPromise;
	return client;
}

// ============================================================================
// Session bridging
// ============================================================================

/**
 * Start a Discord bridge session.
 * Creates a new channel, syncs history, and subscribes to session events.
 */
export async function startDiscordBridge(
	token: string,
	targetGuildId: string,
	session: AgentSession,
	options?: { onStatus?: (msg: string) => void },
): Promise<string> {
	const bot = await ensureClient(token, options?.onStatus);
	const guild = await bot.guilds.fetch(targetGuildId);
	if (!guild) throw new Error(`Cannot find Discord server with ID ${targetGuildId}`);

	// Create channel
	const now = new Date();
	const dateStr = `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
	const channel = await guild.channels.create({
		name: `${CHANNEL_PREFIX}${dateStr}`,
		type: 0, // GuildText
		topic: "Pi remote control session",
	});

	// Sync existing messages (last 30)
	const MAX_SYNC = 30;
	const allMsgs = session.messages;
	const msgs = allMsgs.slice(-MAX_SYNC);

	const batches = batchMessages(msgs);
	if (batches.length > 0) {
		const skipped = Math.max(0, allMsgs.length - MAX_SYNC);
		await sendToChannel(
			channel,
			skipped > 0
				? `📋 **Syncing last ${MAX_SYNC} messages (${skipped} older skipped)...**`
				: "📋 **Syncing conversation history...**",
		);
		for (const batch of batches) {
			await sendToChannelChunked(channel, batch);
		}
		await sendToChannel(channel, "✅ **History synced. Start chatting!**");
	}

	// Register session
	const bridgeSession: BridgeSession = {
		channel,
		session,
		lastMessageIndex: allMsgs.length,
		watcherInterval: null,
		unsubscribe: null,
		streamingBuffer: "",
	};
	activeSessions.set(channel.id, bridgeSession);

	// Subscribe to session events (real-time, no polling)
	bridgeSession.unsubscribe = session.subscribe(async (event: AgentSessionEvent) => {
		await handleSessionEvent(channel.id, event);
	});

	// Also poll for messages added outside of events (e.g. compaction, extensions)
	bridgeSession.watcherInterval = setInterval(async () => {
		await pollNewMessages(channel.id);
	}, POLL_INTERVAL_MS);

	await sendToChannel(channel, "🟢 **Pi bridge connected!** Send messages here to control Pi.");
	return channel.id;
}

/**
 * Stop a specific bridge session.
 */
export async function stopDiscordBridge(channelId: string): Promise<void> {
	const session = activeSessions.get(channelId);
	if (!session) return;

	if (session.unsubscribe) session.unsubscribe();
	if (session.watcherInterval) clearInterval(session.watcherInterval);
	activeSessions.delete(channelId);

	await sendToChannel(session.channel, "🔴 **Pi bridge disconnected.**").catch(() => {});

	if (activeSessions.size === 0 && client) {
		client.destroy();
		client = null;
	}
}

export function isDiscordBridgeRunning(): boolean {
	return activeSessions.size > 0;
}

export function getActiveSessionIds(): string[] {
	return [...activeSessions.keys()];
}

// ============================================================================
// Event handling
// ============================================================================

async function handleSessionEvent(channelId: string, event: AgentSessionEvent): Promise<void> {
	const bridge = activeSessions.get(channelId);
	if (!bridge) return;

	switch (event.type) {
		case "agent_start":
			bridge.streamingBuffer = "";
			break;

		case "message_start": {
			const msg = event.message;
			if (msg.role === "user") {
				const text = formatUserMessage(msg);
				if (text) await sendToChannelChunked(bridge.channel, `**You:** ${text}`);
			} else if (msg.role === "assistant") {
				bridge.streamingBuffer = "";
			}
			break;
		}

		case "message_update": {
			const ev = event.assistantMessageEvent;
			if (ev.type === "text_delta") {
				bridge.streamingBuffer += ev.delta;
			}
			// Skip thinking_delta — don't accumulate thinking content
			break;
		}

		case "message_end": {
			const msg = event.message;
			if (msg.role === "assistant") {
				// Send accumulated streaming text
				if (bridge.streamingBuffer.trim()) {
					await sendToChannelChunked(bridge.channel, `**Pi:** ${bridge.streamingBuffer.trim()}`);
				}
				// Send tool call summaries
				const assistantMsg = msg as AssistantMessage;
				for (const block of assistantMsg.content) {
					if (block.type === "toolCall") {
						await sendToChannel(bridge.channel, formatToolCallBlock(block));
					}
				}
				bridge.streamingBuffer = "";
			}
			break;
		}

		case "tool_execution_start":
			// Show that tool is running (optional, could be noisy)
			break;

		case "tool_execution_end": {
			const { toolName, result, isError } = event;
			if (toolName === "bash") {
				// Bash results come through BashExecutionMessage, skip here
				break;
			}
			// Generic tool result
			if (result?.content) {
				const textBlocks = result.content.filter((c: any) => c.type === "text");
				const text = textBlocks
					.map((c: any) => c.text || "")
					.join("\n")
					.trim();
				if (text) {
					const prefix = isError ? "❌" : "📄";
					const lines = text.split("\n");
					const preview = lines.slice(0, 5).join("\n");
					const suffix = lines.length > 5 ? `\n... (+${lines.length - 5} more)` : "";
					await sendToChannelChunked(
						bridge.channel,
						`${prefix} **${toolName}:** \`\`\`\n${truncate(preview, 400)}${suffix}\n\`\`\``,
					);
				}
			}
			break;
		}

		case "agent_end":
			bridge.streamingBuffer = "";
			bridge.lastMessageIndex = bridge.session.messages.length;
			break;
	}
}

// ============================================================================
// Polling fallback for messages added outside events
// ============================================================================

async function pollNewMessages(channelId: string): Promise<void> {
	const bridge = activeSessions.get(channelId);
	if (!bridge) return;

	const currentMsgs = bridge.session.messages;

	// Handle compaction (message count decreased)
	if (bridge.lastMessageIndex > currentMsgs.length) {
		bridge.lastMessageIndex = currentMsgs.length;
	}

	// Send any messages we haven't seen yet
	for (let i = bridge.lastMessageIndex; i < currentMsgs.length; i++) {
		const msg = currentMsgs[i];
		if (!msg) continue;

		// Skip types already handled by event handler
		if (msg.role === "user" || msg.role === "assistant" || msg.role === "toolResult") {
			continue;
		}

		const text = formatMessage(msg);
		if (text) {
			await sendToChannelChunked(bridge.channel, text);
		}
	}
	bridge.lastMessageIndex = currentMsgs.length;
}

// ============================================================================
// Helpers
// ============================================================================

function batchMessages(msgs: AgentMessage[]): string[] {
	const batches: string[] = [];
	let current = "";

	for (const msg of msgs) {
		const formatted = formatMessage(msg);
		if (!formatted) continue;

		let line: string;
		if (msg.role === "user") {
			line = `**You:** ${formatted}`;
		} else if (msg.role === "assistant") {
			line = `**Pi:** ${formatted}`;
		} else if (msg.role === "bashExecution") {
			line = formatted; // Already formatted
		} else {
			line = formatted;
		}

		if (current && current.length + line.length + 2 > DISCORD_MAX_LENGTH) {
			batches.push(current);
			current = line;
		} else {
			current = current ? `${current}\n\n${line}` : line;
		}
	}
	if (current) batches.push(current);
	return batches;
}

async function sendToChannel(channel: DiscordTextChannel, text: string): Promise<void> {
	try {
		await channel.send(text);
	} catch (err) {
		onStatus?.(`[discord] Send failed: ${(err as Error).message}`);
	}
}

async function sendToChannelChunked(channel: DiscordTextChannel, text: string): Promise<void> {
	const chunks = splitMessage(text, DISCORD_MAX_LENGTH);
	for (const chunk of chunks) {
		await sendToChannel(channel, chunk);
		if (chunks.length > 1) {
			await new Promise((r) => setTimeout(r, 100));
		}
	}
}

function splitMessage(text: string, maxLength: number): string[] {
	if (text.length <= maxLength) return [text];
	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length > 0) {
		if (remaining.length <= maxLength) {
			chunks.push(remaining);
			break;
		}
		let splitIndex = remaining.lastIndexOf("\n", maxLength);
		if (splitIndex <= 0 || splitIndex > maxLength) splitIndex = maxLength;
		chunks.push(remaining.slice(0, splitIndex));
		remaining = remaining.slice(splitIndex);
		if (remaining.startsWith("\n")) remaining = remaining.slice(1);
	}
	return chunks;
}
