/**
 * Dopaterm イベント型定義
 */

export type SessionId = string;
export type ExecutionId = string;
export type CommandType = 'cp' | 'mkdir' | 'rm' | 'git' | 'cargo' | 'unknown';

export type FailureCategory =
  | 'typo'              // 127 / command not found
  | 'permission_denied' // 126 / permission denied
  | 'not_found'         // no such file or directory
  | 'build_failed'      // compilation/build error
  | 'generic_error';    // その他エラー

export type ComboRank =
  | 'normal'        // 1〜9回
  | 'combo'         // 10〜99回
  | 'fever'         // 100〜999回
  | 'hyper_dopa'    // 1,000〜9,999回
  | 'singularity';  // 10,000回以上

export type DisasterType =
  | 'file_explosion'    // rm でファイル爆発
  | 'meteor_collapse'   // 大量削除でビル倒壊・隕石
  | 'waterlogging'      // ディスク容量不足で水没
  | 'oom_monster'       // OOMで怪獣がプロセス捕食
  | 'game_over';        // サービス/コンテナ停止

export interface BaseEvent {
  timestamp: number;
  sessionId: SessionId;
}

export interface CommandCandidateEvent extends BaseEvent {
  type: 'command_candidate';
  command: CommandType;
  rawInput: string;
  args: string[];
}

export interface CommandStartedEvent extends BaseEvent {
  type: 'command_started';
  executionId: ExecutionId;
  command: CommandType;
  commandLine: string;
  attemptNumber: number;
}

export interface CommandFinishedEvent extends BaseEvent {
  type: 'command_finished';
  executionId: ExecutionId;
  command: CommandType;
  exitCode: number | null;
  failureCategory?: FailureCategory;
  /**
   * 直前のPTY出力末尾の抜粋（ANSI除去済み）。
   * 注意: PTY は stdout/stderr を単一ストリームに混在させるため、
   * これは厳密な stderr ではなく「直近の出力末尾」として扱う。
   */
  outputTail?: string;
  durationMs: number;
}

export interface ComboUpdatedEvent extends BaseEvent {
  type: 'combo_updated';
  command: CommandType;
  successCombo: number;
  failureCombo: number;
  totalAttempts: number;
  rank: ComboRank;
  multiplier: number;
}

export interface DisasterTriggeredEvent extends BaseEvent {
  type: 'disaster_triggered';
  disasterType: DisasterType;
  details: string;
}

export interface DemoSimulateEvent extends BaseEvent {
  type: 'demo_simulate';
  targetCombo: number;
  targetRank: ComboRank;
  simulateAction: 'success' | 'failure' | 'disaster' | 'mascot_pose';
  failureCategory?: FailureCategory;
  disasterType?: DisasterType;
  mascotPose?: string;
}

export interface SessionDisconnectedEvent extends BaseEvent {
  type: 'session_disconnected';
  reason: string;
}

export type DopatermEvent =
  | CommandCandidateEvent
  | CommandStartedEvent
  | CommandFinishedEvent
  | ComboUpdatedEvent
  | DisasterTriggeredEvent
  | DemoSimulateEvent
  | SessionDisconnectedEvent;
