#!/usr/bin/env node
/**
 * 一個指令啟動開發環境：
 *   1. 沒有設定 DATABASE_URL 時，啟動 embedded-postgres（資料放在 .pg-data/）。
 *   2. 編譯核心模組、套用資料庫 migration、資料庫是空的就匯入 data/*.json。
 *   3. 同時啟動 API（http://localhost:3000）與前端（http://localhost:5173）。
 *
 * 參數：
 *   --reset-db   清空所有資料表並重新匯入 data/*.json
 *   --no-serve   只準備資料庫，不啟動 API 與前端
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const RESET = args.has('--reset-db');
const SERVE = !args.has('--no-serve');
const API_PORT = Number(process.env.API_PORT ?? 3000);
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);
const isWindows = process.platform === 'win32';
const npx = isWindows ? 'npx.cmd' : 'npx';
const npm = isWindows ? 'npm.cmd' : 'npm';

const COLORS = { db: 35, core: 36, api: 32, web: 34, dev: 33 };
function log(tag, message) {
  const prefix = `\x1b[${COLORS[tag] ?? 37}m[${tag}]\x1b[0m`;
  for (const line of String(message).split(/\r?\n/)) if (line.trim()) console.log(`${prefix} ${line}`);
}

/** 讀根目錄的 .env（只補上還沒設定的環境變數）。 */
function loadDotEnv() {
  const file = join(root, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

function run(tag, command, commandArgs, cwd = root) {
  log(tag, `$ ${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit', env: process.env, shell: isWindows });
  if (result.status !== 0) {
    log('dev', `指令失敗：${command} ${commandArgs.join(' ')}`);
    throw new Error('command failed');
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

let embedded = null;
let embeddedOwned = false;

async function startEmbeddedPostgres() {
  const require = createRequire(import.meta.url);
  const { default: EmbeddedPostgres } = await import(require.resolve('embedded-postgres'));
  const port = Number(process.env.EMBEDDED_PG_PORT ?? 54329);
  const dataDir = join(root, '.pg-data');
  // Postgres 不能用 root 執行，embedded-postgres 會改用 postgres 使用者；
  // 有些 Linux 環境沒有 en_US.UTF-8 語系，改用 C.UTF-8。
  const isRoot = !isWindows && userInfo().uid === 0;
  const initdbFlags = process.platform === 'linux' ? ['--locale=C.UTF-8', '--lc-messages=C.UTF-8', '--encoding=UTF8'] : ['--encoding=UTF8'];
  embedded = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
    createPostgresUser: isRoot,
    initdbFlags,
    onLog: () => {},
    onError: (err) => {
      if (!shuttingDown) log('db', String(err));
    },
  });

  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    log('db', '第一次啟動，初始化資料庫（.pg-data/）…');
    await embedded.initialise();
  }

  const pidFile = join(dataDir, 'postmaster.pid');
  const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8').split('\n')[0]) : NaN;
  if (Number.isFinite(pid) && isAlive(pid)) {
    log('db', `資料庫已在執行中（PID ${pid}），直接使用`);
  } else {
    if (existsSync(pidFile)) rmSync(pidFile);
    await embedded.start();
    embeddedOwned = true;
    log('db', `資料庫已啟動：localhost:${port}`);
  }
  try {
    await embedded.createDatabase('tanker');
    log('db', '已建立資料庫 tanker');
  } catch {
    // 資料庫已存在。
  }
  return `postgresql://postgres:postgres@localhost:${port}/tanker?schema=public`;
}

async function stopEmbeddedPostgres() {
  if (embedded && embeddedOwned) {
    log('db', '關閉資料庫…');
    await embedded.stop().catch(() => {});
    embeddedOwned = false;
  }
}

const children = [];
function serve(tag, command, commandArgs, cwd = root, extraEnv = {}) {
  const child = spawn(command, commandArgs, {
    cwd,
    env: { ...process.env, FORCE_COLOR: '1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  child.stdout.on('data', (chunk) => log(tag, chunk));
  child.stderr.on('data', (chunk) => log(tag, chunk));
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      log(tag, `程序結束（${signal ?? code}），關閉開發環境`);
      void shutdown(code ?? 1);
    }
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all(
    children
      .filter((child) => child.exitCode === null && child.signalCode === null)
      .map(
        (child) =>
          new Promise((resolve) => {
            child.once('exit', resolve);
            child.kill('SIGTERM');
            setTimeout(resolve, 5000);
          }),
      ),
  );
  await stopEmbeddedPostgres();
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

/** 本機沒有設定 Google 登入時改用開發模式；正式環境（Cloud Run）不能用開發模式，API 會拒絕啟動。 */
function prepareAuthEnv() {
  if (!process.env.GOOGLE_CLIENT_ID && !process.env.AUTH_MODE) {
    process.env.AUTH_MODE = 'dev';
    process.env.AUTH_BOOTSTRAP_EMAILS ??= 'dispatcher@example.com';
    log('dev', `沒有設定 GOOGLE_CLIENT_ID，使用開發模式登入（不經過 Google）：可用 ${process.env.AUTH_BOOTSTRAP_EMAILS} 登入`);
  }
  process.env.PUBLIC_URL ??= `http://localhost:${WEB_PORT}`;
  // 每次啟動產生新的密鑰：重新執行 npm run dev 後要重新登入。
  process.env.SESSION_SECRET ??= randomBytes(32).toString('hex');
}

async function main() {
  loadDotEnv();
  prepareAuthEnv();
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = await startEmbeddedPostgres();
  } else {
    log('db', '使用 DATABASE_URL 指定的資料庫');
  }

  const apiDir = join(root, 'apps/api');
  run('core', npm, ['run', 'build', '-w', '@tanker/core']);
  run('api', npx, ['prisma', 'generate'], apiDir);
  run('api', npx, ['prisma', 'migrate', 'deploy'], apiDir);
  // --reset-db：清空所有資料表後重新匯入 data/*.json。
  run('api', npx, ['tsx', 'prisma/seed.ts', ...(RESET ? ['--force'] : [])], apiDir);

  if (!SERVE) {
    await stopEmbeddedPostgres();
    return;
  }

  // 長時間執行的程序直接用 node 啟動（不經過 npx），結束時才能確實關閉。
  const require = createRequire(import.meta.url);
  const tsc = require.resolve('typescript/bin/tsc');
  const vitePkg = require.resolve('vite/package.json', { paths: [join(root, 'apps/web')] });
  const vite = join(dirname(vitePkg), JSON.parse(readFileSync(vitePkg, 'utf8')).bin.vite);
  serve('core', process.execPath, [tsc, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], join(root, 'packages/core'));
  // 等 API 第一次編譯完成才啟動，避免啟動後又因為重新輸出檔案而馬上重啟。
  const apiWatch = serve('api', process.execPath, [tsc, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], apiDir);
  let apiStarted = false;
  apiWatch.stdout.on('data', (chunk) => {
    if (apiStarted || !/Watching for file changes/.test(String(chunk))) return;
    apiStarted = true;
    serve('api', process.execPath, ['--watch', 'dist/main.js'], apiDir, { PORT: String(API_PORT) });
  });
  serve('web', process.execPath, [vite, '--port', String(WEB_PORT), '--strictPort', '--host'], join(root, 'apps/web'), { API_PORT: String(API_PORT) });
  log('dev', `開發環境啟動中：前端 http://localhost:${WEB_PORT}　API http://localhost:${API_PORT}/api（按 Ctrl+C 結束）`);
}

main().catch(async (err) => {
  if (err?.message !== 'command failed') console.error(err);
  await shutdown(1);
});
