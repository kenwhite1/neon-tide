// Mobile-first sail controls: floating joystick + boost/jump buttons, plus
// desktop keys (A/D or arrows steer, W boost, Space jump).

export class Controls {
  root: HTMLElement;
  private thumb: HTMLElement;
  private base: HTMLElement;
  private boostBtn: HTMLButtonElement;
  private jumpBtn: HTMLButtonElement;
  private touchSteer = 0;
  private keys = new Set<string>();
  private joyPointer: number | null = null;
  private joyOrigin = { x: 0, y: 0 };

  onBoost: (() => void) | null = null;
  onJump: (() => void) | null = null;

  constructor(uiRoot: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'sail-controls';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div class="joy-zone">
        <div class="joy-base"><div class="joy-thumb"></div></div>
      </div>
      <div class="sail-btns">
        <button class="btn-jump" aria-label="jump">JUMP</button>
        <button class="btn-boost" aria-label="boost"><i class="ring"></i><span>BOOST</span></button>
      </div>`;
    uiRoot.appendChild(this.root);
    this.base = this.root.querySelector('.joy-base')!;
    this.thumb = this.root.querySelector('.joy-thumb')!;
    this.boostBtn = this.root.querySelector('.btn-boost')!;
    this.jumpBtn = this.root.querySelector('.btn-jump')!;

    const zone = this.root.querySelector('.joy-zone') as HTMLElement;
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.joyPointer = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('active');
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyPointer) return;
      const dx = e.clientX - this.joyOrigin.x;
      const dy = e.clientY - this.joyOrigin.y;
      const cl = Math.max(-52, Math.min(52, dx));
      const clY = Math.max(-52, Math.min(52, dy));
      this.thumb.style.transform = `translate(${cl}px, ${clY}px)`;
      this.touchSteer = Math.max(-1, Math.min(1, dx / 48));
    });
    const joyEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.joyPointer) return;
      this.joyPointer = null;
      this.touchSteer = 0;
      this.thumb.style.transform = 'translate(0,0)';
      this.base.classList.remove('active');
    };
    zone.addEventListener('pointerup', joyEnd);
    zone.addEventListener('pointercancel', joyEnd);

    this.boostBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onBoost?.();
    });
    this.jumpBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onJump?.();
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.onBoost?.();
      if (e.code === 'Space') {
        e.preventDefault();
        this.onJump?.();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  get steer(): number {
    if (this.touchSteer !== 0) return this.touchSteer;
    let s = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    return s;
  }

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  /** frac 0..1 remaining cooldown; active = burst currently firing. */
  setBoostState(frac: number, active: boolean, hasThrusters: boolean) {
    this.boostBtn.classList.toggle('firing', active);
    this.boostBtn.classList.toggle('ready', frac <= 0 && hasThrusters);
    this.boostBtn.classList.toggle('none', !hasThrusters);
    (this.boostBtn.querySelector('.ring') as HTMLElement).style.setProperty('--cd', `${(1 - frac) * 360}deg`);
  }
}
