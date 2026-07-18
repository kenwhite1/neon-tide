import { BLOCKS, PALETTE_ORDER, QUESTS, TEAM_COLORS, TIERS, tierOfStage } from '../config';
import type { BlockKind, RunStats } from '../types';
import type { GameState } from '../game/state';
import type { Sfx } from '../engine/audio';

export interface HudCallbacks {
  onLaunch: () => void;
  onSelect: (k: BlockKind) => void;
  onRotate: () => void;
  onDelete: (on: boolean) => void;
  onUndo: () => void;
  onClear: () => void;
  onColor: (idx: number) => void;
  onShareBoat: () => void;
}

const coin = `<i class="coin"></i>`;

export class Hud {
  private root: HTMLElement;
  private el = new Map<string, HTMLElement>();
  private cb!: HudCallbacks;
  onMpSlot: ((el: HTMLElement) => void) | null = null;
  private deleteOn = false;
  private goldShown = 0;
  private goldAnim = 0;

  constructor(uiRoot: HTMLElement, private state: GameState, private sfx: Sfx) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    uiRoot.appendChild(this.root);
  }

  private q(id: string) {
    return this.el.get(id)!;
  }

  mount(cb: HudCallbacks) {
    this.cb = cb;
    this.root.innerHTML = `
      <div class="topbar">
        <div class="chip gold-chip">${coin}<b id="gold-val">0</b></div>
        <div class="chip stage-chip" id="stage-chip">DOCK</div>
        <div class="hull-wrap" id="hull-wrap"><div class="hull-bar" id="hull-bar"></div></div>
        <div class="top-spacer"></div>
        <button class="icon-btn" id="quest-btn">!</button>
        <button class="icon-btn" id="help-btn">?</button>
        <button class="icon-btn" id="settings-btn">⚙</button>
      </div>
      <div id="quest-panel" class="panel hidden"></div>
      <div id="build-bar">
        <div class="palette" id="palette"></div>
        <div class="side-actions">
          <div class="row">
            <button class="round-btn" id="undo-btn" title="отменить">⟲</button>
            <button class="round-btn" id="rotate-btn" title="повернуть">⟳</button>
            <button class="round-btn" id="delete-btn" title="режим удаления">✕</button>
          </div>
          <button id="launch-btn">СТАРТ ▶</button>
        </div>
      </div>
      <div id="banner"></div>
      <div id="countdown"></div>
      <div id="toasts"></div>
      <div id="popup-layer"></div>
      <div id="modal-layer" class="hidden"></div>
    `;
    const ids = ['gold-val', 'stage-chip', 'hull-wrap', 'hull-bar', 'quest-btn', 'help-btn', 'settings-btn', 'quest-panel', 'build-bar', 'palette', 'undo-btn', 'rotate-btn', 'delete-btn', 'launch-btn', 'banner', 'countdown', 'toasts', 'popup-layer', 'modal-layer'];
    for (const id of ids) this.el.set(id, this.root.querySelector(`#${id}`)!);

    this.q('launch-btn').addEventListener('click', () => cb.onLaunch());
    this.q('rotate-btn').addEventListener('click', () => cb.onRotate());
    this.q('undo-btn').addEventListener('click', () => cb.onUndo());
    this.q('delete-btn').addEventListener('click', () => {
      this.deleteOn = !this.deleteOn;
      this.q('delete-btn').classList.toggle('danger', this.deleteOn);
      cb.onDelete(this.deleteOn);
      this.sfx.play('tap');
    });
    this.q('quest-btn').addEventListener('click', () => {
      this.refreshQuests();
      this.q('quest-panel').classList.toggle('hidden');
      this.sfx.play('tap');
    });
    this.q('help-btn').addEventListener('click', () => this.helpModal());
    this.q('settings-btn').addEventListener('click', () => this.settingsModal());

    this.state.on('gold', (delta: number) => {
      this.setGold(this.state.gold);
      if (delta > 0) this.bump(`+${delta}`, 'gold');
    });
    this.state.on('inv', () => this.refreshPalette());
    this.state.on('quest', (q: { label: string; gold: number }) => {
      this.toast(`✓ КВЕСТ - ${q.label} · +${q.gold} золота`);
      this.sfx.play('win');
    });

    this.goldShown = this.state.gold;
    this.q('gold-val').textContent = String(this.state.gold);
    this.refreshPalette();
    this.showBuild();
  }

  // ---------------- gold / stage / hull ----------------
  setGold(v: number) {
    this.goldAnim = v;
    const stepIt = () => {
      if (this.goldShown === this.goldAnim) return;
      const d = this.goldAnim - this.goldShown;
      this.goldShown += Math.sign(d) * Math.max(1, Math.ceil(Math.abs(d) / 8));
      this.q('gold-val').textContent = String(this.goldShown);
      requestAnimationFrame(stepIt);
    };
    requestAnimationFrame(stepIt);
  }

  bump(text: string, cls: string) {
    const b = document.createElement('div');
    b.className = `bump ${cls}`;
    b.textContent = text;
    this.q('popup-layer').appendChild(b);
    setTimeout(() => b.remove(), 1400);
  }

  setStage(n: number) {
    const chip = this.q('stage-chip');
    if (n <= 0) {
      chip.textContent = 'ПРИЧАЛ';
      chip.style.color = 'var(--accent)';
      chip.style.borderColor = 'color-mix(in srgb, var(--accent) 40%, transparent)';
      return;
    }
    const tier = TIERS[tierOfStage(n - 1)];
    chip.textContent = `ЭТАП ${n} · ${tier.name}`;
    chip.style.color = tier.css;
    chip.style.borderColor = tier.css + '66';
  }

  setHull(frac: number) {
    const bar = this.q('hull-bar');
    bar.style.width = `${Math.max(0, frac * 100)}%`;
    bar.style.background = frac > 0.55 ? 'linear-gradient(90deg,#93c178,#7fb069 60%,#5e8e4a)' : frac > 0.3 ? '#f2a93b' : '#e2574c';
  }

  // ---------------- popups ----------------
  stagePopup(n: number, gold: number) {
    const tier = TIERS[tierOfStage(n - 1)];
    const b = this.q('banner');
    b.innerHTML = `<div class="banner-stage" style="color:${tier.css}">ЭТАП ${n} - ${tier.name}</div><div class="banner-gold">+${gold} ${coin}</div>`;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  countdown(text: string) {
    const c = this.q('countdown');
    c.textContent = text;
    c.classList.remove('pop');
    void c.offsetWidth;
    c.classList.add('pop');
  }

  toast(msg: string) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    this.q('toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2300);
    setTimeout(() => t.remove(), 2700);
  }

  // ---------------- palette ----------------
  refreshPalette() {
    const pal = this.q('palette');
    pal.innerHTML = '';
    for (const kind of PALETTE_ORDER) {
      const def = BLOCKS[kind];
      const owned = this.state.owned(kind);
      const chip = document.createElement('button');
      chip.className = 'block-chip' + (kind === (this as any).selectedKind ? ' selected' : '');
      const colorHex = '#' + def.color.toString(16).padStart(6, '0');
      chip.innerHTML = `
        <span class="swatch" style="background:${colorHex}"></span>
        <span class="bl">${def.label}</span>
        <span class="badge">${owned > 0 ? '×' + owned : `<i class="coin s"></i>${def.cost}`}</span>`;
      chip.title = `${def.desc} - прочность ${def.hp}${owned > 0 ? '' : ` · стоит ${def.cost} золота`}`;
      chip.addEventListener('click', () => {
        (this as any).selectedKind = kind;
        this.deleteOn = false;
        this.q('delete-btn').classList.remove('danger');
        this.cb.onDelete(false);
        this.cb.onSelect(kind);
        this.refreshPalette();
        this.sfx.play('tap');
      });
      pal.appendChild(chip);
    }
  }

  // ---------------- phases ----------------
  showBuild() {
    this.q('build-bar').classList.remove('hidden');
    this.q('hull-wrap').classList.add('hidden');
    this.setStage(0);
  }

  showSail() {
    this.q('build-bar').classList.add('hidden');
    this.q('quest-panel').classList.add('hidden');
    this.q('hull-wrap').classList.remove('hidden');
  }

  // ---------------- quests ----------------
  refreshQuests() {
    const p = this.q('quest-panel');
    p.innerHTML = `<div class="panel-title">КВЕСТЫ</div>` + QUESTS.map((q) => {
      const done = this.state.questsDone.has(q.id);
      return `<div class="quest ${done ? 'done' : ''}"><span>${done ? '✓' : '○'} ${q.label}</span><span class="qg">+${q.gold} ${coin}</span></div>`;
    }).join('');
  }

  // ---------------- modals ----------------
  private modal(html: string, opts: { dismiss?: boolean } = { dismiss: true }): HTMLElement {
    const layer = this.q('modal-layer');
    layer.classList.remove('hidden');
    layer.innerHTML = `<div class="modal-backdrop"></div><div class="modal">${html}</div>`;
    if (opts.dismiss) {
      layer.querySelector('.modal-backdrop')!.addEventListener('click', () => this.closeModal());
    }
    return layer.querySelector('.modal')!;
  }

  closeModal() {
    const layer = this.q('modal-layer');
    layer.classList.add('hidden');
    layer.innerHTML = '';
  }

  summary(stats: RunStats, best: number, onRebuild: () => void) {
    const title = stats.finished ? '🏆 ЗАПЛЫВ ПРОЙДЕН!' : 'КРУШЕНИЕ';
    const m = this.modal(`
      <div class="modal-title ${stats.finished ? 'gold' : 'red'}">${title}</div>
      <div class="modal-sub">${stats.reason}</div>
      <div class="stat-rows">
        <div><span>Дошёл до этапа</span><b>${stats.stage} / 8${stats.finished ? ' + ФИНИШ' : ''}</b></div>
        <div><span>Золота получено</span><b class="gold">+${stats.goldEarned}</b></div>
        <div><span>Время заплыва</span><b>${stats.time.toFixed(1)}с</b></div>
        <div><span>Потеряно блоков</span><b>${stats.blocksLost}</b></div>
        <div><span>Лучший этап</span><b>${best}${best >= 8 ? ' 🏆' : ''}</b></div>
      </div>
      <button class="primary-btn" id="rebuild-btn">ПЕРЕСОБРАТЬ И ЗАПУСК</button>
    `, { dismiss: false });
    m.querySelector('#rebuild-btn')!.addEventListener('click', () => {
      this.closeModal();
      onRebuild();
    });
  }

  treasure(amount: number, onCollect: () => void) {
    const m = this.modal(`
      <div class="rays"></div>
      <div class="modal-title gold big">СОКРОВИЩЕ!</div>
      <div class="treasure-count" id="t-count">0</div>
      <div class="modal-sub">Сундук со скрипом открывается…</div>
      <button class="primary-btn gold-btn" id="collect-btn">ЗАБРАТЬ ${amount} ЗОЛОТА</button>
    `, { dismiss: false });
    const countEl = m.querySelector('#t-count') as HTMLElement;
    const t0 = performance.now();
    const tick = () => {
      const f = Math.min(1, (performance.now() - t0) / 1300);
      countEl.textContent = String(Math.round(amount * (1 - Math.pow(1 - f, 3))));
      if (f < 1) requestAnimationFrame(tick);
    };
    tick();
    m.querySelector('#collect-btn')!.addEventListener('click', () => {
      this.closeModal();
      onCollect();
    });
  }

  helpModal() {
    this.modal(`
      <div class="modal-title">КАК ИГРАТЬ</div>
      <div class="help-cols">
        <div>
          <b>СТРОЙКА</b>
          <p>Коснись, чтобы поставить блок. Веди пальцем - вращать камеру, щипок - зум. ✕ - режим удаления. ⟳ - поворот сидений и двигателей. Блоки стоят золота, при удалении оно возвращается.</p>
        </div>
        <div>
          <b>ЗАПЛЫВ</b>
          <p>Течение несёт тебя вперёд. Джойстик (или A/D) рулит, БУСТ включает двигатели (W), ПРЫЖОК подскакивает (пробел). Доберись до ФИНИША за сокровищем - золото копится за каждый этап, даже если разобьёшься.</p>
        </div>
      </div>
      <div class="modal-sub">Дерево плавает · металл и золото тонут без корпуса · шары поднимают · динамит - ужасная, чудесная идея.</div>
      <button class="primary-btn" id="ok-btn">ПОНЯТНО</button>
    `);
    this.q('modal-layer').querySelector('#ok-btn')!.addEventListener('click', () => this.closeModal());
  }

  settingsModal() {
    const m = this.modal(`
      <div class="modal-title">НАСТРОЙКИ</div>
      <div class="set-row"><span>Цвет команды</span><div class="swatches" id="swatches"></div></div>
      <div class="set-row"><span>Звук</span><button class="mini-btn" id="mute-btn">${this.sfx.muted ? 'ВЫКЛ' : 'ВКЛ'}</button></div>
      <div class="set-row"><span>Поделиться лодкой</span><button class="mini-btn" id="share-btn">ССЫЛКА</button></div>
      <div class="set-row"><span>Очистить участок</span><button class="mini-btn danger" id="clear-btn">ОЧИСТИТЬ</button></div>
      <div id="mp-slot"></div>
      <button class="primary-btn" id="ok-btn">ГОТОВО</button>
    `);
    const sw = m.querySelector('#swatches')!;
    TEAM_COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'swatch-btn' + (i === this.state.teamColor ? ' on' : '');
      b.style.background = '#' + c.toString(16).padStart(6, '0');
      b.addEventListener('click', () => {
        this.state.teamColor = i;
        this.state.save();
        this.cb.onColor(i);
        sw.querySelectorAll('.swatch-btn').forEach((x, j) => x.classList.toggle('on', j === i));
        this.sfx.play('tap');
      });
      sw.appendChild(b);
    });
    m.querySelector('#mute-btn')!.addEventListener('click', (e) => {
      this.sfx.setMuted(!this.sfx.muted);
      (e.target as HTMLElement).textContent = this.sfx.muted ? 'ВЫКЛ' : 'ВКЛ';
    });
    m.querySelector('#share-btn')!.addEventListener('click', () => {
      this.cb.onShareBoat();
      this.closeModal();
    });
    m.querySelector('#clear-btn')!.addEventListener('click', () => {
      this.cb.onClear();
      this.closeModal();
    });
    m.querySelector('#ok-btn')!.addEventListener('click', () => this.closeModal());
    this.onMpSlot?.(m.querySelector('#mp-slot') as HTMLElement);
    return m;
  }

  // ---------------- boot ----------------
  showBoot(onStart: () => void) {
    // lives in the ui root, not #hud - mount() rebuilds #hud's innerHTML later
    const b = document.createElement('div');
    b.id = 'boot';
    b.innerHTML = `
      <div class="boot-glow"></div>
      <div class="boot-title">КОРАБ<span>ЛИК</span></div>
      <div class="boot-sub">построй лодку · пройди пороги · забери золото</div>
      <button id="start-btn" disabled>ЗАГРУЗКА…</button>
      <div class="boot-hint">дерево плавает - золото нет. удачи, капитан.</div>
    `;
    this.root.parentElement!.appendChild(b);
    b.querySelector('#start-btn')!.addEventListener('click', () => {
      b.classList.add('out');
      setTimeout(() => b.remove(), 650);
      onStart();
    });
  }

  bootReady() {
    const btn = this.root.parentElement!.querySelector('#start-btn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'ОТПЛЫТЬ ▶';
    }
  }
}
