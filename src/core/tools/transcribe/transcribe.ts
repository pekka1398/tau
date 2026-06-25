/**
 * Transcribe orchestrator.
 *
 * Pipeline: detect → pre-process → chunk → API → post-process → merge → write .md
 *
 * Output: writes a .md file next to the source file (same name, different extension).
 * Returns the absolute path to the .md file so the LLM can cat/read it.
 */

import { writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { Converter } from "./converters/_interface.ts";
import { audioConverter } from "./converters/audio.ts";
import { csvConverter } from "./converters/csv.ts";
import { docxConverter } from "./converters/docx.ts";
import { imageConverter } from "./converters/image.ts";
import { notebookConverter } from "./converters/notebook.ts";
import { pdfConverter } from "./converters/pdf.ts";
import { xlsxConverter } from "./converters/xlsx.ts";
import { detectFormat } from "./detect.ts";
import type { ConverterContext, TranscribeOptions, TranscribeResult } from "./types.ts";

/** All registered converters. */
const CONVERTERS: Converter[] = [
	pdfConverter,
	docxConverter,
	xlsxConverter,
	csvConverter,
	imageConverter,
	audioConverter,
	notebookConverter,
];

/** Output of a transcribe call. */
export interface TranscribeOutput {
	/** Absolute path(s) to the generated .md file(s). */
	outputPaths: string[];
	/** Number of chunks processed. */
	chunks: number;
	/** Whether API was used. */
	usedApi: boolean;
	/** Warnings or notes. */
	warnings: string[];
}

/**
 * Transcribe one or more files.
 * Writes .md files next to each source file and returns their paths.
 */
export async function transcribe(
	paths: string | string[],
	options: TranscribeOptions,
	cwd: string,
	callApi: (prompt: string, data?: Buffer, mimeType?: string) => Promise<string>,
	callApiBatch?: (prompt: string, images: Array<{ label: string; data: Buffer; mimeType: string }>) => Promise<string>,
): Promise<TranscribeOutput> {
	const filePaths = Array.isArray(paths) ? paths : [paths];

	if (filePaths.length === 0) {
		return { outputPaths: [], chunks: 0, usedApi: false, warnings: ["No files provided"] };
	}

	const outputPaths: string[] = [];
	const allWarnings: string[] = [];
	let totalChunks = 0;
	let anyUsedApi = false;

	for (const filePath of filePaths) {
		try {
			const result = await transcribeSingle(filePath, options, cwd, callApi, callApiBatch);
			totalChunks += result.chunks;
			if (result.usedApi) anyUsedApi = true;
			allWarnings.push(...result.warnings);

			// Write .md next to source file
			const mdPath = getMdPath(resolve(cwd, filePath));
			await writeFile(mdPath, result.text, "utf-8");
			outputPaths.push(mdPath);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			allWarnings.push(`Failed to transcribe ${filePath}: ${msg}`);
		}
	}

	return { outputPaths, chunks: totalChunks, usedApi: anyUsedApi, warnings: allWarnings };
}

/** Get the .md output path for a source file. */
function getMdPath(sourcePath: string): string {
	const dir = dirname(sourcePath);
	const ext = extname(sourcePath);
	const name = basename(sourcePath, ext);
	return join(dir, `${name}.md`);
}

/** Transcribe a single file. */
async function transcribeSingle(
	filePath: string,
	options: TranscribeOptions,
	cwd: string,
	callApi: (prompt: string, data?: Buffer, mimeType?: string) => Promise<string>,
	callApiBatch?: (prompt: string, images: Array<{ label: string; data: Buffer; mimeType: string }>) => Promise<string>,
): Promise<TranscribeResult> {
	const absPath = resolve(cwd, filePath);
	const format = detectFormat(absPath);

	if (format === "unknown") {
		return {
			text: `[Unknown file format: ${filePath}]`,
			format: "unknown",
			chunks: 0,
			usedApi: false,
			warnings: [`Unsupported file extension: ${filePath}`],
		};
	}

	const ext = absPath.toLowerCase();
	const converter = CONVERTERS.find((c) => c.extensions.some((e) => ext.endsWith(e)));

	if (!converter) {
		return {
			text: `[No converter for format: ${format}]`,
			format,
			chunks: 0,
			usedApi: false,
			warnings: [`No converter registered for ${format}`],
		};
	}

	const ctx: ConverterContext = { cwd, options, callApi, callApiBatch };
	return converter.convert(absPath, ctx);
}
