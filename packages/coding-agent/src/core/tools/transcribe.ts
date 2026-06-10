/**
 * Transcribe tool — faithful file transcription for any format.
 *
 * Converts PDF, DOCX, XLSX, CSV, images, audio, and Jupyter notebooks to .md files.
 * Uses local extraction where possible, falls back to multimodal API (Gemini via OpenRouter).
 */

import { getModel } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { ToolContext, ToolDefinition } from "../tool-types.ts";
import { transcribe } from "./transcribe/transcribe.ts";

const TRANSCRIBE_MODEL = getModel("openrouter", "google/gemini-2.5-flash");

const transcribeParams = Type.Object({
	paths: Type.Union(
		[
			Type.String({ description: "Path to a single file to transcribe" }),
			Type.Array(Type.String(), { description: "Array of file paths to transcribe" }),
		],
		{ description: "File path(s) to convert to text" },
	),
	language: Type.Optional(
		Type.String({
			description: "Language hint for OCR and speech-to-text (e.g., 'en', 'zh', 'ja'). Improves accuracy.",
		}),
	),
	sheet: Type.Optional(
		Type.String({
			description: "For spreadsheets: specific sheet name to transcribe. If omitted, all sheets are included.",
		}),
	),
	page_range: Type.Optional(
		Type.String({
			description: "For PDFs: page range to transcribe, e.g. '1-10'. If omitted, all pages.",
		}),
	),
	mode: Type.Optional(
		Type.Union([Type.Literal("text"), Type.Literal("visual")], {
			description:
				"For images: 'text' extracts OCR text (default), 'visual' provides a detailed visual description.",
		}),
	),
});

export function createTranscribeToolDefinition(): ToolDefinition<typeof transcribeParams> {
	return {
		name: "transcribe",
		label: "Transcribe",
		description: [
			"Convert any file to readable text. Faithful transcription — no summarization.",
			"Supports: PDF (text + scanned), DOCX/ODT/RTF, XLSX/ODS, CSV/TSV,",
			"Images (OCR + description), Audio (speech + environment sounds), Jupyter Notebooks.",
			"Writes a .md file next to the source file and returns the path.",
			"Use cat or head to read the transcribed content.",
		].join(" "),
		promptSnippet: "Convert non-text files (PDF, DOCX, images, audio, etc.) to readable text",
		promptGuidelines: [
			"Use transcribe when the user shares or references a non-text file (PDF, image, audio, spreadsheet, etc.).",
			"The tool writes a .md file and returns its path. Use cat/head/sed to read it.",
			"For large files, the .md may be long — use head/tail to read selectively.",
			"Use mode='visual' for images when you need a description rather than OCR.",
		],
		parameters: transcribeParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ToolContext) {
			const { paths, language, sheet, page_range, mode } = params as {
				paths: string | string[];
				language?: string;
				sheet?: string;
				page_range?: string;
				mode?: "text" | "visual";
			};

			let apiKey: string | undefined;
			if (ctx.modelRegistry && TRANSCRIBE_MODEL) {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(TRANSCRIBE_MODEL);
				if (auth.ok) {
					apiKey = auth.apiKey;
				}
			}

			const callApi = async (prompt: string, data?: Buffer, mimeType?: string): Promise<string> => {
				if (!apiKey) {
					throw new Error("No API key available for multimodal transcription. Configure an OpenRouter API key.");
				}

				if (data && mimeType?.startsWith("audio/")) {
					const { transcribeAudioChunk } = await import("./transcribe/api.ts");
					const result = await transcribeAudioChunk(data, mimeType, "transcribe", prompt, { apiKey });
					return result.text;
				}

				const { transcribeImageChunk, transcribeTextChunk } = await import("./transcribe/api.ts");

				if (data && mimeType?.startsWith("image/")) {
					const result = await transcribeImageChunk(data, mimeType, "transcribe", prompt, { apiKey });
					return result.text;
				}

				const result = await transcribeTextChunk(prompt, "transcribe", prompt, { apiKey });
				return result.text;
			};

			const callApiBatch = async (
				prompt: string,
				images: Array<{ label: string; data: Buffer; mimeType: string }>,
			): Promise<string> => {
				if (!apiKey) {
					throw new Error("No API key available for multimodal transcription. Configure an OpenRouter API key.");
				}
				const { transcribeImageBatch } = await import("./transcribe/api.ts");
				return transcribeImageBatch(images, prompt, { apiKey });
			};

			try {
				const result = await transcribe(paths, { language, sheet, pageRange: page_range, mode }, ctx.cwd, callApi, callApiBatch);

				const pathList = result.outputPaths.join("\n");
				const meta = [
					`Transcribed ${result.outputPaths.length} file(s) to .md`,
					result.usedApi ? "(used multimodal API)" : "(local extraction only)",
					result.warnings.length > 0 ? `Warnings: ${result.warnings.join("; ")}` : "",
				]
					.filter(Boolean)
					.join(" ");

				return {
					content: [{ type: "text", text: `${meta}\n\n${pathList}` }],
					details: {
						outputPaths: result.outputPaths,
						chunks: result.chunks,
						usedApi: result.usedApi,
						warnings: result.warnings,
					},
				};
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Transcription failed: ${msg}` }],
					details: { error: msg },
					isError: true,
				};
			}
		},
	};
}
