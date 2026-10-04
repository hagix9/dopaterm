import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * SSH接続プロファイルの永続化。
 * 設計: 秘密鍵の内容・パスフレーズ・パスワードは一切保存しない。
 * 保存されるのは接続に必要なメタデータ（ホスト・ポート・ユーザー・鍵ファイルの「パス」のみ）。
 */

export type SshAuthMethod = 'agent' | 'keyfile' | 'password';

export interface SshProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  authMethod: SshAuthMethod;
  keyPath?: string;
  createdAt: number;
  updatedAt: number;
}

const CONFIG_DIR = path.join(os.homedir(), '.dopaterm');
const PROFILES_FILE = path.join(CONFIG_DIR, 'ssh-profiles.json');

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

export function loadProfiles(): SshProfile[] {
  try {
    if (!fs.existsSync(PROFILES_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf-8'));
    if (!Array.isArray(raw)) return [];
    return raw.filter((p): p is SshProfile =>
      p && typeof p.id === 'string' && typeof p.host === 'string' && typeof p.user === 'string');
  } catch {
    return [];
  }
}

function saveProfiles(profiles: SshProfile[]) {
  ensureDir();
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), { mode: 0o600 });
}

function sanitize(s: unknown, max = 256): string {
  return typeof s === 'string' ? s.slice(0, max).trim() : '';
}

/**
 * 入力バリデーション。シェル文字列連結はしないが、
 * プロファイル自体も安全側にバリデーションする（改行・制御文字の排除）。
 */
export function validateProfileInput(input: Record<string, unknown>, existingId?: string): { ok: true; profile: SshProfile } | { ok: false; error: string } {
  const name = sanitize(input.name);
  const host = sanitize(input.host);
  const user = sanitize(input.user);
  const port = Number(input.port);
  const authMethod = input.authMethod as SshAuthMethod;
  const keyPath = sanitize(input.keyPath, 1024);

  if (!name) return { ok: false, error: '接続名が必要です' };
  if (!host || /[\s\x00-\x1f]/.test(host)) return { ok: false, error: 'ホスト名が不正です' };
  if (!user || /[\s\x00-\x1f]/.test(user)) return { ok: false, error: 'ユーザー名が不正です' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'ポート番号が不正です' };
  if (!['agent', 'keyfile', 'password'].includes(authMethod)) return { ok: false, error: '認証方式が不正です' };
  if (authMethod === 'keyfile' && !keyPath) return { ok: false, error: '秘密鍵ファイルのパスが必要です' };

  const now = Date.now();
  const prev = existingId ? loadProfiles().find(p => p.id === existingId) : undefined;
  const profile: SshProfile = {
    id: existingId || crypto.randomBytes(8).toString('hex'),
    name, host, port, user, authMethod,
    ...(authMethod === 'keyfile' ? { keyPath } : {}),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  return { ok: true, profile };
}

export function upsertProfile(profile: SshProfile): SshProfile[] {
  const profiles = loadProfiles();
  const idx = profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) profiles[idx] = profile; else profiles.push(profile);
  saveProfiles(profiles);
  return profiles;
}

export function deleteProfile(id: string): SshProfile[] {
  const profiles = loadProfiles().filter(p => p.id !== id);
  saveProfiles(profiles);
  return profiles;
}

export function getProfile(id: string): SshProfile | undefined {
  return loadProfiles().find(p => p.id === id);
}

/**
 * OSC 5901;R を発行するリモートコマンドラッパー。
 * sshd はリモートコマンドを `$SHELL -c` で実行するため、マーカー発行は
 * 認証・接続完了が確定した後にだけ起こる（クライアント側の固定待機を不要にする）。
 * その後 `exec $SHELL -l` で通常のログインシェルへ置き換わる。
 * client/terminal/remote-osc133.ts の DOPA_MARKER_OSC と同期すること。
 */
const REMOTE_SHELL_WRAPPER = `printf '\\033]5901;R\\007' 2>/dev/null; exec "\${SHELL:-/bin/sh}" -l`;

/**
 * プロファイルから安全な引数配列を生成（シェル文字列連結なし）。
 * StrictHostKeyChecking はデフォルト(ask)のまま — 初回接続・鍵変更時の
 * 確認は OpenSSH 標準の対話プロンプトが PTY 内にそのまま表示される。
 * @param shellWrapper true の場合、OSC 5901;R マーカー付きラッパー経由で
 *   ログインシェルを起動する（エフェクトフック自動注入用）。リモート側が
 *   リモートコマンドを拒否する環境では false でプレーン接続にフォールバック。
 */
export function buildSshArgs(profile: SshProfile, shellWrapper = true): string[] {
  const args: string[] = [
    '-p', String(profile.port),
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
  ];
  if (profile.authMethod === 'keyfile' && profile.keyPath) {
    args.push('-i', profile.keyPath);
  }
  // BatchMode は付けない: パスフレーズ・パスワード・ホスト鍵確認の
  // 対話プロンプトをすべて PTY 内で処理させるため。
  if (shellWrapper) {
    // リモートコマンド指定時は PTY 割当が自動にならないため -t を付与。
    // オプションは destination の前に置く必要がある（後ろだとコマンド扱い）。
    args.push('-t');
  }
  args.push(`${profile.user}@${profile.host}`);
  if (shellWrapper) {
    args.push(REMOTE_SHELL_WRAPPER);
  }
  return args;
}
