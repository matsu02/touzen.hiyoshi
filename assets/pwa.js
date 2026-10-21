(() => {
  'use strict';
  const root = document.querySelector('[data-pwa-install]');
  const nativePanel = root?.querySelector('[data-pwa-native]');
  const button = root?.querySelector('[data-pwa-install-button]');
  const help = root?.querySelector('[data-pwa-install-help]');
  const status = root?.querySelector('[data-pwa-install-status]');
  const installedNote = root?.querySelector('[data-pwa-installed]');
  const iosGuide = root?.querySelector('[data-pwa-ios]');
  const androidGuide = root?.querySelector('[data-pwa-android]');
  const modes = ['standalone', 'fullscreen'].map(mode => window.matchMedia(`(display-mode: ${mode})`));
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(navigator.userAgent);
  let installed = false;
  let installPrompt = null;
  let prompting = false;

  const isInstalled = () => installed || navigator.standalone === true || modes.some(mode => mode.matches);
  const installedMessage = () => installed
    ? 'ホーム画面への追加が完了しました。次回からアイコンで開けます。'
    : 'ホーム画面から起動しています。追加方法もこちらで確認できます。';
  const showStatus = text => {
    if (!status) return;
    status.textContent = text;
    status.hidden = false;
  };
  const render = () => {
    const added = isInstalled();
    // An actual browser event, rather than the device name, enables native install.
    // Keep its panel in place while the browser awaits the visitor's decision.
    const useNative = !added && (Boolean(installPrompt) || prompting);
    if (root) root.hidden = false;
    if (nativePanel) nativePanel.hidden = !useNative;
    if (help) help.hidden = useNative;
    if (iosGuide) iosGuide.hidden = isAndroid;
    if (androidGuide) androidGuide.hidden = isIOS;
    if (button) {
      button.hidden = !useNative;
      button.disabled = prompting;
      button.textContent = 'アプリを追加する';
    }
    if (installedNote) {
      installedNote.hidden = !added;
      if (added) installedNote.textContent = installedMessage();
    } else if (added) showStatus(installedMessage());
  };
  const showManualFallback = message => {
    prompting = false;
    render();
    showStatus(isInstalled() ? installedMessage() : message);
    // Moving focus is reserved for a cancelled or failed user-initiated prompt.
    const target = isIOS ? iosGuide : isAndroid ? androidGuide : null;
    if (!isInstalled() && target && !target.hidden) target.focus();
  };
  render();
  for (const mode of modes) {
    if (mode.addEventListener) mode.addEventListener('change', render);
    else if (mode.addListener) mode.addListener(render);
  }
  window.addEventListener('pageshow', render);
  // Main pages without the guide also register the worker and receive this event.
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    if (status && !isInstalled()) status.hidden = true;
    render();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    installPrompt = null;
    showStatus(installedMessage());
    render();
  });
  button?.addEventListener('click', async () => {
    if (prompting || !installPrompt || isInstalled()) return;
    const prompt = installPrompt;
    installPrompt = null;
    prompting = true;
    if (status) status.hidden = true;
    render();
    try {
      // Call before the first await, while this click's user gesture is active.
      const result = await prompt.prompt();
      const choicePromise = prompt.userChoice;
      const choice = choicePromise ? await choicePromise : result;
      if (isInstalled()) showStatus(installedMessage());
      else if (choice?.outcome === 'accepted') {
        showStatus('操作を受け付けました。追加が完了するまで、ブラウザの案内をご確認ください。');
      } else {
        showManualFallback('以下の手順から、いつでもホーム画面に追加できます。');
      }
    } catch {
      showManualFallback('ブラウザのメニューから追加できます。以下の手順をご確認ください。');
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
