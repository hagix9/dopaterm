/**
 * 接続ランチャー — 起動時の接続先選択と SSH プロファイル管理。
 * プロファイルの CRUD はバックエンド REST API（/api/ssh-profiles）経由。
 * 秘密鍵の内容・パスフレーズ・パスワードは一切送信・保存しない。
 */
import type { SessionManager, SshProfileInfo } from './session-manager.js';

interface LauncherDeps {
  sessionManager: SessionManager;
  token: string;
}

export class Launcher {
  private deps: LauncherDeps;
  private el: HTMLElement;
  private listEl: HTMLElement;
  private dialog: HTMLElement;
  private editingId: string | null = null;

  constructor(deps: LauncherDeps) {
    this.deps = deps;
    this.el = document.getElementById('launcher')!;
    this.listEl = document.getElementById('ssh-profile-list')!;
    this.dialog = document.getElementById('ssh-dialog')!;

    document.getElementById('launcher-local')!.addEventListener('click', () => {
      this.deps.sessionManager.createLocal();
      this.hide();
    });
    document.getElementById('launcher-new-ssh')!.addEventListener('click', () => this.openDialog(null));

    // 演出設定: 既存のデモリグ（設定ドロワー）のトグルを開く
    document.getElementById('launcher-fx')?.addEventListener('click', () => {
      document.getElementById('demo-rig-toggle')?.click();
    });

    // タイトル上部の電飾バルブ（装飾のみ）
    const bulbs = this.el.querySelector('.launcher-bulbs');
    if (bulbs) {
      for (let i = 0; i < 21; i++) {
        const b = document.createElement('span');
        b.style.setProperty('--i', String(i));
        bulbs.appendChild(b);
      }
    }

    // ダイアログ
    document.getElementById('ssh-cancel')!.addEventListener('click', () => this.closeDialog());
    document.getElementById('ssh-save')!.addEventListener('click', () => void this.saveDialog(false));
    document.getElementById('ssh-save-connect')!.addEventListener('click', () => void this.saveDialog(true));
    document.getElementById('ssh-auth')!.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      document.getElementById('ssh-keypath-row')!.classList.toggle('hidden', v !== 'keyfile');
    });

    // Electron preload があれば鍵ファイル選択ダイアログ・EXIT ボタンを有効化
    // （ブラウザ版では window.dopaterm が無いため両方とも非表示のまま）
    const dp = (window as any).dopaterm;
    if (dp?.quit) {
      const exitBtn = document.getElementById('launcher-exit')!;
      exitBtn.classList.remove('hidden');
      let quitting = false;
      exitBtn.addEventListener('click', () => {
        if (quitting) return;
        quitting = true;
        // 短い終了演出を出してから確実に quit する
        exitBtn.classList.add('exiting');
        this.el.classList.add('exiting');
        setTimeout(() => { void dp.quit(); }, 320);
        // IPC 失敗でも取り残さない安全策（成功時はプロセス終了で到達しない）
        setTimeout(() => { void dp.quit?.(); window.close(); }, 2000);
      });
    }
    if (dp?.pickFile) {
      const browseBtn = document.getElementById('ssh-keypath-browse')!;
      browseBtn.classList.remove('hidden');
      browseBtn.addEventListener('click', async () => {
        const p = await dp.pickFile();
        if (p) (document.getElementById('ssh-keypath') as HTMLInputElement).value = p;
      });
    }
  }

  private api(path: string, init?: RequestInit) {
    return fetch(`${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.deps.token)}`, init);
  }

  async refresh() {
    try {
      const res = await this.api('/api/ssh-profiles');
      const data = await res.json();
      this.renderList((data.profiles ?? []) as SshProfileInfo[]);
    } catch {
      this.listEl.innerHTML = '<div class="ssh-empty">接続先一覧の取得に失敗しました</div>';
    }
  }

  private renderList(profiles: SshProfileInfo[]) {
    this.listEl.innerHTML = '';
    if (profiles.length === 0) {
      this.listEl.innerHTML = '<div class="ssh-empty">登録済みの接続先はありません</div>';
      return;
    }
    for (const p of profiles) {
      const row = document.createElement('div');
      row.className = 'ssh-profile-row';
      const info = document.createElement('div');
      info.className = 'ssh-profile-info';
      info.innerHTML = `<div class="ssh-profile-name"></div><div class="ssh-profile-target"></div>`;
      (info.querySelector('.ssh-profile-name') as HTMLElement).textContent = p.name;
      (info.querySelector('.ssh-profile-target') as HTMLElement).textContent =
        `${p.user}@${p.host}:${p.port}` + (p.authMethod === 'keyfile' ? ' 🔑' : '');
      row.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'ssh-profile-actions';
      const connectBtn = document.createElement('button');
      connectBtn.className = 'btn-neon small';
      connectBtn.textContent = '接続';
      connectBtn.addEventListener('click', () => {
        this.deps.sessionManager.createSsh(p);
        this.hide();
      });
      const editBtn = document.createElement('button');
      editBtn.className = 'btn-neon small dim';
      editBtn.textContent = '編集';
      editBtn.addEventListener('click', () => this.openDialog(p));
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-neon small dim';
      delBtn.textContent = '削除';
      delBtn.addEventListener('click', async () => {
        if (!confirm(`接続先「${p.name}」を削除しますか？`)) return;
        await this.api(`/api/ssh-profiles/${p.id}`, { method: 'DELETE' });
        void this.refresh();
      });
      actions.append(connectBtn, editBtn, delBtn);
      row.appendChild(actions);
      this.listEl.appendChild(row);
    }
  }

  private openDialog(p: SshProfileInfo | null) {
    this.editingId = p?.id ?? null;
    (document.getElementById('ssh-name') as HTMLInputElement).value = p?.name ?? '';
    (document.getElementById('ssh-host') as HTMLInputElement).value = p?.host ?? '';
    (document.getElementById('ssh-port') as HTMLInputElement).value = String(p?.port ?? 22);
    (document.getElementById('ssh-user') as HTMLInputElement).value = p?.user ?? '';
    (document.getElementById('ssh-auth') as HTMLSelectElement).value = p?.authMethod ?? 'agent';
    (document.getElementById('ssh-keypath') as HTMLInputElement).value = p?.keyPath ?? '';
    document.getElementById('ssh-keypath-row')!.classList.toggle('hidden', (p?.authMethod ?? 'agent') !== 'keyfile');
    (document.getElementById('ssh-dialog-error') as HTMLElement).textContent = '';
    this.dialog.classList.remove('hidden');
  }

  private closeDialog() {
    this.dialog.classList.add('hidden');
  }

  private async saveDialog(connectAfter: boolean) {
    const errEl = document.getElementById('ssh-dialog-error') as HTMLElement;
    const body = {
      id: this.editingId ?? undefined,
      name: (document.getElementById('ssh-name') as HTMLInputElement).value,
      host: (document.getElementById('ssh-host') as HTMLInputElement).value,
      port: Number((document.getElementById('ssh-port') as HTMLInputElement).value),
      user: (document.getElementById('ssh-user') as HTMLInputElement).value,
      authMethod: (document.getElementById('ssh-auth') as HTMLSelectElement).value,
      keyPath: (document.getElementById('ssh-keypath') as HTMLInputElement).value || undefined,
    };
    try {
      const res = await this.api('/api/ssh-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error ?? '保存に失敗しました';
        return;
      }
      this.closeDialog();
      void this.refresh();
      if (connectAfter) {
        this.deps.sessionManager.createSsh(data.profile as SshProfileInfo);
        this.hide();
      }
    } catch {
      errEl.textContent = 'サーバーに接続できません';
    }
  }

  show() {
    this.el.classList.remove('hidden');
    void this.refresh();
  }

  hide() {
    this.el.classList.add('hidden');
  }
}
