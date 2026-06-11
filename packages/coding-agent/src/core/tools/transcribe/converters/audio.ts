/**
 * Audio converter — traditional DSP pre-processing for better transcription.
 *
 * Pipeline:
 *   1. Probe: ffprobe → format, duration, sample rate, channels, bitrate
 *   2. Analyze original: volumedetect (max/mean dB), silencedetect
 *   3. Select preset based on analysis (conservative / speech / aggressive)
 *   4. Pre-process: mono → highpass → lowpass → denoise → limiter → dynaudnorm → loudnorm
 *   5. Re-probe processed audio, analyze processed volume
 *   6. Detect silence on processed audio (threshold from processed volume)
 *   7. Chunk: by silence boundaries, hard max guarantee, no overlap overflow
 *   8. Extract chunks with overlap context → pipe to buffer (no temp files)
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
const OVERLAP_SEC = 2; // context overlap between chunks
const SILENCE_DURATION = "0.5"; // seconds of silence to detect

type PreprocessPreset = "conservative" | "speech" | "aggressive";

export const audioConverter: Converter = {
	name: "Audio",
	extensions: [".mp3", ".wav", ".flac", ".ogg", ".aac", ".m4a", ".wma", ".opus"],

	async convert(filePath: string, ctx: ConverterContext): Promise<TranscribeResult> {
		const warnings: string[] = [];
		const workDir = await mkdtemp(join(tmpdir(), "omni-audio-"));

		try {
			// ── Step 1: Probe ──────────────────────────────────────────────
			const probe = await probeAudio(filePath);
			if (!Number.isFinite(probe.durationSec) || probe.durationSec <= 0) {
				throw new Error(`Invalid audio duration: ${probe.durationSec}`);
			}
			if (!probe.hasAudioStream) throw new Error("No audio stream found");
			warnings.push(
				`Input: ${probe.format}, ${probe.durationSec.toFixed(1)}s, ${probe.sampleRate}Hz, ${probe.channels}ch, ${probe.bitrate ?? "?"}bps`,
			);

			// ── Step 2: Analyze original ───────────────────────────────────
			const origAnalysis = await analyzeVolume(filePath);
			warnings.push(
				`Volume (original): max=${formatDb(origAnalysis.maxVolumeDb)}, mean=${formatDb(origAnalysis.meanVolumeDb)}`,
			);

			// ── Step 3: Select preset ──────────────────────────────────────
			const preset = selectPreset(origAnalysis);
			warnings.push(`Preset: ${preset}`);

			// ── Step 4: Pre-process (with fallback) ────────────────────────
			const processedPath = join(workDir, "processed.wav");
			let actualPreset = preset;

			const tryPreprocess = async (p: PreprocessPreset) => {
				const filters = buildFilters(p, probe.channels, probe.sampleRate);
				await runFfmpeg([
					"-i", filePath,
					"-map", "0:a:0", "-vn",
					"-af", filters.join(","),
					"-acodec", "pcm_s16le",
					"-y", processedPath,
				]);
				return filters;
			};

			let filters: string[];
			try {
				filters = await tryPreprocess(preset);
			} catch (err) {
				if (preset !== "conservative") {
					warnings.push(`Pre-processing with ${preset} failed, falling back to conservative`);
					actualPreset = "conservative";
					filters = await tryPreprocess("conservative");
				} else {
					throw err;
				}
			}
			warnings.push(`Pre-processing: ${actualPreset} (${filters.length} filters)`);

			// ── Step 5: Re-probe processed audio ───────────────────────────
			const processedProbe = await probeAudio(processedPath);
			const processedDuration = processedProbe.durationSec;
			const processedVol = await analyzeVolume(processedPath);
			warnings.push(
				`Volume (processed): max=${formatDb(processedVol.maxVolumeDb)}, mean=${formatDb(processedVol.meanVolumeDb)}`,
			);

			// ── Step 6: Detect silence on processed audio ──────────────────
			const silenceThresh = chooseSilenceThreshold(processedVol);
			const silences = await detectSilence(processedPath, silenceThresh);
			warnings.push(`Silence: ${silences.length} segments, threshold=${silenceThresh}`);

			// ── Step 7: Build chunks ───────────────────────────────────────
			// Reserve room for overlap so actual extracted audio never exceeds MAX_CHUNK_SEC
			const effectiveMax = MAX_CHUNK_SEC - OVERLAP_SEC * 2;
			const chunks = buildChunks(processedDuration, silences, effectiveMax, { minChunkSec: 30 });
			warnings.push(`Chunks: ${chunks.length} (${chunks.map((c) => c.label).join(", ")})`);

			// ── Step 8–9: Extract & transcribe ─────────────────────────────
			const results: string[] = [];
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];

				const readStart = Math.max(0, chunk.startSec - OVERLAP_SEC);
				const readEnd = Math.min(processedDuration, chunk.endSec + OVERLAP_SEC);
				const readDuration = readEnd - readStart;

				const segmentData = await extractChunkToBuffer(processedPath, readStart, readDuration);

				const leadingOverlap = chunk.startSec - readStart;
				const trailingOverlap = readEnd - chunk.endSec;

				const prompt = buildAudioPrompt({
					chunkIndex: i + 1,
					totalChunks: chunks.length,
					label: chunk.label,
					isFirstChunk: i === 0,
					probe,
					leadingOverlapSec: leadingOverlap,
					trailingOverlapSec: trailingOverlap,
				});

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

interface VolumeStats {
	maxVolumeDb?: number;
	meanVolumeDb?: number;
}

interface SilenceSegment {
	start: number;
	end: number;
}

interface Chunk {
	startSec: number;
	endSec: number;
	label: string;
}

// ── ffmpeg wrappers ──────────────────────────────────────────────────────────

function runFfmpeg(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile(
			"ffmpeg",
			["-hide_banner", "-nostdin", "-nostats", "-v", "error", ...args],
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

function runFfmpegCaptureStderr(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"ffmpeg",
			["-hide_banner", "-nostdin", "-nostats", "-v", "info", ...args],
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

function extractChunkToBuffer(inputPath: string, startSec: number, durationSec: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		execFile(
			"ffmpeg",
			[
				"-hide_banner", "-nostdin", "-nostats", "-v", "error",
				"-ss", String(startSec),
				"-t", String(durationSec),
				"-i", inputPath,
				"-map", "0:a:0", "-vn",
				"-f", "wav",
				"-ar", "16000",
				"-ac", "1",
				"pipe:1",
			],
			{ encoding: "buffer", maxBuffer: 150 * 1024 * 1024 },
			(err, stdout, stderr) => {
				if (err) {
					const msg = Buffer.isBuffer(stderr)
						? stderr.toString("utf8").slice(-4000)
						: String(stderr).slice(-4000);
					reject(new Error(`ffmpeg chunk extraction failed: ${msg || err.message}`));
					return;
				}
				if (!Buffer.isBuffer(stdout)) {
					reject(new Error("ffmpeg chunk extraction did not return a Buffer"));
					return;
				}
				resolve(stdout);
			},
		);
	});
}

// ── Probe ────────────────────────────────────────────────────────────────────

async function probeAudio(filePath: string): Promise<AudioProbe> {
	const stdout = await runFfprobe([
		"-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath,
	]);
	const data = JSON.parse(stdout);
	const stream = data.streams?.find((s: { codec_type: string }) => s.codec_type === "audio");
	const fmt = data.format;

	const durationRaw = fmt?.duration ?? stream?.duration ?? "0";
	const sampleRateRaw = stream?.sample_rate ?? "44100";

	return {
		format: fmt?.format_name ?? "unknown",
		durationSec: Number.parseFloat(durationRaw),
		sampleRate: Number.parseInt(sampleRateRaw, 10),
		channels: stream?.channels ?? 1,
		bitrate: fmt?.bit_rate ? Number.parseInt(fmt.bit_rate, 10) : undefined,
		hasAudioStream: !!stream,
	};
}

// ── Volume analysis ──────────────────────────────────────────────────────────

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

async function analyzeVolume(filePath: string): Promise<VolumeStats> {
	const stderr = await runFfmpegCaptureStderr([
		"-i", filePath,
		"-map", "0:a:0", "-vn",
		"-af", "volumedetect",
		"-f", "null", "-",
	]);

	const dbRe = "(-?inf|[-\\d.]+)";
	const maxMatch = stderr.match(new RegExp(`max_volume:\\s*${dbRe}\\s*dB`));
	const meanMatch = stderr.match(new RegExp(`mean_volume:\\s*${dbRe}\\s*dB`));

	return {
		maxVolumeDb: parseDb(maxMatch?.[1]),
		meanVolumeDb: parseDb(meanMatch?.[1]),
	};
}

// ── Silence detection ────────────────────────────────────────────────────────

async function detectSilence(
	filePath: string,
	noiseThresh: string,
): Promise<SilenceSegment[]> {
	const stderr = await runFfmpegCaptureStderr([
		"-i", filePath,
		"-map", "0:a:0", "-vn",
		"-af", `silencedetect=noise=${noiseThresh}:d=${SILENCE_DURATION}`,
		"-f", "null", "-",
	]);

	const silences: SilenceSegment[] = [];
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
				silences.push(current as SilenceSegment);
				current = undefined;
			}
		}
	}

	if (current?.end !== undefined) silences.push(current as SilenceSegment);

	return silences;
}

// ── Preset selection ─────────────────────────────────────────────────────────

function selectPreset(vol: VolumeStats): PreprocessPreset {
	const max = vol.maxVolumeDb;
	const mean = vol.meanVolumeDb;
	if (max === undefined || mean === undefined) return "conservative";

	const dynamicRange = max - mean;
	if (dynamicRange > 30 || mean < -40) return "aggressive";
	if (dynamicRange > 18 || mean < -30) return "speech";
	return "conservative";
}

function chooseSilenceThreshold(vol: VolumeStats): string {
	const mean = vol.meanVolumeDb;
	if (mean === undefined) return "-35dB";
	if (mean < -40) return "-45dB";
	if (mean > -22) return "-30dB";
	return "-35dB";
}

// ── Filter presets ───────────────────────────────────────────────────────────

function chooseLowpassHz(sampleRate: number, preferredHz: number): number {
	const nyquist = sampleRate / 2;
	return Math.floor(Math.min(preferredHz, nyquist * 0.95));
}

function buildMonoFilter(channels: number): string[] {
	if (channels <= 1) return [];
	if (channels === 2) return ["pan=mono|c0=0.5*c0+0.5*c1"];
	return ["aformat=channel_layouts=mono"];
}

function buildFilters(preset: PreprocessPreset, channels: number, sampleRate: number): string[] {
	const mono = buildMonoFilter(channels);

	switch (preset) {
		case "conservative":
			return [
				...mono,
				"highpass=f=70",
				`lowpass=f=${chooseLowpassHz(sampleRate, 12000)}`,
				"alimiter=limit=0.98:attack=5:release=50",
				"loudnorm=I=-18:TP=-2:LRA=10",
			];

		case "speech":
			return [
				...mono,
				"highpass=f=70",
				`lowpass=f=${chooseLowpassHz(sampleRate, 12000)}`,
				"afftdn=nr=4:nf=-40",
				"alimiter=limit=0.95:attack=5:release=50",
				"dynaudnorm=f=200:g=15:p=0.95:m=10",
				"alimiter=limit=0.95:attack=5:release=50",
				"loudnorm=I=-18:TP=-2:LRA=8",
			];

		case "aggressive":
			return [
				...mono,
				"highpass=f=90",
				`lowpass=f=${chooseLowpassHz(sampleRate, 11000)}`,
				"afftdn=nr=6:nf=-35",
				"alimiter=limit=0.95:attack=5:release=50",
				"dynaudnorm=f=150:g=20:p=0.95:m=15",
				"acompressor=threshold=-22dB:ratio=3:attack=5:release=120:makeup=4",
				"alimiter=limit=0.90:attack=5:release=50",
				"loudnorm=I=-18:TP=-2:LRA=6",
			];
	}
}

// ── Chunking ─────────────────────────────────────────────────────────────────

function isCompleteSilence(s: { start: number; end?: number }): s is SilenceSegment {
	return (
		Number.isFinite(s.start) &&
		typeof s.end === "number" &&
		Number.isFinite(s.end) &&
		s.end > s.start
	);
}

function buildChunks(
	durationSec: number,
	silences: SilenceSegment[],
	maxSec: number,
	options?: { minChunkSec?: number },
): Chunk[] {
	const minChunkSec = options?.minChunkSec ?? 30;

	if (!Number.isFinite(durationSec) || durationSec <= 0) {
		throw new Error(`Invalid audio duration: ${durationSec}`);
	}

	// Short enough: single chunk, don't split just because there's silence
	if (durationSec <= maxSec) {
		return [{ startSec: 0, endSec: durationSec, label: `${formatTime(0)}-${formatTime(durationSec)}` }];
	}

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

		const candidates = splitPoints.filter(
			(p) => p > start + minChunkSec && p <= hardEnd,
		);

		const end = candidates.length > 0 ? candidates[candidates.length - 1] : hardEnd;

		if (end <= start) {
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

function buildAudioPrompt(opts: {
	chunkIndex: number;
	totalChunks: number;
	label: string;
	isFirstChunk: boolean;
	probe: AudioProbe;
	leadingOverlapSec: number;
	trailingOverlapSec: number;
}): string {
	const hasOverlap = opts.leadingOverlapSec > 0 || opts.trailingOverlapSec > 0;

	return `You are a meticulous transcription engine.

Transcribe this audio segment faithfully and completely.

Segment: ${opts.chunkIndex}/${opts.totalChunks}, time range ${opts.label}
Audio: ${opts.probe.durationSec.toFixed(0)}s total, ${opts.probe.sampleRate}Hz, ${opts.probe.channels}ch.

Critical rules:
- Return only the transcript. Do not add explanations, notes, commentary, or conclusions.
- Transcribe every audible spoken word. Do not summarize, paraphrase, or shorten.
- Do not clean up grammar. Preserve the original spoken style.
- Preserve filler words, hesitations, false starts, repetitions, interruptions, and unfinished sentences.
- Preserve numbers, names, dates, technical terms, and code-like words exactly as heard.
- If speech is unclear, write [unclear] instead of guessing.
- If multiple speakers are present, mark speaker changes as [Speaker 1], [Speaker 2], etc.
- Describe non-speech audio briefly in brackets: [door closes], [phone ringing], [music playing].
${hasOverlap ? `- This audio includes ~${opts.leadingOverlapSec.toFixed(0)}s leading and ~${opts.trailingOverlapSec.toFixed(0)}s trailing overlap with neighboring segments for context. Use overlap to understand context, but avoid duplicating boundary speech that clearly belongs to a neighboring segment.` : ""}
${opts.isFirstChunk ? "- This is the first segment. Identify the spoken language and speakers if possible." : ""}`;
}
