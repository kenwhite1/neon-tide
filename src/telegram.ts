// Telegram Mini App boilerplate with a mock mode for plain-browser dev.

export interface TgUser {
  id: string;
  name: string;
  username?: string;
}

class TelegramBridge {
  wa: any = null;
  isReal = false;
  user: TgUser = { id: 'dev', name: 'Captain Dev', username: 'dev_pilot' };
  startParam = '';

  init() {
    const wa = (window as any).Telegram?.WebApp;
    const url = new URL(location.href);
    this.startParam = url.searchParams.get('startapp') ?? url.searchParams.get('room') ?? '';

    if (wa && wa.initData && wa.initData.length > 0) {
      this.wa = wa;
      this.isReal = true;
      const u = wa.initDataUnsafe?.user;
      if (u) {
        this.user = {
          id: String(u.id),
          name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Captain',
          username: u.username,
        };
      }
      if (wa.initDataUnsafe?.start_param) this.startParam = wa.initDataUnsafe.start_param;

      try { wa.ready(); } catch {}
      try { wa.expand(); } catch {}
      try { wa.disableVerticalSwipes?.(); } catch {}
      try { wa.setHeaderColor?.('#05070d'); } catch {}
      try { wa.setBackgroundColor?.('#05070d'); } catch {}
      // Fullscreen is ideal for a game (Bot API 8.0+); fail quietly on old clients.
      try {
        if (parseFloat(wa.version ?? '0') >= 8 && !wa.isFullscreen) wa.requestFullscreen?.();
      } catch {}
      try { wa.lockOrientation?.(); } catch {}

      const applyInsets = () => {
        const c = wa.contentSafeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 };
        const s = wa.safeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 };
        const r = document.documentElement.style;
        r.setProperty('--sa-top', `${Math.max(c.top ?? 0, s.top ?? 0)}px`);
        r.setProperty('--sa-bottom', `${Math.max(c.bottom ?? 0, s.bottom ?? 0)}px`);
        r.setProperty('--sa-left', `${Math.max(c.left ?? 0, s.left ?? 0)}px`);
        r.setProperty('--sa-right', `${Math.max(c.right ?? 0, s.right ?? 0)}px`);
      };
      applyInsets();
      try {
        wa.onEvent?.('safeAreaChanged', applyInsets);
        wa.onEvent?.('contentSafeAreaChanged', applyInsets);
        wa.onEvent?.('fullscreenChanged', applyInsets);
      } catch {}
    } else {
      console.info('[tg] running in MOCK mode (plain browser)');
    }
  }

  onViewportChange(cb: () => void) {
    try { this.wa?.onEvent?.('viewportChanged', cb); } catch {}
  }

  haptic(kind: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error') {
    const h = this.wa?.HapticFeedback;
    if (!h) return;
    try {
      if (kind === 'success' || kind === 'warning' || kind === 'error') h.notificationOccurred(kind);
      else h.impactOccurred(kind);
    } catch {}
  }

  backButton(show: boolean, cb?: () => void) {
    const b = this.wa?.BackButton;
    if (!b) return;
    try {
      if (cb) b.onClick(cb);
      show ? b.show() : b.hide();
    } catch {}
  }

  /** Deep link that opens this mini app with a payload (room code or boat share). */
  appLink(param: string) {
    // Replace bot/app names after BotFather setup (see README).
    if (this.isReal) return `https://t.me/neon_tide_bot/play?startapp=${encodeURIComponent(param)}`;
    const u = new URL(location.href);
    u.searchParams.set('startapp', param);
    return u.toString();
  }

  share(param: string, text: string) {
    const link = this.appLink(param);
    if (this.isReal) {
      try {
        this.wa.openTelegramLink(
          `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`,
        );
        return;
      } catch {}
    }
    navigator.clipboard?.writeText(`${text}\n${link}`).catch(() => {});
  }
}

export const tg = new TelegramBridge();
