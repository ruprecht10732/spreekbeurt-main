import { readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const projectRoot = process.cwd();
const publicDir = join(projectRoot, 'public');
const videoExtensions = new Set(['.mp4', '.mov', '.mkv', '.webm']);
const dryRun = process.argv.includes('--dry-run');
const maxWidthArg = process.argv.find((arg) => arg.startsWith('--max-width='));
const maxWidth = Number(maxWidthArg?.split('=')[1] ?? '1280');

function requireBinary(name) {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
  } catch {
    throw new Error(`${name} is required but not installed.`);
  }
}

function getVideoInfo(filePath) {
  const output = execFileSync(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-show_entries', 'format=duration,bit_rate',
      '-of', 'json',
      filePath,
    ],
    { encoding: 'utf8' },
  );

  const parsed = JSON.parse(output);
  const stream = parsed.streams?.[0] ?? {};
  const format = parsed.format ?? {};

  return {
    width: Number(stream.width ?? 0),
    height: Number(stream.height ?? 0),
    duration: Number(format.duration ?? 0),
    bitRate: Number(format.bit_rate ?? 0),
  };
}

function listVideos() {
  return readdirSync(publicDir)
    .filter((fileName) => videoExtensions.has(extname(fileName).toLowerCase()))
    .sort();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function optimizeVideo(fileName) {
  const sourcePath = join(publicDir, fileName);
  const tempPath = join(publicDir, `${fileName}.optimized.mp4`);
  const sourceStats = statSync(sourcePath);
  const sourceInfo = getVideoInfo(sourcePath);
  const needsResize = sourceInfo.width > maxWidth;
  const modeLabel = needsResize ? `resize to <= ${maxWidth}px wide` : 'keep current resolution';
  const videoFilter = needsResize
    ? `scale='min(${maxWidth},iw)':-2:flags=lanczos`
    : 'scale=iw:-2:flags=lanczos';

  const ffmpegArgs = [
    '-y',
    '-i', sourcePath,
    '-vf', videoFilter,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '28',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '128k',
    tempPath,
  ];

  console.log(`\n${fileName}`);
  console.log(`  source: ${formatBytes(sourceStats.size)} ${sourceInfo.width}x${sourceInfo.height}`);
  console.log(`  mode:   ${modeLabel}`);

  if (dryRun) {
    console.log(`  dry-run: ffmpeg ${ffmpegArgs.join(' ')}`);
    return;
  }

  execFileSync('ffmpeg', ffmpegArgs, { stdio: 'inherit' });

  const optimizedStats = statSync(tempPath);
  if (optimizedStats.size >= sourceStats.size) {
    rmSync(tempPath, { force: true });
    console.log(`  skipped: optimized file was not smaller`);
    return;
  }

  renameSync(tempPath, sourcePath);
  const saved = sourceStats.size - optimizedStats.size;
  console.log(`  saved:  ${formatBytes(saved)} -> new size ${formatBytes(optimizedStats.size)}`);
}

requireBinary('ffmpeg');
requireBinary('ffprobe');

const videos = listVideos();
if (videos.length === 0) {
  console.log('No videos found in public/.');
  process.exit(0);
}

console.log(`Found ${videos.length} video file(s) in public/.`);
for (const fileName of videos) {
  optimizeVideo(fileName);
}