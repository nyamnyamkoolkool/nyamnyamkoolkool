// 냠냠쿨쿨 — Shared client behavior (theme, tabbar active, small interactions)

(function () {
  // ── Theme: respect saved preference, else system ──
  // Exception: when this screen is embedded inside an iframe (the design hub
  // previews each screen as a live thumbnail), force light theme so the hub
  // page stays calm regardless of system dark mode. This avoids the iframe
  // contents going black under prefers-color-scheme: dark.
  const KEY = 'nnk.theme';
  const inIframe = (function () { try { return window.self !== window.top; } catch (_e) { return true; } })();
  if (inIframe) {
    document.documentElement.classList.add('theme-light');
    document.documentElement.style.colorScheme = 'light';
  } else {
    const saved = localStorage.getItem(KEY); // 'light' | 'dark' | null
    if (saved === 'dark') document.documentElement.classList.add('theme-dark');
    if (saved === 'light') document.documentElement.classList.add('theme-light');
  }

  window.NNK = window.NNK || {};
  window.NNK.toggleTheme = function () {
    const root = document.documentElement;
    const current = root.classList.contains('theme-dark')
      ? 'dark'
      : root.classList.contains('theme-light')
        ? 'light'
        : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.classList.remove('theme-dark', 'theme-light');
    root.classList.add('theme-' + next);
    localStorage.setItem(KEY, next);
  };

  // ── Tabbar: set active by data-active matching ──
  document.addEventListener('DOMContentLoaded', () => {
    const active = document.body.getAttribute('data-active-tab');
    if (active) {
      document.querySelectorAll('[data-tab]').forEach((el) => {
        el.classList.toggle('active', el.getAttribute('data-tab') === active);
      });
    }

    // Back: prefer real browser history if there's any (covers hub→screen flow on
    // file:// and http://), otherwise jump to the declared fallback (handles
    // direct opens). history.length > 1 means we got here via navigation.
    document.querySelectorAll('[data-back]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const fallback = el.getAttribute('data-back') || '../index.html';
        if (history.length > 1) {
          history.back();
          return;
        }
        try {
          location.href = new URL(fallback, location.href).href;
        } catch (_err) {
          location.href = fallback;
        }
      });
    });
  });

  // ── Tiny: time-ago helper ──
  window.NNK.timeAgo = function (date) {
    const d = (typeof date === 'string') ? new Date(date) : date;
    const sec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (sec < 60) return '방금';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 ${min % 60}분 전`;
    const day = Math.floor(hr / 24);
    return `${day}일 전`;
  };
})();
