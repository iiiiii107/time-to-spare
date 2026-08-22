/* Service worker registration and update handling.

   The offline cache is what makes the app work on a phone with no signal, but
   it also means an open tab keeps serving the copy it already has. Left to the
   default, a new version can take two refreshes to appear — which looks
   exactly like the deploy never happened.

   So: register manually, check for a new worker whenever the app is opened or
   comes back to the foreground, and reload once when a new one takes over. */

export function registerServiceWorker(base = '/') {
  if (!('serviceWorker' in navigator)) return;
  // No service worker is built in dev, so registering there just fetches
  // index.html and logs a MIME-type error.
  if (import.meta.env.DEV) return;

  // A first install also fires controllerchange. Only a *replacement* worker
  // means the page is showing stale code, so only that should reload.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register(`${base}sw.js`, {
        scope: base,
      });

      registration.update();
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) registration.update();
      });
    } catch (err) {
      // Offline support is a bonus; the app works fine without it.
      console.warn('Offline support unavailable.', err);
    }
  });
}
