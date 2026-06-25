/**
 * Shared types for the omni-tool transcribe pipeline.
 */

/** Supported file format categories. */
export type FileFormat = "pdf" | "docx" | "xlsx" | "csv" | "image" | "audio" | "notebook" | "unknown";

/** PDF subtypes detected during pre-processing. */
export type PdfType = "text" | "scanned" | "mixed";

/** Options passed through the transcribe pipeline. */
export interface TranscribeOptions {
	/** Language hint for OCR / speech-to-text. */
	language?: string;
	/** XLSX sheet name. */
	sheet?: string;
	/** PDF page range, e.g. "1-10". */
	pageRange?: string;
	/** Image mode: OCR text or visual description. */
	mode?: "text" | "visual";
}

/** A single chunk to send to the API. */
export interface Chunk {
	/** Chunk index (0-based). */
	index: number;
	/** Human-readable label, e.g. "pages 1-10" or "00:00-10:00". */
	label: string;
	/** Text content (for formats that can be extracted locally). */
	text?: string;
	/** Binary content (images, audio segments). */
	data?: Buffer;
	/** MIME type of binary data. */
	mimeType?: string;
	/** Whether this chunk needs API transcription or can be used as-is. */
	needsApi: boolean;
}

/** Result of transcribing a single chunk via API. */
export interface ChunkResult {
	index: number;
	label: string;
	text: string;
}

/** Final transcribe result returned to the LLM. */
export interface TranscribeResult {
	/** The transcribed/extracted text. */
	text: string;
	/** Original file format. */
	format: FileFormat;
	/** Number of chunks processed. */
	chunks: number;
	/** Whether API was used. */
	usedApi: boolean;
	/** Warnings or notes. */
	warnings: string[];
}

/** Routing decision for a single page. */
export type PageRoute = "text" | "api";

/** Analysis result for a single PDF page. */
export interface PageAnalysis {
	/** 1-based page number. */
	pageNum: number;
	/** Routing decision. */
	route: PageRoute;
	/** Reasons for the routing decision. */
	reasons: string[];
	/** Character count of extracted text. */
	textLength: number;
	/** Number of embedded images. */
	imageCount: number;
	/** Math font names found on this page. */
	mathFonts: string[];
	/** Number of tables detected. */
	tableCount: number;
	/** Number of drawing commands. */
	drawingCount: number;
}

/** A batch of pages to send to the API together. */
export interface ApiBatch {
	/** 1-based page numbers in this batch. */
	pages: number[];
	/** PNG image data for each page. */
	images: Array<{ pageNum: number; data: Buffer }>;
}

/** Context available to converters during execution. */
export interface ConverterContext {
	/** Working directory for resolving relative paths. */
	cwd: string;
	/** API key for multimodal model. */
	apiKey?: string;
	/** Transcribe options from the tool call. */
	options: TranscribeOptions;
	/** Call the multimodal API with a prompt and optional image/audio data. */
	callApi: (prompt: string, data?: Buffer, mimeType?: string) => Promise<string>;
	/** Call the multimodal API with multiple images in one request (for PDF page batching). */
	callApiBatch?: (prompt: string, images: Array<{ label: string; data: Buffer; mimeType: string }>) => Promise<string>;
}
