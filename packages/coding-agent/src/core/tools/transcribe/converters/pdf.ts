/**
 * PDF converter — per-page routing with PyMuPDF analysis.
 *
 * Pipeline:
 *   1. Analyze every page with PyMuPDF → routing table (text or api)
 *   2. Text pages → pdftotext per page + find_tables
 *   3. API pages → pdftoppm per page → batch (10 pages/call) → multimodal LLM
 *   4. Assemble all pages in order → write .md
 *
 * Logging: every routing decision and API batch composition is recorded in warnings.
 */

import { execFile } from "node:child_process";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzePdfPages } from "../pdf-analyze.ts";
import type { ApiBatch, ConverterContext, TranscribeResult } from "../types.ts";
import type { Converter } from "./_interface.ts";

const API_BATCH_SIZE = 10;

export const pdfConverter: Converter = {
	name: "PDF",
	extensions: [".pdf"],

	async convert(filePath: string, ctx: ConverterContext): Promise<TranscribeResult> {
		const warnings: string[] = [];

		// ── Step 1: Analyze all pages ──────────────────────────────────────
		const analyses = await analyzePdfPages(filePath, ctx.options.pageRange);
		const totalPages = analyses.length;

		// Log routing table
		const textPages = analyses.filter((a) => a.route === "text");
		const apiPages = analyses.filter((a) => a.route === "api");

		warnings.push(`PDF: ${totalPages} pages analyzed`);
		warnings.push(`  text: ${textPages.map((a) => a.pageNum).join(",") || "(none)"}`);
		warnings.push(`  api:  ${apiPages.map((a) => a.pageNum).join(",") || "(none)"}`);

		for (const a of analyses) {
			const reason = a.reasons.length > 0 ? a.reasons.join("; ") : "pure text, no special elements";
			warnings.push(`  page ${a.pageNum}: ${a.route.toUpperCase()} — ${reason}`);
		}

		if (totalPages === 0) {
			return { text: "(empty PDF)", format: "pdf", chunks: 0, usedApi: false, warnings };
		}

		// ── Step 2: Process text pages ─────────────────────────────────────
		const pageResults: Map<number, string> = new Map();

		for (const a of textPages) {
			const text = await extractPageText(filePath, a.pageNum);
			const tables = await extractPageTables(filePath, a.pageNum);
			let pageContent = "";
			if (text.trim()) pageContent += text.trim();
			if (tables) pageContent += (pageContent ? "\n\n" : "") + tables;
			pageResults.set(a.pageNum, pageContent || "(empty page)");
		}

		// ── Step 3: Process API pages ──────────────────────────────────────
		let usedApi = false;

		if (apiPages.length > 0) {
			// Extract page images
			const pageImages = await extractPageImages(
				filePath,
				apiPages.map((a) => a.pageNum),
			);

			// Log image extraction
			for (const img of pageImages) {
				warnings.push(`  page ${img.pageNum}: extracted image ${img.data.length} bytes`);
			}

			// Batch into groups
			const batches = buildBatches(pageImages, API_BATCH_SIZE);

			// Log batch composition
			for (const batch of batches) {
				const totalBytes = batch.images.reduce((sum, img) => sum + img.data.length, 0);
				const base64Bytes = Math.ceil((totalBytes * 4) / 3);
				warnings.push(
					`  API batch: pages [${batch.pages.join(",")}] — ${batch.images.length} images, ${totalBytes} raw bytes, ~${base64Bytes} base64 bytes`,
				);
			}

			// Send each batch to API
			for (const batch of batches) {
				const prompt = buildBatchPrompt(batch.pages);

				let result: string;
				if (ctx.callApiBatch && batch.images.length > 1) {
					// Use batch API
					result = await ctx.callApiBatch(
						prompt,
						batch.images.map((img) => ({
							label: `page ${img.pageNum}`,
							data: img.data,
							mimeType: "image/png",
						})),
					);
				} else {
					// Fallback: one page at a time
					const results: string[] = [];
					for (const img of batch.images) {
						const singlePrompt = buildSinglePrompt(img.pageNum, totalPages);
						const text = await ctx.callApi(singlePrompt, img.data, "image/png");
						results.push(text);
					}
					result = results.join("\n\n");
				}

				// Parse per-page results from the response
				assignBatchResults(result, batch.pages, pageResults, totalPages);
				usedApi = true;
			}
		}

		// ── Step 4: Assemble in page order ─────────────────────────────────
		const sections: string[] = [];
		for (let p = 1; p <= totalPages; p++) {
			const content = pageResults.get(p) || "(page not processed)";
			sections.push(`# Page ${p}\n\n${content}`);
		}

		return {
			text: sections.join("\n\n---\n\n"),
			format: "pdf",
			chunks: totalPages,
			usedApi,
			warnings,
		};
	},
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract text from a single page using pdftotext. */
function extractPageText(filePath: string, pageNum: number): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"pdftotext",
			["-layout", "-f", String(pageNum), "-l", String(pageNum), filePath, "-"],
			{ maxBuffer: 50 * 1024 * 1024 },
			(err, stdout, stderr) => {
				if (err) reject(new Error(`pdftotext page ${pageNum}: ${stderr || err.message}`));
				else resolve(stdout);
			},
		);
	});
}

