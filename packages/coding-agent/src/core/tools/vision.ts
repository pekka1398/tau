/**
 * read-image tool — lets the model directly see image files.
 *
 * Reads an image file and returns it as ImageContent so the model
 * can visually perceive it (screenshots, diagrams, photos, etc.).
 */

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { ToolDefinition } from "../tool-types.ts";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const SUPPORTED_EXTENSIONS: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".svg": "image/svg+xml",
	".tiff": "image/tiff",
	".tif": "image/tiff",
	".ico": "image/x-icon",
	".avif": "image/avif",
};

function detectMimeType(filePath: string): string | undefined {
	const lower = filePath.toLowerCase();
	for (const [ext, mime] of Object.entries(SUPPORTED_EXTENSIONS)) {
		if (lower.endsWith(ext)) return mime;
	}
	return undefined;
}

export function createVisionToolDefinition(): ToolDefinition<any, any> {
	return {
		name: "vision",
		label: "Vision",
		description:
			"Read an image file and see its contents directly. " +
			"Supports PNG, JPEG, GIF, WebP, BMP, SVG, TIFF, AVIF. " +
			"Use this when you need to view a screenshot, diagram, photo, or any image. " +
			"For PDFs, use transcribe instead.",
		parameters: Type.Object({
			file_path: Type.String({ description: "Absolute path to the image file" }),
		}),
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			const { file_path } = params as { file_path: string };
			const filePath = resolve(ctx?.cwd ?? process.cwd(), file_path);

			// Check file exists
			let stat: ReturnType<typeof statSync>;
			try {
				stat = statSync(filePath);
			} catch {
				return {
					content: [{ type: "text", text: `Error: File not found: ${filePath}` }],
					details: undefined,
					isError: true,
				};
			}

			// Check size
			if (stat.size > MAX_FILE_SIZE) {
				return {
					content: [
						{ type: "text", text: `Error: File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB, max 20MB)` },
					],
					details: undefined,
					isError: true,
				};
			}

			// Check MIME type
			const mimeType = detectMimeType(filePath);
			if (!mimeType) {
				return {
					content: [
						{
							type: "text",
							text: `Error: Unsupported image format. Supported: ${Object.keys(SUPPORTED_EXTENSIONS).join(", ")}`,
						},
					],
					details: undefined,
					isError: true,
				};
			}

			// Read and encode
			try {
				const buffer = readFileSync(filePath);
				const base64 = buffer.toString("base64");

				const imageContent: ImageContent = {
					type: "image",
					data: base64,
					mimeType,
				};

				return {
					content: [
						{ type: "text", text: `Image loaded: ${filePath} (${mimeType}, ${(stat.size / 1024).toFixed(0)}KB)` },
						imageContent,
					],
					details: undefined,
				};
			} catch (err) {
				return {
					content: [
						{ type: "text", text: `Error reading file: ${err instanceof Error ? err.message : String(err)}` },
					],
					details: undefined,
					isError: true,
				};
			}
		},
	};
}
