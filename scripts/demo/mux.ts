#!/usr/bin/env npx tsx
/**
 * Mux step of the demo pipeline (SPEC §6.7 ③).
 *
 * Takes the Playwright capture plus out/timeline.json, lays the `say` voice
 * track under it at the recorded offsets, and encodes H.264 + AAC at
 * 1280×720. Subtitles are already inside the capture (the page overlay), so
 * there is no text rendering here to go wrong on a machine without libass.
 *
 * Also pulls five still frames at named marks for the ticket's evidence and
 * asserts the AC-12 limits (< 179 s, ≥ 1280×720, H.264 + AAC).
 */
import ffmpegStatic from "ffmpeg-static";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG_PATH ?? (ffmpegStatic as unknown as string);

const MAX_SECONDS = 178;
const HARD_LIMIT = 179;

interface TimelineLine {
  index: number;
  role: string;
  text: string;
  audio: string | null;
  durationMs: number;
  startMs: number;
  endMs: number;
}

interface TimelineScene {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
}

interface TimelineMark {
  name: string;
  atMs: number;
}

interface Timeline {
  version: number;
  mode: "real" | "scripted";
  sample: boolean;
  clip: string;
  wallMs: number;
  lines: TimelineLine[];
  scenes: TimelineScene[];
  marks: TimelineMark[];
}