/** Extract tables from a single page using PyMuPDF via Python subprocess. */
async function extractPageTables(filePath: string, pageNum: number): Promise<string | null> {
	const escapedPath = filePath.replace(/'/g, "\\'");
	const script = `
import fitz, json, sys, os
sys.stderr = open(os.devnull, "w")
doc = fitz.open('${escapedPath}')
page = doc[${pageNum - 1}]
tables = page.findTables()
parts = []
for table in tables.tables:
    data = table.extract()
    if not data:
        continue
    header = [(c or "").replace("\\n", " ").strip() for c in data[0]]
    rows = []
    for row in data[1:]:
        rows.append([(c or "").replace("\\n", " ").strip() for c in row])
    parts.append({"header": header, "rows": rows})
doc.close()
print(json.dumps(parts))
`.trim();

	const tmpFile = join(tmpdir(), `pdf-tables-${Date.now()}.py`);
	await writeFile(tmpFile, script, "utf-8");

	return new Promise((resolve) => {
		execFile("python3", [tmpFile], { maxBuffer: 50 * 1024 * 1024 }, (err, stdout) => {
			unlink(tmpFile).catch(() => {});
			if (err) {
				resolve(null);
				return;
			}
			try {
				const lines = stdout.split("\n").filter((l) => !l.startsWith("Consider using"));
				const tables = JSON.parse(lines.join("\n")) as Array<{ header: string[]; rows: string[][] }>;
				if (tables.length === 0) {
					resolve(null);
					return;
				}
				const parts: string[] = [];
				for (const t of tables) {
					parts.push(`| ${t.header.join(" | ")} |`);
					parts.push(`| ${t.header.map(() => "---").join(" | ")} |`);
					for (const row of t.rows) {
						parts.push(`| ${row.join(" | ")} |`);
					}
					parts.push("");
				}
				resolve(parts.join("\n"));
			} catch {
				resolve(null);
			}
		});
	});
}

/** Extract page images using pdftoppm. Only renders specified pages. */
async function extractPageImages(
	filePath: string,
	pageNums: number[],
): Promise<Array<{ pageNum: number; data: Buffer }>> {
	if (pageNums.length === 0) return [];

	const tmpDir = tmpdir();
	const prefix = join(tmpDir, `omni-pdf-${Date.now()}`);
	const results: Array<{ pageNum: number; data: Buffer }> = [];

	// pdftoppm doesn't support non-contiguous page ranges, so we do one page at a time
	for (const pageNum of pageNums) {
		const pagePrefix = `${prefix}-p${pageNum}`;
		await new Promise<void>((resolve, reject) => {
			execFile(
				"pdftoppm",
				["-png", "-r", "200", "-f", String(pageNum), "-l", String(pageNum), filePath, pagePrefix],
				(err, _stdout, stderr) => {
					if (err) reject(new Error(`pdftoppm page ${pageNum}: ${stderr || err.message}`));
					else resolve();
				},
			);
		});

		const files = (await readdir(tmpDir))
			.filter((f) => f.startsWith(pagePrefix.split("/").pop()!) && f.endsWith(".png"))
			.sort();

		for (const file of files) {
			const data = await readFile(join(tmpDir, file));
			results.push({ pageNum, data });
		}
	}

	return results;
}

/** Group page images into batches of maxBatchSize. */
function buildBatches(images: Array<{ pageNum: number; data: Buffer }>, maxBatchSize: number): ApiBatch[] {
	const batches: ApiBatch[] = [];
	for (let i = 0; i < images.length; i += maxBatchSize) {
		const slice = images.slice(i, i + maxBatchSize);
		batches.push({
			pages: slice.map((img) => img.pageNum),
			images: slice,
		});
	}
	return batches;
}

/** Build prompt for a multi-page batch. */
function buildBatchPrompt(pageNums: number[]): string {
	const pageList = pageNums.map((p) => `Page ${p}`).join(", ");
	return `You are transcribing ${pageNums.length} pages of a PDF document (1-based page numbers: ${pageList}).

Rules:
- Transcribe each page faithfully. Preserve all text, tables, formulas, and formatting.
- Use markdown headers (## Page N) to separate each page.
- For tables, use markdown table format.
- For formulas, preserve in LaTeX notation.
- For images/figures, describe what you see factually and extract any visible text.
- Transcribe EXACTLY what you see. Do NOT summarize or omit content.
- If content is unclear, note [unclear].

Output each page as:
## Page N
(transcribed content)

Separate pages with a blank line.`;
}

/** Build prompt for a single page (fallback). */
function buildSinglePrompt(pageNum: number, totalPages: number): string {
	return `Transcribe this PDF page (page ${pageNum} of ${totalPages}) faithfully.

Rules:
- Preserve all text, tables, formulas, and formatting.
- For tables, use markdown table format.
- For formulas, preserve in LaTeX notation.
- For images/figures, describe what you see factually and extract any visible text.
- Transcribe EXACTLY what you see. Do NOT summarize or omit content.
- If content is unclear, note [unclear].`;
}

/**
 * Assign batch API results to individual pages.
 * Tries to split by "## Page N" headers.
 */
function assignBatchResults(
	batchResult: string,
	pageNums: number[],
	pageResults: Map<number, string>,
	_totalPages: number,
): void {
	if (pageNums.length === 1) {
		pageResults.set(pageNums[0], batchResult);
		return;
	}

	// Try to split by ## Page N headers
	const sections = new Map<number, string>();
	const regex = /## Page (\d+)\s*\n([\s\S]*?)(?=## Page \d+|$)/g;
	for (const match of batchResult.matchAll(regex)) {
		const pageNum = parseInt(match[1], 10);
		sections.set(pageNum, match[2].trim());
	}

	// Assign parsed sections, fall back to sequential
	let assigned = 0;
	for (const pageNum of pageNums) {
		if (sections.has(pageNum)) {
			pageResults.set(pageNum, sections.get(pageNum)!);
			assigned++;
		}
	}

	// If parsing failed (no headers found), assign sequentially
	if (assigned === 0) {
		// Split by double newline as rough separator
		const parts = batchResult.split(/\n\n(?=## )/);
		for (let i = 0; i < pageNums.length && i < parts.length; i++) {
			pageResults.set(pageNums[i], parts[i].trim());
		}
	}
}
