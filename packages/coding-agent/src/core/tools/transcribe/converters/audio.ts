/**
 * Audio converter — traditional DSP pre-processing for better transcription.
 *
 * Pipeline:
 *   1. Probe: ffprobe → format, duration, sample rate, channels, bitrate
 *   2. Analyze original: volumedetect (max/mean dB), silencedetect
 *   3. Select preset based on analysis (conservative / speech / aggressive)
 *   4. Pre-process: highpass → lowpass → denoise → dynamics → limiter → loudnorm
 *   5. Detect silence on processed audio (adaptive threshold)
 *   6. Chunk: by silence boundaries, hard max guarantee, no s.end! assertions
 *   7. Extract chunks with 2s overlap context
 *   8. Normalize to 16kHz mono only at chunk extraction (last step)
 *   9. Send each chunk to API
 *  10. Assemble in order
 *  11. Cleanup work dir in finally
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConverterContext, TranscribeResult } from "../types.ts";
import type { Converter } from "./_interface.ts";

const MAX_CHUNK_SEC = 600; // 10 min hard limit
const SILENCE_DURATION = "0.4"; // seconds
const OVERLAP_SEC = 2; // context overlap between chunks

type PreprocessPreset = "conservative" | "speech" | "aggressive";

export const audioConverter: Converter = {
	name: "Audio",
	extensions: [".mp3", ".wav", ".flac", ".ogg", ".aac", ".m4a", ".wma", ".opus"],

	async convert(filePath: string, ctx: ConverterContext): Promise<TranscribeResult> {
		const warnings: string[] = [];

		// Each conversion gets its own temp directory — cleaned up in finally
		const workDir = await mkdtemp(join(tmpdir(), "omni-audio-"));

		try {
			// ── Step 1: Probe ──────────────────────────────────────────────
			const probe = await probeAudio(filePath);
			if (probe.durationSec <= 0) throw new Error("Audio has no duration");
			if (!probe.hasAudioStream) throw new Error("No audio stream found");
			warnings.push(
				`Input: ${probe.format}, ${probe.durationSec.toFixed(1)}s, ${probe.sampleRate}Hz, ${probe.channels}ch, ${probe.bitrate ?? "?"}bps`,
			);

			// ── Step 2: Analyze original ───────────────────────────────────
			const analysis = await analyzeAudio(filePath);
			warnings.push(
				`Volume: max=${formatDb(analysis.maxVolumeDb)}, mean=${formatDb(analysis.meanVolumeDb)}`,
			);
			warnings.push(`Silence: ${analysis.silences.length} segments detected`);

			// ── Step 3: Select preset ──────────────────────────────────────
			const preset = selectPreset(analysis);
			warnings.push(`Preset: ${preset}`);

			// ── Step 4: Pre-process → processed.wav (original sample rate) ─
			const processedPath = join(workDir, "processed.wav");
			const filters = buildFilters(preset, probe.channels > 1);
			await runFfmpeg([
				"-i", filePath,
				"-af", filters.join(","),
				"-acodec", "pcm_s16le",
				"-y", processedPath,
			]);
			warnings.push(`Pre-processing: ${filters.length} filters (${preset})`);

			// ── Step 5: Detect silence on processed audio ──────────────────
			const silenceThresh = chooseSilenceThreshold(analysis);
			const processedSilences = await detectSilence(processedPath, silenceThresh);
			warnings.push(
				`Silence (processed): ${processedSilences.length} segments, threshold=${silenceThresh}`,
			);

			// ── Step 6: Build chunks ───────────────────────────────────────
			const chunks = buildChunks(probe.durationSec, processedSilences, MAX_CHUNK_SEC, {
				minChunkSec: 30,
			});
			warnings.push(
				`Chunks: ${chunks.length} (${chunks.map((c) => `${c.label}`).join(", ")})`,
			);

			// ── Step 7–9: Extract, normalize, transcribe ───────────────────
			const results: string[] = [];
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];

				// Extract with overlap context → pipe to buffer (no temp chunk file)
				const readStart = Math.max(0, chunk.startSec - OVERLAP_SEC);
				const readEnd = Math.min(probe.durationSec, chunk.endSec + OVERLAP_SEC);
				const readDuration = readEnd - readStart;

				const segmentData = await extractChunkToBuffer(processedPath, readStart, readDuration);
				const prompt = buildAudioPrompt(chunk.label, i === 0, probe, chunks.length, OVERLAP_SEC > 0);
				const text = await ctx.callApi(prompt, segmentData, "audio/wav");
				results.push(`[${chunk.label}]\n${text}`);
			}

			// ── Step 10: Assemble ──────────────────────────────────────────
			return {
				text: results.join("\n\n"),
				format: "audio",
				chunks: chunks.length,
				usedApi: true,
				warnings,
			};
		} finally {
			// ── Step 11: Cleanup ───────────────────────────────────────────
			await rm(workDir, { recursive: true, force: true }).catch(() => {});
		}
	},
};

// ── Types ────────────────────────────────────────────────────────────────────

interface AudioProbe {
	format: string;
	durationSec: number;
	sampleRate: number;
	channels: number;
	bitrate?: number;
	hasAudioStream: boolean;
}

interface AudioAnalysis {
	maxVolumeDb?: number;
	meanVolumeDb?: number;
	silences: Array<{ start: number; end?: number }>;
}

interface Chunk {
	startSec: number;
	endSec: number;
	label: string;
}

interface CompleteSilence {
	start: number;
	end: number;
}

// ── Helpers: ffmpeg wrappers ─────────────────────────────────────────────────

function runFfmpeg(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile(
			"ffmpeg",
			["-hide_banner", "-nostdin", ...args],
			{ maxBuffer: 50 * 1024 * 1024 },
			(err, _stdout, stderr) => {
				if (err) {
					reject(new Error(`ffmpeg failed: ${stderr?.slice(-4000) || err.message}`));
					return;
				}
				resolve();
			},
		);
	});
}

function extractChunkToBuffer(inputPath: string, startSec: number, durationSec: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		execFile(
			"ffmpeg",
			[
				"-hide_banner", "-nostdin",
				"-ss", String(startSec),
				"-t", String(durationSec),
				"-i", inputPath,
				"-f", "wav",
				"-ar", "16000",
				"-ac", "1",
				"pipe:1",
			],
			{ encoding: "buffer", maxBuffer: 150 * 1024 * 1024 },
			(err, stdout, stderr) => {
				if (err) {
					const msg = stderr instanceof Buffer ? stderr.toString("utf8").slice(-4000) : String(stderr);
					reject(new Error(`ffmpeg chunk extraction failed: ${msg || err.message}`));
					return;
				}
				resolve(stdout as unknown as Buffer);
			},
		);
	});
}

function runFfmpegCaptureStderr(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"ffmpeg",
			["-hide_banner", "-nostdin", ...args],
			{ maxBuffer: 50 * 1024 * 1024 },
			(err, _stdout, stderr) => {
				if (err) {
					reject(new Error(`ffmpeg failed: ${stderr?.slice(-4000) || err.message}`));
					return;
				}
				resolve(stderr ?? "");
			},
		);
	});
}

function runFfprobe(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("ffprobe", args, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
			if (err) reject(new Error(`ffprobe failed: ${stderr || err.message}`));
			else resolve(stdout);
		});
	});
}

// ── Probe ────────────────────────────────────────────────────────────────────

async function probeAudio(filePath: string): Promise<AudioProbe> {
	const stdout = await runFfprobe([
		"-v", "quiet",
		"-print_format", "json",
		"-show_format", "-show_streams",
		filePath,
	]);
	const data = JSON.parse(stdout);
	const audioStream = data.streams?.find(
		(s: { codec_type: string }) => s.codec_type === "audio",
	);
	const format = data.format;
	return {
		format: format?.format_name ?? "unknown",
		durationSec: parseFloat(format?.duration ?? "0"),
		sampleRate: parseInt(audioStream?.sample_rate ?? "44100", 10),
		channels: audioStream?.channels ?? 1,
		bitrate: format?.bit_rate ? parseInt(format.bit_rate, 10) : undefined,
		hasAudioStream: !!audioStream,
	};
}

// ── Analyze ──────────────────────────────────────────────────────────────────

function parseDb(value: string | undefined): number | undefined {
	if (!value) return undefined;
	if (value === "-inf") return Number.NEGATIVE_INFINITY;
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? n : undefined;
}

function formatDb(value: number | undefined): string {
	if (value === undefined) return "?";
	if (!Number.isFinite(value)) return "-inf";
	return `${value.toFixed(1)}dB`;
}

async function analyzeAudio(filePath: string): Promise<AudioAnalysis> {
	// volumedetect → max_volume, mean_volume
	const volStderr = await runFfmpegCaptureStderr([
		"-i", filePath,
		"-af", "volumedetect",
		"-f", "null", "-",
	]);

	const dbRe = "(-?inf|[-\\d.]+)";
	const maxMatch = volStderr.match(new RegExp(`max_volume:\\s*${dbRe}\\s*dB`));
	const meanMatch = volStderr.match(new RegExp(`mean_volume:\\s*${dbRe}\\s*dB`));

	// silencedetect
	const silences = await detectSilence(filePath, "-35dB");

	return {
		maxVolumeDb: parseDb(maxMatch?.[1]),
		meanVolumeDb: parseDb(meanMatch?.[1]),
		silences,
	};
}

async function detectSilence(
	filePath: string,
	noiseThresh: string,
): Promise<Array<{ start: number; end?: number }>> {
	const stderr = await runFfmpegCaptureStderr([
		"-i", filePath,
		"-af", `silencedetect=noise=${noiseThresh}:d=${SILENCE_DURATION}`,
		"-f", "null", "-",
	]);

	const silences: Array<{ start: number; end?: number }> = [];
	let current: { start: number; end?: number } | undefined;

	const re = /silence_(start|end):\s*([\d.]+)/g;
	let match: RegExpExecArray | null;

	while ((match = re.exec(stderr)) !== null) {
		const kind = match[1];
		const value = Number.parseFloat(match[2]);
		if (!Number.isFinite(value)) continue;

		if (kind === "start") {
			if (current) silences.push(current);
			current = { start: value };
		} else {
			if (current) {
				current.end = value;
				silences.push(current);
				current = undefined;
			} else {
				silences.push({ start: 0, end: value });
			}
		}
	}

	if (current) silences.push(current);
	return silences;
}

// ── Preset selection ─────────────────────────────────────────────────────────

function selectPreset(analysis: AudioAnalysis): PreprocessPreset {
	const max = analysis.maxVolumeDb;
	const mean = analysis.meanVolumeDb;

	if (max === undefined || mean === undefined) return "conservative";

	const dynamicRange = max - mean;

	// Very dirty: high dynamic range OR very quiet recording
	if (dynamicRange > 30 || mean < -40) return "aggressive";

	// Normal-ish but could use some help
	if (dynamicRange > 18 || mean < -30) return "speech";

	// Already decent quality
	return "conservative";
}

function chooseSilenceThreshold(analysis: AudioAnalysis): string {
	const mean = analysis.meanVolumeDb;
	if (mean === undefined) return "-35dB";
	if (mean < -40) return "-45dB";
	if (mean > -22) return "-30dB";
	return "-35dB";
}

// ── Filter presets ───────────────────────────────────────────────────────────

function buildFilters(preset: PreprocessPreset, isStereo: boolean): string[] {
	const mono = isStereo ? ["pan=mono|c0=0.5*c0+0.5*c1"] : [];

	// Order: mono → highpass → lowpass → limiter (tame peaks first) →
	//        dynaudnorm (balance volumes) → denoise → loudnorm
	switch (preset) {
		case "conservative":
			return [
				...mono,
				"highpass=f=70",
				"lowpass=f=12000",
				"alimiter=limit=0.98",
				"loudnorm=I=-18:TP=-2:LRA=10",
			];

		case "speech":
			return [
				...mono,
				"highpass=f=70",
				"lowpass=f=12000",
				"alimiter=limit=-3dB:attack=5:release=50",
				"dynaudnorm=f=200:g=15:p=0.95:m=10",
				"afftdn=nr=4:nf=-40",
				"loudnorm=I=-18:TP=-2:LRA=8",
			];

		case "aggressive":
			return [
				...mono,
				"highpass=f=90",
				"lowpass=f=11000",
				"alimiter=limit=-3dB:attack=5:release=50",
				"dynaudnorm=f=150:g=20:p=0.95:m=15",
				"afftdn=nr=6:nf=-35",
				"acompressor=threshold=-22dB:ratio=3:attack=5:release=120:makeup=4",
				"loudnorm=I=-18:TP=-2:LRA=6",
			];
	}
}

// ── Chunking ─────────────────────────────────────────────────────────────────

function isCompleteSilence(s: { start: number; end?: number }): s is CompleteSilence {
	return (
		Number.isFinite(s.start) &&
		typeof s.end === "number" &&
		Number.isFinite(s.end) &&
		s.end > s.start
	);
}

function buildChunks(
	durationSec: number,
	silences: Array<{ start: number; end?: number }>,
	maxSec: number,
	options?: { minChunkSec?: number },
): Chunk[] {
	const minChunkSec = options?.minChunkSec ?? 30;

	if (!Number.isFinite(durationSec) || durationSec <= 0) {
		throw new Error(`Invalid audio duration: ${durationSec}`);
	}

	// Single chunk if short enough and no useful silence points
	if (durationSec <= maxSec) {
		const splitPoints = silences
			.filter(isCompleteSilence)
			.map((s) => (s.start + s.end) / 2)
			.filter((t) => t > minChunkSec && t < durationSec - minChunkSec)
			.sort((a, b) => a - b);

		if (splitPoints.length === 0) {
			return [{ startSec: 0, endSec: durationSec, label: `${formatTime(0)}-${formatTime(durationSec)}` }];
		}

		// Split at best silence point
		const mid = splitPoints[Math.floor(splitPoints.length / 2)];
		return [
			{ startSec: 0, endSec: mid, label: `${formatTime(0)}-${formatTime(mid)}` },
			{ startSec: mid, endSec: durationSec, label: `${formatTime(mid)}-${formatTime(durationSec)}` },
		];
	}

	// Multiple chunks needed — build with hard max guarantee
	const splitPoints = silences
		.filter(isCompleteSilence)
		.map((s) => (s.start + s.end) / 2)
		.filter((t) => t > 0 && t < durationSec)
		.sort((a, b) => a - b);

	const chunks: Chunk[] = [];
	let start = 0;

	while (start < durationSec) {
		const hardEnd = Math.min(start + maxSec, durationSec);

		if (hardEnd >= durationSec) {
			chunks.push({
				startSec: start,
				endSec: durationSec,
				label: `${formatTime(start)}-${formatTime(durationSec)}`,
			});
			break;
		}

		// Find the latest silence point before hardEnd, but after minChunkSec
		const candidates = splitPoints.filter(
			(p) => p > start + minChunkSec && p <= hardEnd,
		);

		const end = candidates.length > 0 ? candidates[candidates.length - 1] : hardEnd;

		if (end <= start) {
			// Safety: shouldn't happen, but avoid infinite loop
			chunks.push({
				startSec: start,
				endSec: hardEnd,
				label: `${formatTime(start)}-${formatTime(hardEnd)}`,
			});
			start = hardEnd;
			continue;
		}

		chunks.push({
			startSec: start,
			endSec: end,
			label: `${formatTime(start)}-${formatTime(end)}`,
		});

		start = end;
	}

	return chunks;
}

function formatTime(sec: number): string {
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = Math.floor(sec % 60);
	if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Prompt ───────────────────────────────────────────────────────────────────

function buildAudioPrompt(
	label: string,
	isFirstChunk: boolean,
	probe: AudioProbe,
	totalChunks: number,
	hasOverlap: boolean,
): string {
	return `You are a meticulous transcription engine.

Transcribe this audio segment faithfully and completely.

Segment: ${label} (${totalChunks} total segments)
Audio: ${probe.durationSec.toFixed(0)}s total, ${probe.sampleRate}Hz, ${probe.channels}ch.

Critical rules:
- Return only the transcript. Do not add explanations, notes, commentary, or conclusions.
- Transcribe every audible spoken word. Do not summarize, paraphrase, or shorten.
- Do not clean up grammar. Preserve the original spoken style.
- Preserve filler words, hesitations, false starts, repetitions, interruptions, and unfinished sentences.
- Preserve numbers, names, dates, technical terms, and code-like words exactly as heard.
- If speech is unclear, write [unclear] instead of guessing.
- If multiple speakers are present, mark speaker changes as [Speaker 1], [Speaker 2], etc.
- Describe non-speech audio briefly in brackets: [door closes], [phone ringing], [music playing].
${hasOverlap ? "- This segment may include a few seconds of overlap with neighboring segments. Transcribe what is audible in this segment regardless." : ""}
${isFirstChunk ? "- This is the first segment. Identify the spoken language and speakers if possible." : ""}`;
}
