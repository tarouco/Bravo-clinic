/* Bravô Clinic — UI v3 behaviors (vanilla, no dependencies). Call BravoClinic.init() once per page. */
(function () {
  var LIT_MS = 1600;
  var GROUPED = '.bv-chip, .bv-day, .bv-tab';

  function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }

  function setSlider(sl, v) {
    v = clamp(v);
    var fill = sl.querySelector('.bv-slider-fill');
    var knob = sl.querySelector('.bv-slider-knob');
    if (fill) fill.style.width = v + '%';
    if (knob) knob.style.left = v + '%';
    sl.setAttribute('aria-valuenow', String(v));
    var out = sl.getAttribute('data-bv-output');
    if (out) { var el = document.getElementById(out); if (el) el.textContent = v + '%'; }
    sl.dispatchEvent(new CustomEvent('bv:change', { detail: { value: v }, bubbles: true }));
  }

  function bindSlider(sl) {
    if (sl.__bv) return; sl.__bv = true;
    var knob = sl.querySelector('.bv-slider-knob');
    function fromX(x) { var r = sl.getBoundingClientRect(); setSlider(sl, (x - r.left) / r.width * 100); }
    function end() { sl.classList.remove('is-dragging'); if (knob) knob.classList.remove('is-lit'); }
    sl.addEventListener('pointerdown', function (e) { sl.setPointerCapture(e.pointerId); sl.classList.add('is-dragging'); if (knob) knob.classList.add('is-lit'); fromX(e.clientX); });
    sl.addEventListener('pointermove', function (e) { if (sl.classList.contains('is-dragging')) fromX(e.clientX); });
    sl.addEventListener('pointerup', end);
    sl.addEventListener('pointercancel', end);
    sl.addEventListener('keydown', function (e) {
      var v = Number(sl.getAttribute('aria-valuenow') || 0);
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { setSlider(sl, v + 5); e.preventDefault(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { setSlider(sl, v - 5); e.preventDefault(); }
      if (e.key === 'Home') { setSlider(sl, 0); e.preventDefault(); }
      if (e.key === 'End') { setSlider(sl, 100); e.preventDefault(); }
    });
    setSlider(sl, Number(sl.getAttribute('aria-valuenow') || 50));
  }

  function groupOf(el) {
    var host = el.closest('[data-bv-group]') || el.parentElement;
    var cls = el.classList.contains('bv-tab') ? '.bv-tab' : el.classList.contains('bv-day') ? '.bv-day' : '.bv-chip';
    return host.querySelectorAll(cls);
  }

  function onClick(e) {
    var link = e.target.closest('.bv-navbar-link');
    if (link && link.closest('[data-bv-nav]')) {
      e.preventDefault();
      link.closest('[data-bv-nav]').querySelectorAll('.bv-navbar-link').forEach(function (a) { a.removeAttribute('aria-current'); });
      link.setAttribute('aria-current', 'page');
      return;
    }
    var el = e.target.closest('button');
    if (!el || el.disabled) return;
    if (el.classList.contains('bv-toggle')) {
      el.setAttribute('aria-checked', String(el.getAttribute('aria-checked') !== 'true'));
      return;
    }
    if (el.matches(GROUPED)) {
      groupOf(el).forEach(function (g) {
        if (g.classList.contains('bv-tab')) g.removeAttribute('aria-current'); else g.setAttribute('aria-pressed', 'false');
      });
      if (el.classList.contains('bv-tab')) el.setAttribute('aria-current', 'page'); else el.setAttribute('aria-pressed', 'true');
      return;
    }
    if (el.matches('.bv-btn, .bv-icon-btn, .bv-fab')) {
      el.classList.add('is-lit');
      clearTimeout(el.__bvT);
      el.__bvT = setTimeout(function () { el.classList.remove('is-lit'); }, LIT_MS);
    }
  }

  var bound = false;
  function init(root) {
    root = root || document;
    if (!bound) { document.addEventListener('click', onClick); bound = true; }
    root.querySelectorAll('.bv-slider').forEach(bindSlider);
  }

  window.BravoClinic = { version: '3.0.0', init: init, setSlider: setSlider, litDuration: LIT_MS };
})();
