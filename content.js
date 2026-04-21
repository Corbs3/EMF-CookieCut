/**
 * Cookie Rejector — Content Script
 *
 * Improvements:
 *  1. IAB TCF API — direct consent signal, no UI needed
 *  2. Shadow DOM traversal — finds buttons inside shadow roots
 *  3. Site-specific hardcoded selectors — BBC, Guardian, F1, etc.
 *  4. aria-label / data-attribute detection — buttons with no visible text
 *  5. SPA navigation handling — re-runs on pushState/replaceState
 *  6. All frames support — handles iframe-based banners (set in manifest)
 */

(function () {
  'use strict';

  // ─── Config ───────────────────────────────────────────────────────────────

  const MAX_ATTEMPTS = 10;
  const RETRY_DELAY_MS = 700;
  let attempts = 0;
  let declined = false;
  let twoStepAttempted = false;

  // ─── 1. IAB TCF API ───────────────────────────────────────────────────────

  function tryTCFAPI() {
    if (typeof window.__tcfapi !== 'function') return;
    try {
      window.__tcfapi('getTCData', 2, (tcData, success) => {
        if (!success) return;
        window.__tcfapi('postCustomConsent', 2, (data, ok) => {
          if (ok) {
            declined = true;
            reportSuccess('IAB TCF', window.location.hostname);
          }
        }, {
          tcString: tcData.tcString,
          purposeOneTreatment: false,
          purpose: { consents: {}, legitimateInterests: {} },
          vendor: { consents: {}, legitimateInterests: {} },
          specialFeatureOptins: {}
        });
      });
      if (typeof window.__cmp === 'function') {
        window.__cmp('setConsentData', { consentData: '' }, () => {});
      }
    } catch (e) {}
  }

  // ─── 2. Shadow DOM Traversal ──────────────────────────────────────────────

  function queryShadowAll(selector, root = document) {
    const results = [];
    function walk(node) {
      try {
        results.push(...node.querySelectorAll(selector));
        for (const el of node.querySelectorAll('*')) {
          if (el.shadowRoot) walk(el.shadowRoot);
        }
      } catch (e) {}
    }
    walk(root);
    return results;
  }

  function queryAllButtons() {
    const selector = 'button, a[role="button"], [type="button"], [role="button"]';
    return [...new Set([
      ...document.querySelectorAll(selector),
      ...queryShadowAll(selector),
    ])];
  }

  // ─── 3. Site-Specific Rules ───────────────────────────────────────────────

  const SITE_RULES = [
    {
      match: /bbc\.(co\.uk|com)/i,
      selector: '[data-testid="reject-all"]',
      fallbackText: /reject additional cookies/i,
    },
    {
      match: /theguardian\.com/i,
      selector: '[data-link-name="reject all"]',
      fallbackText: /reject all/i,
    },
    {
      match: /formula1\.com/i,
      selector: null,
      fallbackText: /essential only cookies/i,
    },
    {
      match: /google\.(com|co\.uk|fr|de|es|it|nl|pl|pt|com\.au|com\.br)/i,
      selector: '#W0wltc, [aria-label*="Reject all" i]',
      fallbackText: /reject all/i,
    },
    {
      match: /youtube\.com/i,
      selector: '[aria-label*="Reject all" i]',
      fallbackText: /reject all/i,
    },
    {
      match: /reddit\.com/i,
      selector: '[data-testid="reject-nonessential-button"]',
      fallbackText: /reject non-essential/i,
    },
    {
      match: /cnn\.com/i,
      selector: '.banner__reject, [data-analytics="reject-cookies"]',
      fallbackText: /reject all/i,
    },
    {
      match: /independent\.co\.uk/i,
      selector: null,
      fallbackText: /reject all/i,
    },
    {
      match: /dailymail\.co\.uk/i,
      selector: null,
      fallbackText: /reject all|necessary only/i,
    },
    {
      match: /msn\.com/i,
      selector: null,
      fallbackText: /reject all|decline/i,
    },
    {
      match: /microsoft\.com/i,
      selector: '#cookie-banner-decline',
      fallbackText: /reject|decline/i,
    },
  ];

  function trySiteSpecific() {
    const host = window.location.hostname;
    for (const rule of SITE_RULES) {
      if (!rule.match.test(host)) continue;
      if (rule.selector) {
        const el = document.querySelector(rule.selector) || queryShadowAll(rule.selector)[0];
        if (el && isVisible(el)) {
          el.scrollIntoView({ block: 'nearest' });
          el.click();
          return true;
        }
      }
      if (rule.fallbackText) {
        const match = queryAllButtons().find(b =>
          rule.fallbackText.test(b.textContent.trim()) && isVisible(b)
        );
        if (match) {
          match.scrollIntoView({ block: 'nearest' });
          match.click();
          return true;
        }
      }
    }
    return false;
  }

  // ─── CMP Handlers ─────────────────────────────────────────────────────────

  const CMP_HANDLERS = [
    {
      name: 'OneTrust',
      detect: () => !!(document.getElementById('onetrust-banner-sdk') || window.OneTrust),
      decline: () => {
        if (window.OneTrust && typeof window.OneTrust.RejectAll === 'function') {
          window.OneTrust.RejectAll(); return true;
        }
        const btn = document.getElementById('onetrust-reject-all-handler')
          || queryShadowAll('#onetrust-reject-all-handler')[0];
        if (btn) { btn.click(); return true; }
        const settingsBtn = document.getElementById('onetrust-pc-btn-handler');
        if (settingsBtn) {
          settingsBtn.click();
          setTimeout(() => {
            const r = document.querySelector('.ot-pc-refuse-all-handler');
            if (r) r.click();
            else { const s = document.querySelector('.save-preference-btn-handler'); if (s) s.click(); }
          }, 600);
          return true;
        }
        return false;
      }
    },
    {
      name: 'CookieBot',
      detect: () => !!(window.Cookiebot || document.getElementById('CybotCookiebotDialog')),
      decline: () => {
        if (window.Cookiebot?.withdraw) { window.Cookiebot.withdraw(); return true; }
        if (window.Cookiebot?.deny) { window.Cookiebot.deny(); return true; }
        const btn = document.getElementById('CybotCookiebotDialogBodyButtonDecline')
          || queryShadowAll('#CybotCookiebotDialogBodyButtonDecline')[0];
        if (btn) { btn.click(); return true; }
        return false;
      }
    },
    {
      name: 'TrustArc',
      detect: () => !!(document.querySelector('#truste-consent-button') || window.truste),
      decline: () => {
        const req = document.querySelector('#truste-consent-required');
        if (req) { req.click(); return true; }
        const show = document.querySelector('#truste-show-consent');
        if (show) {
          show.click();
          setTimeout(() => { const r = document.querySelector('#truste-consent-required'); if (r) r.click(); }, 400);
          return true;
        }
        return false;
      }
    },
    {
      name: 'Quantcast',
      detect: () => !!document.querySelector('.qc-cmp2-container, [id^="qc-cmp2"]'),
      decline: () => {
        const btn = Array.from(document.querySelectorAll('.qc-cmp2-summary-buttons button'))
          .find(b => /reject|decline/i.test(b.textContent));
        if (btn) { btn.scrollIntoView({ block: 'nearest' }); btn.click(); return true; }
        const sec = document.querySelector('[mode="secondary"]');
        if (sec?.closest('.qc-cmp2-container')) { sec.click(); return true; }
        return false;
      }
    },
    {
      name: 'Didomi',
      detect: () => !!(window.Didomi || document.getElementById('didomi-popup')),
      decline: () => {
        if (window.Didomi?.disagreeToAll) { window.Didomi.disagreeToAll(); return true; }
        const btn = document.querySelector('#didomi-notice-disagree-button, [data-didomi-action="reject"]')
          || queryShadowAll('#didomi-notice-disagree-button')[0];
        if (btn) { btn.click(); return true; }
        return false;
      }
    },
    {
      name: 'Osano',
      detect: () => !!(window.Osano || document.querySelector('.osano-cm-dialog')),
      decline: () => {
        if (window.Osano?.cm?.deny) { window.Osano.cm.deny('ALL'); return true; }
        const btn = document.querySelector('.osano-cm-denyAll, .osano-cm-deny');
        if (btn) { btn.click(); return true; }
        return false;
      }
    },
    {
      name: 'Usercentrics',
      detect: () => !!(window.usercentrics || document.querySelector('[data-testid="uc-default-deny-all-button"]')),
      decline: () => {
        const btn = document.querySelector('[data-testid="uc-default-deny-all-button"]')
          || queryShadowAll('[data-testid="uc-default-deny-all-button"]')[0];
        if (btn) { btn.click(); return true; }
        return false;
      }
    },
    {
      name: 'CookieYes',
      detect: () => !!document.querySelector('.cky-consent-container, [id^="cky-"]'),
      decline: () => {
        const btn = document.querySelector('.cky-btn-reject') || queryShadowAll('.cky-btn-reject')[0];
        if (btn) { btn.click(); return true; }
        return false;
      }
    },
    {
      name: 'iubenda',
      detect: () => !!document.querySelector('#iubenda-cs-banner, .iubenda-cs-content'),
      decline: () => {
        const btn = document.querySelector('.iubenda-cs-reject-btn, [class*="iubenda"][class*="reject"]');
        if (btn) { btn.click(); return true; }
        return false;
      }
    },
  ];

  // ─── 4. aria-label / data-attribute Detection ─────────────────────────────

  const ARIA_REJECT_PATTERNS = [
    /reject/i, /decline/i, /deny/i, /refuse/i,
    /necessary only/i, /essential only/i, /opt.?out/i,
  ];

  function findByAriaOrData() {
    for (const btn of queryAllButtons()) {
      const combined = [
        btn.getAttribute('aria-label'),
        btn.getAttribute('data-action'),
        btn.getAttribute('data-analytics'),
        btn.getAttribute('data-track'),
        btn.getAttribute('title'),
      ].filter(Boolean).join(' ');
      if (ARIA_REJECT_PATTERNS.some(p => p.test(combined)) && isInsideCookieBanner(btn) && isVisible(btn)) {
        btn.scrollIntoView({ block: 'nearest' });
        btn.click();
        return true;
      }
    }
    return false;
  }

  // ─── Generic Text Matching ────────────────────────────────────────────────

  const DECLINE_PATTERNS = [
    /^(reject|decline|deny)\s+all(\s+cookies)?$/i,
    /^reject\s+(additional|optional|non-essential|tracking|analytics|advertising|marketing)(\s+cookies?)?$/i,
    /^reject$/i,
    /^decline$/i,
    /^deny$/i,
    /^refuse$/i,
    /^disagree$/i,
    /^reject\s+(cookies?|tracking(\s+cookies?)?|advertising(\s+cookies?)?)$/i,
    /^reject(\s+all)?\s+(and\s+)?(close|continue|proceed|save|confirm)$/i,
    /^reject\s+&\s+(close|continue|proceed|save|confirm)$/i,
    /^i\s+reject(\s+all)?(\s+cookies?)?$/i,
    /^reject\s+all\s+(and\s+)?(close|continue|proceed|save|confirm|exit)$/i,
    /^(use\s+)?only\s+(necessary|essential|required)\s+cookies?$/i,
    /^(necessary|essential|required)\s+cookies?\s+only$/i,
    /^(necessary|essential|required)\s+only\s+cookies?$/i,
    /^(accept\s+)?(only\s+)?(necessary|essential|required)\s+only$/i,
    /^allow\s+(only\s+)?(necessary|essential|required)(\s+cookies?)?$/i,
    /^(only\s+)?allow\s+(necessary|essential|required)(\s+cookies?)?$/i,
    /^no,?\s+thanks?$/i,
    /^no,?\s+thank\s+you$/i,
    /^no\s+thanks?$/i,
    /^i\s+(don'?t|do\s+not)\s+(accept|agree|consent)$/i,
    /^do\s+not\s+(accept|consent|agree)$/i,
    /^no,?\s+i\s+(decline|refuse|disagree|don'?t\s+accept)$/i,
    /^continue\s+without\s+(accepting|agreeing|consenting|cookies?)$/i,
    /^proceed\s+without\s+(accepting|agreeing|consenting|cookies?)$/i,
    /^browse\s+without\s+(accepting|agreeing|consenting|cookies?)$/i,
    /^(use\s+site|continue\s+to\s+site)\s+without\s+(accepting|cookies?)$/i,
    /^opt[\s-]out(\s+of\s+(all\s+)?cookies?)?$/i,
    /^not\s+now$/i,
    /^skip$/i,
    /^skip\s+(all\s+)?cookies?$/i,
    /^(reject|decline|deny)\s+(all\s+)?non[\s-]essential(\s+cookies?)?$/i,
    /^i\s+(disagree|refuse|decline|reject)$/i,
    /^withdraw(\s+consent)?$/i,
    /^revoke(\s+consent)?$/i,
  ];

  function isDeclineButton(el) {
    return DECLINE_PATTERNS.some(p => p.test(el.textContent.trim()));
  }

  function isInsideCookieBanner(el) {
    const sels = [
      '[class*="cookie"]','[id*="cookie"]','[class*="consent"]','[id*="consent"]',
      '[class*="gdpr"]','[id*="gdpr"]','[class*="privacy"]','[id*="privacy"]',
      '[class*="banner"]','[id*="banner"]','[role="dialog"]',
      '[aria-label*="cookie" i]','[aria-label*="consent" i]','[aria-label*="privacy" i]',
    ];
    return sels.some(s => { try { return !!el.closest(s); } catch { return false; } });
  }

  function isVisible(el) {
    try {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    } catch { return false; }
  }

  function tryGenericDecline() {
    const btns = queryAllButtons();
    for (const btn of btns) {
      if (isDeclineButton(btn) && isInsideCookieBanner(btn)) {
        btn.scrollIntoView({ block: 'nearest' }); btn.click(); return true;
      }
    }
    for (const btn of btns) {
      if (isDeclineButton(btn) && isVisible(btn)) {
        btn.scrollIntoView({ block: 'nearest' }); btn.click(); return true;
      }
    }
    return false;
  }

  // ─── Two-step: Customize → Reject ────────────────────────────────────────

  const CUSTOMIZE_PATTERNS = [
    /^customi[sz]e(\s+preferences)?$/i,
    /^manage(\s+preferences|\s+cookies|\s+settings)?$/i,
    /^(cookie\s+)?settings$/i,
    /^preferences$/i,
    /^more\s+options$/i,
    /^let\s+me\s+choose$/i,
    /^no,?\s+manage\s+settings$/i,
  ];

  const PANEL_REJECT_PATTERNS = [
    /reject all/i, /decline all/i, /deny all/i,
    /only (necessary|essential|required)/i, /necessary only/i,
    /refuse all/i, /save (my\s+)?(preferences|settings)/i,
    /confirm (my\s+)?(choices|selection)/i,
  ];

  function tryUnchecKAllToggles(container) {
    const nonEssential = /analytic|marketing|advertis|social|target|personaliz|statistic|track/i;
    for (const toggle of (container || document).querySelectorAll('input[type="checkbox"], input[type="radio"]')) {
      const label = toggle.closest('label') || document.querySelector(`label[for="${toggle.id}"]`);
      const section = toggle.closest('[class*="category"],[class*="purpose"],[class*="vendor"]');
      if (toggle.checked && nonEssential.test((label?.textContent || '') + (section?.textContent || ''))) {
        toggle.click();
      }
    }
  }

  function tryTwoStepDecline() {
    if (twoStepAttempted || declined) return;
    const customizeBtn = queryAllButtons().find(btn =>
      CUSTOMIZE_PATTERNS.some(p => p.test(btn.textContent.trim())) && isVisible(btn)
    );
    if (!customizeBtn) return;

    twoStepAttempted = true;
    customizeBtn.click();

    let checks = 0;
    const poll = setInterval(() => {
      if (++checks > 12) { clearInterval(poll); return; }
      const fresh = queryAllButtons();
      const rejectBtn = fresh.find(b =>
        PANEL_REJECT_PATTERNS.some(p => p.test(b.textContent.trim())) && isVisible(b) && b !== customizeBtn
      );
      if (rejectBtn) {
        clearInterval(poll);
        rejectBtn.scrollIntoView({ block: 'nearest' });
        rejectBtn.click();
        declined = true;
        reportSuccess('Generic (2-step)', window.location.hostname);
        return;
      }
      const modal = document.querySelector('[role="dialog"],[class*="modal"],[class*="prefer"],[class*="consent"]');
      if (modal && isVisible(modal)) {
        tryUnchecKAllToggles(modal);
        const saveBtn = Array.from(modal.querySelectorAll('button')).find(b =>
          /save|confirm|apply|done/i.test(b.textContent) && isVisible(b)
        );
        if (saveBtn) {
          clearInterval(poll);
          saveBtn.click();
          declined = true;
          reportSuccess('Generic (2-step toggle)', window.location.hostname);
        }
      }
    }, 400);
  }

  // ─── Main Orchestrator ────────────────────────────────────────────────────

  function tryDecline() {
    if (declined) return;

    tryTCFAPI();

    if (trySiteSpecific()) { declined = true; reportSuccess('Site-specific', window.location.hostname); return; }

    for (const handler of CMP_HANDLERS) {
      if (handler.detect() && handler.decline()) {
        declined = true; reportSuccess(handler.name, window.location.hostname); return;
      }
    }

    if (findByAriaOrData()) { declined = true; reportSuccess('Aria/Data', window.location.hostname); return; }

    if (tryGenericDecline()) { declined = true; reportSuccess('Generic', window.location.hostname); return; }

    tryTwoStepDecline();

    if (++attempts < MAX_ATTEMPTS) setTimeout(tryDecline, RETRY_DELAY_MS);
  }

  function reportSuccess(cmpName, hostname) {
    chrome.runtime.sendMessage({ type: 'DECLINED', cmp: cmpName, host: hostname, timestamp: Date.now() }).catch(() => {});
  }

  // ─── 5. SPA Navigation Handling ───────────────────────────────────────────

  function onNavigate() {
    declined = false; twoStepAttempted = false; attempts = 0;
    setTimeout(tryDecline, 500);
  }

  const _push = history.pushState.bind(history);
  history.pushState = (...args) => { _push(...args); onNavigate(); };
  const _replace = history.replaceState.bind(history);
  history.replaceState = (...args) => { _replace(...args); onNavigate(); };
  window.addEventListener('popstate', onNavigate);

  // ─── MutationObserver ─────────────────────────────────────────────────────

  let debounce = null;
  const observer = new MutationObserver(() => {
    if (declined) { observer.disconnect(); return; }
    clearTimeout(debounce);
    debounce = setTimeout(tryDecline, 300);
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  tryDecline();
  window.addEventListener('load', () => { if (!declined) setTimeout(tryDecline, 500); });

})();
