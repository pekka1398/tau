/**
 * Multimodal API wrapper.
 *
 * Uses pi-ai's completeSimple for all calls (images + text).
 * Audio uses raw fetch since pi-ai has no AudioContent type.
 *
 * Key detail: we inject detail:"high" via onPayload hook
 * to ensure high-resolution image processing and avoid hallucinations.
 */

import { completeSimple, getModel } from "@earendil-works/pi-ai";
import type { ChunkResult } from "./types.ts";

/** Model for transcription. */
const TRANSCRIBE_MODEL = getModel("openrouter", "google/gemini-2.5-flash");

/** API call configuration. */
export interface ApiConfig {
	apiKey: string;
	model?: string;
}

/**
 * onPayload hook: inject detail:"high" into all image_url blocks.
 * This is critical for avoiding hallucinations on image transcription.
 */
function injectHighResolution(payload: unknown): unknown {
	if (!payload || typeof payload !== "object") return undefined;
	const body = payload as Record<string, unknown>;
	if (!Array.isArray(body.messages)) return undefined;

	for (const msg of body.messages) {
		if (!Array.isArray(msg.content)) continue;
		for (const block of msg.content) {
			if (block.type === "image_url" && block.image_url && typeof block.image_url === "object") {
				block.image_url.detail = "high";
			}
		}
	}

	return undefined; // undefined = keep original payload (we mutated in place)
}

/**
 * Transcribe a text chunk via pi-ai.
 */
export async function transcribeTextChunk(
	text: string,
	label: string,
	prompt: string,
	config: ApiConfig,
): Promise<ChunkResult> {
	const response = await completeSimple(
		TRANSCRIBE_MODEL!,
		{
			systemPrompt: TRANSCRIBE_SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: prompt },
						{ type: "text", text: `--- Content (${label}) ---\n${text}\n--- End ---` },
					],
					timestamp: Date.now(),
				},
			],
		},
		{ apiKey: config.apiKey, onPayload: injectHighResolution },
	);

	return { index: 0, label, text: extractText(response) };
}

/**
 * Transcribe an image via pi-ai.
 * detail:"high" is injected by onPayload hook.
 */
export async function transcribeImageChunk(
	imageData: Buffer,
	mimeType: string,
	label: string,
	prompt: string,
	config: ApiConfig,
): Promise<ChunkResult> {
	const base64 = imageData.toString("base64");

	const response = await completeSimple(
		TRANSCRIBE_MODEL!,
		{
			systemPrompt: TRANSCRIBE_SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: prompt },
						{ type: "image", data: base64, mimeType },
					],
					timestamp: Date.now(),
				},
			],
		},
		{ apiKey: config.apiKey, onPayload: injectHighResolution },
	);

	return { index: 0, label, text: extractText(response) };
}

/**
 * Transcribe multiple images in a single API call (for PDF page batching).
 * detail:"high" is injected by onPayload hook.
 */
export async function transcribeImageBatch(
	images: Array<{ label: string; data: Buffer; mimeType: string }>,
	prompt: string,
	config: ApiConfig,
): Promise<string> {
	const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
		{ type: "text", text: prompt },
	];

	for (const img of images) {
		content.push({
			type: "image",
			data: img.data.toString("base64"),
			mimeType: img.mimeType,
		});
	}

	const response = await completeSimple(
		TRANSCRIBE_MODEL!,
		{
			systemPrompt: TRANSCRIBE_SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: content as any,
					timestamp: Date.now(),
				},
			],
		},
		{ apiKey: config.apiKey, onPayload: injectHighResolution },
	);

	return extractText(response);
}

/**
 * Transcribe audio via raw fetch.
 * pi-ai has no AudioContent type, so we build the request manually.
 */
export async function transcribeAudioChunk(
	audioData: Buffer,
	mimeType: string,
	label: string,
	prompt: string,
	config: ApiConfig,
): Promise<ChunkResult> {
	const base64 = audioData.toString("base64");
	const format = mimeType.split("/")[1] ?? "wav";

	const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${config.apiKey}`,
		},
		body: JSON.stringify({
			model: config.model ?? "google/gemini-2.5-flash",
			messages: [
				{ role: "system", content: TRANSCRIBE_SYSTEM_PROMPT },
				{
					role: "user",
					content: [
						{ type: "text", text: prompt },
						{ type: "input_audio", input_audio: { data: base64, format } },
					],
				},
			],
			max_tokens: 16384,
		}),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(`API error ${response.status}: ${body}`);
	}

	const data = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};

	return { index: 0, label, text: data.choices?.[0]?.message?.content ?? "" };
}

/** Extract text content from an AssistantMessage. */
function extractText(msg: { content: Array<{ type: string; text?: string }> }): string {
	return msg.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("");
}

/** System prompt for transcription tasks. Forces faithful output. */
const TRANSCRIBE_SYSTEM_PROMPT = `You are a faithful transcription engine. Your job is to convert the provided content into clean, readable text.

Rules:
- Transcribe EXACTLY what you see/hear. Do NOT summarize, paraphrase, or omit content.
- Do NOT add your own commentary or interpretation.
- Preserve the original structure: headings, paragraphs, lists, tables.
- For tables, use markdown table format.
- For formulas and equations, use LaTeX notation ($...$ for inline, $$...$$ for display).
- For images: describe what you see factually, then extract any visible text (OCR).
- For flowcharts, sequence diagrams, state machines, class diagrams, Gantt charts, and architecture diagrams: output in mermaid syntax.
- For circuit diagrams: output in circuitikz (LaTeX/TikZ) syntax.
- For audio: transcribe speech verbatim. Describe non-speech sounds in [brackets], e.g. [bird chirping], [door closes], [music playing].
- If content is unclear, note it with [unclear] rather than guessing.
- Preserve numbers, dates, names, and technical terms exactly.`;
