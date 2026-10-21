(() => {
  'use strict';
  const root = document.querySelector('[data-pwa-install]');
  if (!root) return;
  const button = root.querySelector('[data-pwa-install-button]');
  const help = root.querySelector('[data-pwa-install-help]');
  const status = root.querySelector('[data-pwa-install-status]');
  const iosGuide = root.querySelector('[data-pwa-ios]');
  const androidGuide = root.querySelector('[data-pwa-android]');
  const modes = ['standalone', 'fullscreen'].map(mode => window.matchMedia(`(display-mode: ${mode})`));
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(navigator.userAgent);
  let installed = false;
  let installPrompt = null;
  let prompting = false;

  const render = () => {
    root.hidden = installed || navigator.standalone === true || modes.some(mode => mode.matches);
    button.hidden = root.hidden || !installPrompt;
    button.disabled = prompting;
  };
  iosGuide.hidden = isAndroid;
  androidGuide.hidden = isIOS;
  // QR readers open a browser first. Show the relevant manual steps immediately.
  help.open = isIOS || isAndroid;
  render();
  for (const mode of modes) {
    if (mode.addEventListener) mode.addEventListener('change', render);
    else if (mode.addListener) mode.addListener(render);
  }
  window.addEventListener('pageshow', render);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    render();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    installPrompt = null;
    render();
  });
  button.addEventListener('click', async () => {
    if (!installPrompt || prompting || root.hidden) return;
    const prompt = installPrompt;
    installPrompt = null;
    prompting = true;
    status.hidden = true;
    render();
    try {
      // Calling prompt directly from this click keeps the required user gesture.
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      help.open = true;
      status.textContent = 'ブラウザのメニューから、ホーム画面に追加してください。';
      status.hidden = false;
    } finally {
      prompting = false;
      render();
    }
  });

  if ('serviceWorker' in navigator && ['https:', 'http:'].includes(window.location.protocol)) {
    const register = () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }
})();
