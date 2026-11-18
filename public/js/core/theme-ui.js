'use strict';

// tema terang/gelap
function themeName() {
  const m = window.vpsTheme ? window.vpsTheme.get() : 'auto';
  return m === 'light' ? 'Terang' : (m === 'dark' ? 'Gelap' : 'Otomatis');
}
function themeIcon() {
  const m = window.vpsTheme ? window.vpsTheme.get() : 'auto';
  return m === 'light' ? 'light_mode' : (m === 'dark' ? 'dark_mode' : 'brightness_auto');
}
function themeSheet() {
  if (!window.vpsTheme) return;
  const cur = window.vpsTheme.get();
  const pick = m => () => window.vpsTheme.set(m);
  sheet('Tampilan', [
    { label: 'Otomatis', sub: 'ikut pengaturan HP', icon: 'brightness_auto', tick: cur === 'auto', fn: pick('auto') },
    { label: 'Terang', icon: 'light_mode', tick: cur === 'light', fn: pick('light') },
    { label: 'Gelap', icon: 'dark_mode', tick: cur === 'dark', fn: pick('dark') }
  ]);
}
