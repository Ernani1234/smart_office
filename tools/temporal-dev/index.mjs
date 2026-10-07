// Sobe o Temporal dev server (CLI oficial) com SQLite persistente em .data/temporal.
// Baixa o binário do GitHub na primeira execução e guarda em .tools/.
// Se já houver algo ouvindo em 7233 (ex.: docker compose), não sobe outro.
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, readdirSync, statSync, renameSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = process.env.TEMPORAL_CLI_VERSION ?? '1.9.1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const toolsDir = path.join(root, '.tools');
const dataDir = path.join(root, '.data', 'temporal');
const isWin = process.platform === 'win32';
const exe = path.join(toolsDir, isWin ? 'temporal.exe' : 'temporal');
const port = Number(process.env.TEMPORAL_PORT ?? 7233);
const uiPort = Number(process.env.TEMPORAL_UI_PORT ?? 8233);

function log(msg) {
  console.log(`[temporal] ${msg}`);
}

function portInUse(p) {
  return new Promise((resolve) => {
    const sock = net.connect({ port: p, host: '127.0.0.1' });
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => resolve(false));
  });
}

function assetName() {
  const os = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!os || !arch) throw new Error(`Plataforma não suportada: ${process.platform}/${process.arch}`);
  const ext = isWin ? 'zip' : 'tar.gz';
  return `temporal_cli_${VERSION}_${os}_${arch}.${ext}`;
}

async function download() {
  mkdirSync(toolsDir, { recursive: true });
  const name = assetName();
  const url = `https://github.com/temporalio/cli/releases/download/v${VERSION}/${name}`;
  const archive = path.join(toolsDir, name);
  if (!existsSync(archive)) {
    log(`baixando ${url}`);
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`download falhou: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(archive + '.part'));
    renameSync(archive + '.part', archive);
  }
  const tmp = path.join(toolsDir, 'extract');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  execFileSync(tarBinary(), ['-xf', archive, '-C', tmp], { stdio: 'inherit' });
  const found = findBinary(tmp);
  if (!found) throw new Error('binário temporal não encontrado no pacote');
  renameSync(found, exe);
  rmSync(tmp, { recursive: true, force: true });
  rmSync(archive, { force: true });
  log(`instalado em ${path.relative(root, exe)}`);
}

// No Windows usamos o bsdtar do sistema (extrai .zip). O GNU tar do Git Bash
// interpretaria "C:" como host remoto.
function tarBinary() {
  if (!isWin) return 'tar';
  const systemTar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  return existsSync(systemTar) ? systemTar : 'tar';
}

function findBinary(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      const inner = findBinary(full);
      if (inner) return inner;
    } else if (entry === (isWin ? 'temporal.exe' : 'temporal')) {
      return full;
    }
  }
  return null;
}

async function main() {
  if (await portInUse(port)) {
    log(`porta ${port} já em uso — usando o Temporal que está rodando.`);
    setInterval(() => {}, 1 << 30);
    return;
  }
  if (!existsSync(exe)) await download();
  mkdirSync(dataDir, { recursive: true });
  const args = [
    'server',
    'start-dev',
    '--db-filename',
    path.join(dataDir, 'temporal.db'),
    '--port',
    String(port),
    '--ui-port',
    String(uiPort),
    '--log-level',
    'warn',
  ];
  log(`subindo dev server em localhost:${port} (UI http://localhost:${uiPort})`);
  const child = spawn(exe, args, { stdio: 'inherit' });
  const stop = () => child.kill('SIGINT');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error('[temporal]', err);
  process.exit(1);
});
