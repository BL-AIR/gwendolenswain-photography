/* Gwendolen Swain Photography — small site scripts.
   1. Lightbox for any .gallery a.tile (links to the full-size image).
   2. Enquiry form: composes an email in the visitor's mail app (no server needed). */
(function () {
  'use strict';

  /* ---------- Lightbox ---------- */
  var tiles = Array.prototype.slice.call(document.querySelectorAll('.gallery a.tile'));
  if (tiles.length) {
    var box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Photograph viewer');
    box.innerHTML =
      '<div class="lb-bar"><span class="lb-count"></span>' +
      '<button class="lb-btn lb-close" type="button">Close ✕</button></div>' +
      '<div class="lb-stage"><img alt=""></div>' +
      '<div class="lb-caption"></div>' +
      '<button class="lb-btn lb-prev" type="button" aria-label="Previous photograph">←</button>' +
      '<button class="lb-btn lb-next" type="button" aria-label="Next photograph">→</button>';
    document.body.appendChild(box);

    var img = box.querySelector('img');
    var cap = box.querySelector('.lb-caption');
    var count = box.querySelector('.lb-count');
    var current = 0;
    var lastFocus = null;

    function show(i) {
      current = (i + tiles.length) % tiles.length;
      var t = tiles[current];
      var thumb = t.querySelector('img');
      var fig = t.closest('figure');
      var fc = fig ? fig.querySelector('figcaption') : null;
      img.src = t.getAttribute('href');
      img.alt = thumb ? thumb.alt : '';
      cap.textContent = fc ? fc.textContent : '';
      count.textContent = (current + 1) + ' / ' + tiles.length;
    }
    function open(i) {
      lastFocus = document.activeElement;
      show(i);
      box.classList.add('open');
      document.body.classList.add('lb-lock');
      box.querySelector('.lb-close').focus();
    }
    function close() {
      box.classList.remove('open');
      document.body.classList.remove('lb-lock');
      img.removeAttribute('src');
      if (lastFocus) lastFocus.focus();
    }

    tiles.forEach(function (t, i) {
      t.addEventListener('click', function (e) { e.preventDefault(); open(i); });
    });
    box.querySelector('.lb-close').addEventListener('click', close);
    box.querySelector('.lb-prev').addEventListener('click', function () { show(current - 1); });
    box.querySelector('.lb-next').addEventListener('click', function () { show(current + 1); });
    box.addEventListener('click', function (e) { if (e.target === box || e.target.classList.contains('lb-stage')) close(); });
    document.addEventListener('keydown', function (e) {
      if (!box.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(current - 1);
      if (e.key === 'ArrowRight') show(current + 1);
    });
  }

  /* ---------- Enquiry form ---------- */
  var form = document.getElementById('enquiry');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true;
      ['name', 'email', 'message'].forEach(function (id) {
        var el = form.elements[id];
        var field = el.closest('.field');
        var bad = !el.value.trim() || (id === 'email' && !/^\S+@\S+\.\S+$/.test(el.value.trim()));
        field.classList.toggle('error', bad);
        if (bad && ok) { el.focus(); ok = false; }
      });
      if (!ok) return;

      var v = function (n) { return (form.elements[n] && form.elements[n].value.trim()) || ''; };
      var subject = 'Enquiry' + (v('type') ? ' — ' + v('type') : '') + ' — ' + v('name');
      var lines = [
        v('message'),
        '',
        '—',
        'Name: ' + v('name'),
        'Email: ' + v('email'),
        v('phone') ? 'Phone: ' + v('phone') : '',
        v('type') ? 'Type of work: ' + v('type') : '',
        v('date') ? 'Date: ' + v('date') : ''
      ].filter(function (l, i) { return l !== '' || i === 1; });
      window.location.href = 'mailto:me@gwendolen.com.au?subject=' +
        encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
    });
  }

  /* ---------- Footer year ---------- */
  var y = document.querySelector('[data-year]');
  if (y) y.textContent = new Date().getFullYear();
})();
