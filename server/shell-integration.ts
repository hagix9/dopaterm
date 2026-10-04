import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ShellIntegrationResult {
  env: Record<string, string>;
  /** シェル起動時の追加引数（bash の --rcfile 等） */
  args: string[];
  /** 実行中セッションの配色を更新するためのテーマファイルパス（precmd が毎プロンプト再読込する） */
  themeFile: string;
  cleanup: () => void;
}

export function setupShellIntegration(shellPath: string): ShellIntegrationResult {
  const isZsh = shellPath.includes('zsh');
  const isBash = shellPath.includes('bash');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dopaterm-sh-'));
  const themeFile = path.join(tmpDir, 'theme.sh');
  const cleanup = () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  };

  if (isZsh) {
    const zshenvContent = `
# Dopaterm ZSH Integration (Non-destructive)
if [[ -f "$HOME/.zshenv" ]]; then
  source "$HOME/.zshenv"
fi
`;
    const zshrcContent = `
# Dopaterm ZSH Integration (Non-destructive)
# 1. Source user original .zshrc if exists
if [[ -f "$HOME/.zshrc" ]]; then
  source "$HOME/.zshrc"
fi

# 2. Keep undecorated base PS1 so live theme updates can re-decorate cleanly
DOPATERM_BASE_PS1="\$PS1"

# 3. Apply Dopaterm colors (initial env + live theme file re-read each prompt)
dopaterm_apply_colors() {
  if [[ -r "\${DOPATERM_THEME_FILE:-}" ]]; then
    source "\$DOPATERM_THEME_FILE"
  fi
  if [[ -n "\${DOPATERM_INPUT_COLOR:-}" ]]; then
    zle_highlight=(\${zle_highlight:#default:*} "default:fg=\${DOPATERM_INPUT_COLOR}")
  fi
  if [[ -n "\${DOPATERM_PROMPT_COLOR:-}" ]]; then
    PS1="%F{\${DOPATERM_PROMPT_COLOR}}\${DOPATERM_BASE_PS1}%f"
  fi
}

# 4. Inject OSC 133 hooks
dopaterm_preexec() {
  printf '\\033]133;C;cmd=%s\\007' "$1"
}

dopaterm_precmd() {
  local last_status=\$?
  dopaterm_apply_colors
  printf '\\033]133;D;%d\\007' "\$last_status"
}

# 5. Instant-recolor widget: Ctrl-X Ctrl-R re-reads the theme file and
#    redraws the prompt in place (does not submit the line)
dopaterm_theme_refresh() {
  dopaterm_apply_colors
  zle reset-prompt
}
zle -N dopaterm_theme_refresh 2>/dev/null
bindkey '^X^R' dopaterm_theme_refresh 2>/dev/null

autoload -Uz add-zsh-hook 2>/dev/null
if typeset -f add-zsh-hook >/dev/null 2>&1; then
  add-zsh-hook preexec dopaterm_preexec
  add-zsh-hook precmd dopaterm_precmd
fi

dopaterm_apply_colors
`;
    fs.writeFileSync(path.join(tmpDir, '.zshenv'), zshenvContent, 'utf-8');
    fs.writeFileSync(path.join(tmpDir, '.zshrc'), zshrcContent, 'utf-8');

    return {
      env: {
        ...process.env,
        ZDOTDIR: tmpDir,
        DOPATERM_ACTIVE: '1',
        DOPATERM_THEME_FILE: themeFile,
      },
      args: [],
      themeFile,
      cleanup,
    };
  }

  if (isBash) {
    // bash: --rcfile で一時 rc を読ませる。
    // 実行開始は DEBUG トラップ（PROMPT_COMMAND 直前フラグで1コマンド1回に制限）、
    // 終了は PROMPT_COMMAND で検出する。PS0 は bash 4.4+ のため使用しない
    // （macOS 標準の bash 3.2 でも動作させるため）。
    const bashrcContent = `
# Dopaterm BASH Integration (Non-destructive)
# 1. Source user original .bashrc if exists
if [ -f "$HOME/.bashrc" ]; then
  source "$HOME/.bashrc"
fi

# 2. Keep undecorated base PS1 so live theme updates can re-decorate cleanly
__DOPATERM_BASE_PS1="$PS1"

# 3. Inject OSC 133 hooks + live theme colors (re-read each prompt)
__dopaterm_in_prompt=

__dopaterm_precmd() {
  local last_status=$?
  if [ -r "$DOPATERM_THEME_FILE" ]; then
    . "$DOPATERM_THEME_FILE"
    if [ -n "$DOPATERM_PROMPT_COLOR" ]; then
      PS1="\\[\\033[38;5;\${DOPATERM_PROMPT_COLOR}m\\]\${__DOPATERM_BASE_PS1}\\[\\033[0m\\]"
    fi
  fi
  printf '\\033]133;D;%d\\007' "$last_status"
  __dopaterm_in_prompt=1
}

__dopaterm_preexec() {
  if [ -n "$__dopaterm_in_prompt" ]; then
    __dopaterm_in_prompt=
    local cmd
    cmd="$(builtin history 1 | sed 's/^ *[0-9]* *//')"
    printf '\\033]133;C;cmd=%s\\007' "$cmd"
  fi
}

trap '__dopaterm_preexec' DEBUG
PROMPT_COMMAND='__dopaterm_precmd'

# 4. Initial prompt color decoration (live updates handled by __dopaterm_precmd)
if [ -n "$DOPATERM_PROMPT_COLOR" ]; then
  PS1="\\[\\033[38;5;\${DOPATERM_PROMPT_COLOR}m\\]\${__DOPATERM_BASE_PS1}\\[\\033[0m\\]"
fi
`;
    const rcPath = path.join(tmpDir, 'dopaterm-bashrc');
    fs.writeFileSync(rcPath, bashrcContent, 'utf-8');

    return {
      env: {
        ...process.env,
        DOPATERM_ACTIVE: '1',
        DOPATERM_THEME_FILE: themeFile,
      },
      args: ['--rcfile', rcPath],
      themeFile,
      cleanup,
    };
  }

  // Fallback for other shells: フックなし（OSC 133 は出力されず、
  // クライアント側でコマンド検出がサイレントに無効になる）
  return {
    env: {
      ...process.env,
      DOPATERM_ACTIVE: '1',
      DOPATERM_THEME_FILE: themeFile,
    },
    args: [],
    themeFile,
    cleanup,
  };
}