interface Probe {
  durationSec: number;
  video: { codec: string; width: number; height: number } | null;
  audio: { codec: string } | null;
  raw: string;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function run(command: string, args: string[], allowFailure = false): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const status = result.status ?? 1;
  if (status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return { status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function hasFfprobe(): boolean {
  return spawnSync("ffprobe", ["-version"], { encoding: "utf8" }).status === 0;
}

function probeWithFfprobe(file: string): Probe {
  const { stdout } = run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,width,height",
    "-of",
    "json",
    file,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  return {
    durationSec: Number.parseFloat(parsed.format?.duration ?? "0"),
    video: video
      ? { codec: video.codec_name ?? "?", width: video.width ?? 0, height: video.height ?? 0 }
      : null,
    audio: audio ? { codec: audio.codec_name ?? "?" } : null,
    raw: stdout,
  };
}

/** Fallback for a Mac without ffprobe: read the same facts out of `ffmpeg -i`. */
function probeWithFfmpeg(file: string): Probe {
  const { stderr } = run(FFMPEG, ["-hide_banner", "-i", file], true);
  const duration = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr);
  const video = /Stream #\d+:\d+.*?: Video: (\w+).*?(\d{2,5})x(\d{2,5})/.exec(stderr);
  const audio = /Stream #\d+:\d+.*?: Audio: (\w+)/.exec(stderr);
  return {
    durationSec: duration
      ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
      : 0,
    video: video ? { codec: video[1]!, width: Number(video[2]), height: Number(video[3]) } : null,
    audio: audio ? { codec: audio[1]! } : null,
    raw: stderr,
  };
}

function probe(file: string): Probe {
  return hasFfprobe() ? probeWithFfprobe(file) : probeWithFfmpeg(file);
}

function option(argv: string[], name: string): string | undefined {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function buildAudio(timeline: Timeline, totalSec: number, outFile: string): void {
  const lines = timeline.lines.filter((line) => line.audio && existsSync(line.audio));
  if (lines.length === 0) throw new Error("timeline has no voice clips");

  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const line of lines) args.push("-i", line.audio!);

  const filters: string[] = [];
  lines.forEach((line, index) => {
    const delay = Math.max(0, Math.round(line.startMs));
    filters.push(
      `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `adelay=${delay}|${delay}[a${index}]`,
    );
  });
  const mixInputs = lines.map((_, index) => `[a${index}]`).join("");
  filters.push(
    `${mixInputs}amix=inputs=${lines.length}:normalize=0:dropout_transition=0,` +
      `apad,atrim=0:${totalSec.toFixed(3)}[aout]`,
  );

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[aout]",
    "-c:a",
    "pcm_s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    outFile,
  );
  run(FFMPEG, args);
}

function encode(capture: string, audio: string, outFile: string, totalSec: number): void {
  run(FFMPEG, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    capture,
    "-i",
    audio,
    "-filter_complex",
    `[0:v]fps=30,scale=1280:720:flags=lanczos,tpad=stop_mode=clone:stop_duration=4,trim=0:${totalSec.toFixed(3)},setpts=PTS-STARTPTS[v]`,
    "-map",
    "[v]",
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-level",
    "4.0",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-t",
    totalSec.toFixed(3),
    "-movflags",
    "+faststart",
    outFile,
  ]);
}

interface Frame {
  name: string;
  atSec: number;
}

function chooseFrames(timeline: Timeline): Frame[] {
  const markAt = (name: string): number | undefined =>
    timeline.marks.find((mark) => mark.name === name)?.atMs;
  const sceneSpan = (id: string): number | undefined => {
    const scene = timeline.scenes.find((entry) => entry.id === id);
    if (!scene) return undefined;
    return (scene.startMs + scene.endMs) / 2;
  };

  const picks: Array<{ name: string; atMs: number | undefined }> = [
    // Elicitation card: mid-scene, after the message is on screen.
    { name: "01-oven-question", atMs: markAt("oven-question") ?? (sceneSpan("oven-question") ?? 30_000) },
    { name: "02-board-plan", atMs: markAt("board-plan") },
    { name: "03-new-session", atMs: markAt("new-session") },
    { name: "04-after-delay", atMs: markAt("after-delay") },
    { name: "05-board-tap", atMs: markAt("board-tap") },
  ];

  return picks
    .filter((pick): pick is { name: string; atMs: number } => typeof pick.atMs === "number")
    .map((pick) => ({ name: pick.name, atSec: Math.max(0, pick.atMs / 1000) }));
}

function main(): void {
  const args = process.argv.slice(2);
  const outFile = resolve(option(args, "out") ?? join(HERE, "out", "dinner-tower-demo.mp4"));
  const timelineFile = resolve(option(args, "timeline") ?? join(HERE, "out", "timeline.json"));
  const outDir = dirname(outFile);

  if (!existsSync(timelineFile)) throw new Error(`missing ${timelineFile} — run record.ts first`);
  const timeline = JSON.parse(readFileSync(timelineFile, "utf8")) as Timeline;
  if (!existsSync(timeline.clip)) throw new Error(`missing capture ${timeline.clip}`);

  const capture = probe(timeline.clip);
  const wallSec = timeline.wallMs / 1000;
  log(`capture ${capture.video?.width}×${capture.video?.height} ${capture.video?.codec}, ${capture.durationSec.toFixed(2)}s`);
  log(`wall clock ${wallSec.toFixed(2)}s`);

  // Playwright's screencast follows real time, but a slow machine can drop a
  // little; rescale the voice offsets so they stay glued to the picture.
  const ratio = capture.durationSec > 1 ? capture.durationSec / wallSec : 1;
  if (Math.abs(ratio - 1) > 0.005) {
    log(`rescaling voice offsets by ${ratio.toFixed(4)} to match the capture`);
    for (const line of timeline.lines) {
      line.startMs = Math.round(line.startMs * ratio);
      line.endMs = Math.round(line.endMs * ratio);
    }
  }

  const totalSec = Math.min(capture.durationSec, MAX_SECONDS);
  if (capture.durationSec > MAX_SECONDS + 1) {
    log(`WARNING: capture is ${capture.durationSec.toFixed(1)}s; trimming the tail to ${MAX_SECONDS}s`);
  }

  mkdirSync(outDir, { recursive: true });
  const audioFile = join(outDir, "audio-master.wav");
  buildAudio(timeline, totalSec, audioFile);
  log(`voice track: ${timeline.lines.filter((line) => line.audio).length} clips → ${audioFile}`);

  encode(timeline.clip, audioFile, outFile, totalSec);
  log(`encoded ${outFile}`);

  const framesDir = join(outDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  const frames = chooseFrames(timeline);
  for (const frame of frames) {
    const target = join(framesDir, `frame-${frame.name}.png`);
    const at = Math.min(frame.atSec, Math.max(0, totalSec - 0.4));
    run(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", outFile, "-ss", at.toFixed(2), "-frames:v", "1", target]);
    log(`frame ${target} @ ${at.toFixed(2)}s`);
  }

  const final = probe(outFile);
  const summary = [
    `file: ${outFile}`,
    `duration: ${final.durationSec.toFixed(3)} s`,
    `video: ${final.video?.codec} ${final.video?.width}x${final.video?.height}`,
    `audio: ${final.audio?.codec}`,
    `mode: ${timeline.mode}${timeline.sample ? " (SAMPLE — scripted LLM)" : ""}`,
  ];
  writeFileSync(join(outDir, "ffprobe.txt"), `${final.raw}\n`);
  log("");
  for (const line of summary) log(line);

  const problems: string[] = [];
  if (!(final.durationSec > 0 && final.durationSec < HARD_LIMIT)) {
    problems.push(`duration ${final.durationSec.toFixed(2)}s is not < ${HARD_LIMIT}s`);
  }
  if (!final.video || final.video.width < 1280 || final.video.height < 720) {
    problems.push(`video must be at least 1280x720, got ${final.video?.width}x${final.video?.height}`);
  }
  if (final.video?.codec !== "h264") problems.push(`video codec must be h264, got ${final.video?.codec}`);
  if (final.audio?.codec !== "aac") problems.push(`audio codec must be aac, got ${final.audio?.codec}`);
  if (frames.length < 5) problems.push(`only ${frames.length} frames were extracted (need 5)`);

  if (problems.length > 0) {
    for (const problem of problems) log(`FAIL ${problem}`);
    process.exitCode = 1;
    return;
  }
  log(`AC-12 checks: duration < ${HARD_LIMIT}s · ≥ 1280x720 · H.264 + AAC · ${frames.length} frames`);
}

try {
  main();
} catch (error) {
  log(`mux.ts failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
}
