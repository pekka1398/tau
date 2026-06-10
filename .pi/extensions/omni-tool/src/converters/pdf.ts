/**
 * PDF converter.
 *
 * Strategy:
 * 1. Run pdftotext to extract text layer
 * 2. Detect PDF type: text-based, scanned, or mixed
 * 3. Text-based → use extracted text directly (no API needed)
 * 4. Scanned → extract page images, send to API in chunks
 * 5. Mixed → text from pdftotext + images for sparse pages
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkByPages, chunkPdfImages, DEFAULTS } from "../chunk.ts";
import type { ConverterContext, PdfType, TranscribeResult } from "../types.ts";
import type { Converter } from "./_interface.ts";

export const pdfConverter: Converter = {
  name: "PDF",
  extensions: [".pdf"],

  async convert(filePath: string, ctx: ConverterContext): Promise<TranscribeResult> {
    const warnings: string[] = [];
    let usedApi = false;

    // Step 1: Extract text with pdftotext
    const rawText = await runPdftotext(filePath, ctx.options.pageRange);
    const pageCount = (rawText.match(/\f/g) || []).length + 1;

    // Step 2: Detect PDF type
    const pdfType = detectPdfType(rawText, pageCount);
    warnings.push(`PDF type: ${pdfType}, ${pageCount} pages`);

    // Step 3: Route based on type
    if (pdfType === "text") {
      // Text-based PDF — use extracted text directly
      const chunks = chunkByPages(rawText, DEFAULTS.PDF_PAGES_PER_CHUNK);
      const merged = chunks.map((c) => c.text).join("\n\n");
      return { text: merged, format: "pdf", chunks: chunks.length, usedApi: false, warnings };
    }

    if (pdfType === "scanned") {
      // Scanned PDF — extract page images and send to API
      usedApi = true;
      const pageImages = await extractPageImages(filePath, ctx.options.pageRange);
      const chunks = chunkPdfImages(pageImages, DEFAULTS.PDF_PAGES_PER_CHUNK);

      const results: string[] = [];
      for (const chunk of chunks) {
        if (chunk.data) {
          const prompt = buildPdfPrompt(chunk.label, "scanned");
          const text = await ctx.callApi(prompt, chunk.data, chunk.mimeType);
          results.push(text);
        }
      }

      return {
        text: results.join("\n\n"),
        format: "pdf",
        chunks: chunks.length,
        usedApi: true,
        warnings,
      };
    }

    // Mixed — use text where available, API for sparse pages
    usedApi = true;
    warnings.push("Mixed PDF: combining extracted text with API-transcribed pages");

    // For now, fall back to full API transcription for mixed PDFs
    // TODO: smarter per-page routing
    const pageImages = await extractPageImages(filePath, ctx.options.pageRange);
    const chunks = chunkPdfImages(pageImages, DEFAULTS.PDF_PAGES_PER_CHUNK);

    const results: string[] = [];
    for (const chunk of chunks) {
      if (chunk.data) {
        const prompt = buildPdfPrompt(chunk.label, "mixed");
        const text = await ctx.callApi(prompt, chunk.data, chunk.mimeType);
        results.push(text);
      }
    }

    return {
      text: results.join("\n\n"),
      format: "pdf",
      chunks: chunks.length,
      usedApi: true,
      warnings,
    };
  },
};

/** Run pdftotext and return raw text output. */
function runPdftotext(filePath: string, pageRange?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-layout"];
    if (pageRange) {
      // pdftotext uses -f (first) and -l (last) for page range
      const [start, end] = pageRange.split("-");
      if (start) args.push("-f", start);
      if (end) args.push("-l", end);
    }
    args.push(filePath, "-");

    execFile("pdftotext", args, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`pdftotext failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

/**
 * Detect whether a PDF is text-based, scanned, or mixed.
 * Heuristic: ratio of printable characters to page count.
 */
function detectPdfType(text: string, pageCount: number): PdfType {
  // Strip whitespace and form feeds
  const stripped = text.replace(/[\s\f]/g, "");
  const charsPerPage = stripped.length / Math.max(pageCount, 1);

  if (charsPerPage > 200) return "text";
  if (charsPerPage < 20) return "scanned";
  return "mixed";
}

/**
 * Extract page images from PDF using pdftoppm (part of poppler-utils).
 */
async function extractPageImages(
  filePath: string,
  pageRange?: string,
): Promise<Array<{ pageNum: number; data: Buffer }>> {
  const tmpDir = tmpdir();
  const prefix = join(tmpDir, `omni-pdf-${Date.now()}`);

  const args = ["-png", "-r", "200"]; // 200 DPI for good quality
  if (pageRange) {
    const [start, end] = pageRange.split("-");
    if (start) args.push("-f", start);
    if (end) args.push("-l", end);
  }
  args.push(filePath, prefix);

  await new Promise<void>((resolve, reject) => {
    execFile("pdftoppm", args, (err, _stdout, stderr) => {
      if (err) reject(new Error(`pdftoppm failed: ${stderr || err.message}`));
      else resolve();
    });
  });

  // pdftoppm creates files like prefix-01.png, prefix-02.png, etc.
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(tmpDir))
    .filter((f) => f.startsWith(prefix.split("/").pop()!) && f.endsWith(".png"))
    .sort();

  const pages: Array<{ pageNum: number; data: Buffer }> = [];
  for (const file of files) {
    const fullPath = join(tmpDir, file);
    // Extract page number from filename like prefix-01.png
    const match = file.match(/-(\d+)\.png$/);
    const pageNum = match ? parseInt(match[1], 10) : pages.length + 1;
    pages.push({ pageNum, data: await readFile(fullPath) });
  }

  return pages;
}

function buildPdfPrompt(label: string, pdfType: PdfType): string {
  const base = `Transcribe this PDF page faithfully. Preserve all text, tables, and formatting.`;

  if (pdfType === "scanned") {
    return `${base}\nThis is a scanned document. Extract ALL visible text via OCR. Preserve the original layout as much as possible.`;
  }

  return `${base}\nThis page may contain mixed content (text, images, tables). Extract everything.`;
}
