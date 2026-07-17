// Tiny WebAudio synth - no assets, arcade-flavored blips and booms.

type SoundName =
  | 'tap' | 'place' | 'remove' | 'coin' | 'stage' | 'crack' | 'break' | 'explosion'
  | 'splash' | 'cannon' | 'jump' | 'win' | 'lose' | 'chest' | 'geyser' | 'launch' | 'deny';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private thrustNodes: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  muted = localStorage.getItem('neon-tide-mute') === '1';

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {}
  }

  setMuted(m: boolean) {
    this.muted = m;
    localStorage.setItem('neon-tide-mute', m ? '1' : '0');
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  private osc(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, when = 0) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, freq: number, gain: number, type: BiquadFilterType = 'lowpass', when = 0, freqEnd?: number) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  play(name: SoundName) {
    if (!this.ctx) return;
    switch (name) {
      case 'tap': this.osc('square', 240, 190, 0.05, 0.08); break;
      case 'place': this.osc('triangle', 340, 240, 0.08, 0.2); this.noise(0.04, 2400, 0.1, 'highpass'); break;
      case 'remove': this.osc('triangle', 200, 330, 0.08, 0.15); break;
      case 'deny': this.osc('square', 160, 110, 0.14, 0.14); break;
      case 'coin': this.osc('sine', 880, 880, 0.09, 0.16); this.osc('sine', 1320, 1320, 0.14, 0.14, 0.07); break;
      case 'stage': this.osc('sine', 523, 523, 0.18, 0.16); this.osc('sine', 784, 784, 0.24, 0.14, 0.09); this.noise(0.25, 5000, 0.05, 'highpass'); break;
      case 'crack': this.noise(0.09, 1600, 0.22, 'highpass'); break;
      case 'break': this.noise(0.22, 800, 0.3, 'lowpass', 0, 250); this.osc('sine', 120, 60, 0.18, 0.3); break;
      case 'explosion': this.noise(0.55, 400, 0.5, 'lowpass', 0, 90); this.osc('sine', 90, 38, 0.5, 0.5); break;
      case 'splash': this.noise(0.4, 1100, 0.3, 'bandpass', 0, 280); break;
      case 'cannon': this.noise(0.25, 600, 0.35, 'lowpass', 0, 150); this.osc('sine', 140, 70, 0.2, 0.3); break;
      case 'geyser': this.noise(0.5, 900, 0.2, 'bandpass', 0, 2400); break;
      case 'jump': this.osc('sine', 300, 520, 0.12, 0.18); break;
      case 'launch': this.osc('sawtooth', 90, 220, 0.7, 0.16); this.noise(0.8, 500, 0.18, 'lowpass', 0, 1400); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => this.osc('sine', f, f, 0.28, 0.18, i * 0.11)); break;
      case 'lose': this.osc('sawtooth', 280, 130, 0.5, 0.16); this.osc('sine', 140, 65, 0.6, 0.18, 0.05); break;
      case 'chest': this.osc('triangle', 180, 90, 0.4, 0.2); [660, 880, 1100, 1320].forEach((f, i) => this.osc('sine', f, f, 0.2, 0.1, 0.3 + i * 0.08)); break;
    }
  }

  thrustStart() {
    if (!this.ctx || !this.master || !this.noiseBuf || this.thrustNodes) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 950;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.22, this.ctx.currentTime + 0.08);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    this.thrustNodes = { src, gain: g };
  }

  thrustStop() {
    if (!this.ctx || !this.thrustNodes) return;
    const { src, gain } = this.thrustNodes;
    this.thrustNodes = null;
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.15);
    src.stop(this.ctx.currentTime + 0.2);
  }
}
