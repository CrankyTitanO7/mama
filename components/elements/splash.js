/**
 * splash.js — Startup splash overlay shown while the app first loads.
 * Include on startup pages (index.html, setup.html) with:
 *   <script src="../components/elements/splash.js"></script>
 */

'use strict';

(function () {
  const overlay = document.createElement('div');
  overlay.id = 'splash-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--page-bg, #1a1a2e);
    transition: opacity 0.45s ease;
  `;

  const img = document.createElement('img');
  img.src = 'images/splash.png';
  img.alt = 'mama';
  img.style.cssText = `
    width: 280px;
    height: 280px;
    object-fit: contain;
    border-radius: 24px;
    filter: drop-shadow(0 18px 34px rgba(0, 0, 0, 0.35));
    animation: hero-float 2.5s ease-in-out infinite;
  `;

  overlay.appendChild(img);
  document.body.appendChild(overlay);

  function dismiss() {
    overlay.style.opacity = '0';
    setTimeout(() => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 500);
  }

  const MIN_DISPLAY_MS = 1100;

  if (document.readyState === 'complete') {
    setTimeout(dismiss, MIN_DISPLAY_MS);
  } else {
    window.addEventListener('load', () => setTimeout(dismiss, MIN_DISPLAY_MS));
  }
})();
