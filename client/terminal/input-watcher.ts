import { CommandCandidateEvent } from '../types/events.js';
import { commandTypeFromName } from './command-utils.js';

export interface InputWatcherOptions {
  sessionId: string;
  onCandidate: (event: CommandCandidateEvent) => void;
  onCancel: () => void;
}

export class InputWatcher {
  private buffer = '';
  private options: InputWatcherOptions;
  /** CSI/SS3 シーケンス中フラグ（\x1b[A 等の矢印キー・ペースト制御を無視するため） */
  private inEscape = false;
  /** OSC シーケンス中フラグ（\x1b]...BEL または \x1b\\） */
  private inOsc = false;

  constructor(options: InputWatcherOptions) {
    this.options = options;
  }

  public handleInput(data: string) {
    for (let i = 0; i < data.length; i++) {
      const char = data[i];

      // OSC: BEL または ST (\x1b\\) で終了
      if (this.inOsc) {
        if (char === '\x07') {
          this.inOsc = false;
        } else if (char === '\x1b' && data[i + 1] === '\\') {
          i++;
          this.inOsc = false;
        }
        continue;
      }

      // CSI/SS3: final byte (0x40-0x7E) で終了
      if (this.inEscape) {
        const code = char.charCodeAt(0);
        if (code >= 0x40 && code <= 0x7e) {
          this.inEscape = false;
        }
        continue;
      }

      if (char === '\x1b') {
        const next = data[i + 1];
        if (next === '[' || next === 'O') {
          this.inEscape = true;
        } else if (next === ']') {
          this.inOsc = true;
        } else if (next !== undefined) {
          // \x1bX 形式の2文字シーケンス（ESCキー単体は next=undefined で \x1b のみ捨てる）
          i++;
        }
        continue;
      } else if (char === '\r' || char === '\n') {
        // Enter pressed
        this.evaluateBuffer();
        this.buffer = '';
      } else if (char === '\x7f' || char === '\b') {
        // Backspace
        this.buffer = this.buffer.slice(0, -1);
        this.evaluateBuffer();
      } else if (char === '\x03') {
        // Ctrl+C
        this.buffer = '';
        this.options.onCancel();
      } else if (char === '\x15') {
        // Ctrl+U (kill line)
        this.buffer = '';
        this.options.onCancel();
      } else if (char.charCodeAt(0) >= 32) {
        // Printable characters
        this.buffer += char;
        this.evaluateBuffer();
      }
    }
  }

  private evaluateBuffer() {
    const trimmed = this.buffer.trim();
    if (!trimmed) {
      this.options.onCancel();
      return;
    }

    const tokens = trimmed.split(/\s+/);
    const commandType = commandTypeFromName(tokens[0]);

    if (commandType !== 'unknown') {
      this.options.onCandidate({
        type: 'command_candidate',
        command: commandType,
        rawInput: trimmed,
        args: tokens.slice(1),
        timestamp: Date.now(),
        sessionId: this.options.sessionId,
      });
    } else {
      this.options.onCancel();
    }
  }

  public reset() {
    this.buffer = '';
    this.inEscape = false;
    this.inOsc = false;
  }
}
