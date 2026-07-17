import { BLOCKS, ECON, QUESTS, SAVE_KEY } from '../config';
import { Emitter, type BlockKind, type Design, type Phase, type RunStats } from '../types';
import { hubWalletEnabled, hubBalance, hubSpend, hubEarn } from '../gg';

const DEFAULT_DESIGN: Design = (() => {
  const d: Design = [];
  for (let gx = -2; gx <= 1; gx++)
    for (let gz = -2; gz <= 1; gz++) d.push({ gx, gy: 0, gz, rot: 0, kind: 'wood' });
  d.push({ gx: 0, gy: 1, gz: -1, rot: 0, kind: 'seat' });
  return d;
})();

export class GameState extends Emitter {
  phase: Phase = 'boot';
  gold = ECON.startGold;
  inv: Partial<Record<BlockKind, number>> = {};
  design: Design = [];
  bestStage = 0;
  runCount = 0;
  questsDone = new Set<string>();
  waterfallFlag = false;
  firstClearDone = false;
  teamColor = 0;
  runGold = 0;

  // Запуск из хаба: баланс золота - это счёт G хаба (источник истины). Локальный
  // баланс из localStorage остаётся как временный fallback, если хаб недоступен.
  hub = false;
  // Стабильный id заплыва (ставит Sail при старте) + счётчик событий заработка -
  // вместе дают идемпотентный ключ `boat:<runId>:<n>` на каждое начисление G.
  runId = 'session';
  private spendSeq = 0;
  private earnSeq = 0;

  constructor() {
    super();
    this.hub = hubWalletEnabled();
    this.load();
    if (this.hub) void this.syncHubBalance();
  }

  /** Подтянуть настоящий баланс G из хаба и обновить HUD. */
  async syncHubBalance() {
    const bal = await hubBalance();
    if (bal == null) return; // хаб недоступен - живём на локальном балансе
    this.gold = bal;
    this.emit('gold', 0, 'hub-sync');
  }

  /** Списать G у хаба (идемпотентно) и сверить локальный баланс с ответом. */
  private pushHubSpend(amount: number, reason: string) {
    const key = `neontide-spend-${Date.now()}-${this.spendSeq++}`;
    void hubSpend(amount, reason, key, key).then((bal) => {
      if (bal == null) return; // хаб не ответил - остаёмся на оптимистичном балансе
      this.gold = bal;
      this.emit('gold', 0, 'hub-sync');
    });
  }

  /** Начислить G у хаба за игровое событие (идемпотентно) и сверить баланс. */
  private pushHubEarn(amount: number, reason: string) {
    const key = `boat:${this.runId}:${this.earnSeq++}`;
    void hubEarn(amount, reason, key, key).then((bal) => {
      if (bal == null) return; // хаб не ответил - остаёмся на оптимистичном балансе
      this.gold = bal;
      this.emit('gold', 0, 'hub-sync');
    });
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        this.gold = s.gold ?? ECON.startGold;
        this.inv = s.inv ?? {};
        this.design = s.design ?? DEFAULT_DESIGN;
        this.bestStage = s.best ?? 0;
        this.runCount = s.runs ?? 0;
        this.questsDone = new Set(s.quests ?? []);
        this.firstClearDone = !!s.firstClear;
        this.teamColor = s.color ?? 0;
        return;
      }
    } catch {}
    // fresh start: starter kit minus what the default raft already uses
    this.inv = { ...ECON.starter };
    this.design = DEFAULT_DESIGN.map((b) => ({ ...b }));
    for (const b of this.design) this.inv[b.kind] = Math.max(0, (this.inv[b.kind] ?? 0) - 1);
  }

  save() {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          gold: this.gold,
          inv: this.inv,
          design: this.design,
          best: this.bestStage,
          runs: this.runCount,
          quests: [...this.questsDone],
          firstClear: this.firstClearDone,
          color: this.teamColor,
        }),
      );
    } catch {}
  }

  setPhase(p: Phase) {
    this.phase = p;
    this.emit('phase', p);
  }

  award(n: number, reason?: string) {
    if (n <= 0) return;
    // Оптимистично показываем +n сразу, а хабу шлём идемпотентный ggEarn и
    // сверяем баланс по ответу (хаб может урезать по дневному потолку).
    this.gold += n;
    this.emit('gold', n, reason);
    this.save();
    if (this.hub) this.pushHubEarn(n, reason ?? 'run');
  }

  spend(n: number): boolean {
    if (this.gold < n) return false;
    // Оптимистично списываем локально (покупка блоков синхронна), а хабу шлём
    // идемпотентный ggSpend и сверяем баланс по ответу.
    this.gold -= n;
    this.emit('gold', -n);
    this.save();
    if (this.hub && n > 0) this.pushHubSpend(n, 'buy-block');
    return true;
  }

  owned(kind: BlockKind) {
    return this.inv[kind] ?? 0;
  }

  /** Buy one block into inventory. */
  buy(kind: BlockKind): boolean {
    if (!this.spend(BLOCKS[kind].cost)) return false;
    this.inv[kind] = (this.inv[kind] ?? 0) + 1;
    this.emit('inv');
    this.save();
    return true;
  }

  /** Consumes one from inventory when placed (buys automatically if none owned). */
  takeBlock(kind: BlockKind): boolean {
    if ((this.inv[kind] ?? 0) > 0) {
      this.inv[kind]!--;
      this.emit('inv');
      return true;
    }
    if (this.spend(BLOCKS[kind].cost)) return true; // direct buy-and-place
    return false;
  }

  refundBlock(kind: BlockKind) {
    this.inv[kind] = (this.inv[kind] ?? 0) + 1;
    this.emit('inv');
    this.save();
  }

  setDesign(d: Design) {
    this.design = d;
    this.save();
  }

  claimFirstClear(): number {
    if (this.firstClearDone) return 0;
    this.firstClearDone = true;
    this.save();
    return ECON.firstClear;
  }

  questCheck(id: string) {
    if (this.questsDone.has(id)) return;
    const q = QUESTS.find((q) => q.id === id);
    if (!q) return;
    this.questsDone.add(id);
    this.gold += q.gold;
    this.emit('gold', q.gold, 'quest');
    this.emit('quest', q);
    this.save();
    if (this.hub) this.pushHubEarn(q.gold, `quest:${id}`);
  }

  endRun(stats: RunStats, used: Set<BlockKind>) {
    this.runCount++;
    if (stats.stage > this.bestStage) this.bestStage = stats.stage;
    if (stats.stage >= 5) this.questCheck('stage5');
    if (this.waterfallFlag) this.questCheck('waterfall');
    if (stats.finished && [...used].every((k) => k === 'wood' || k === 'seat')) this.questCheck('woodrun');
    this.waterfallFlag = false;
    this.save();
    // Награда за заплыв начисляется хабом по ggReport - подтянем настоящий баланс.
    if (this.hub) void this.syncHubBalance();
  }
}
