/* Gwendolen Swain Photography — small site scripts.
   1. Lightbox for any .gallery a.tile (links to the full-size image).
   2. Enquiry form: posts to the gwendolen-enquiry worker, with an email fallback. */
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

  /* ---------- Enquiry form ----------
     Sends to the gwendolen-enquiry worker (Square customer + email to sales@).
     If that fails for any reason, falls back to the visitor's own email app,
     so an enquiry is never lost. */
  var form = document.getElementById('enquiry');
  if (form) {
    var started = Date.now();
    var status = form.querySelector('.form-status');
    var button = form.querySelector('button[type="submit"]');
    var endpoint = form.getAttribute('data-endpoint');
    var fallbackEmail = form.getAttribute('data-fallback-email') || 'sales@gwendolen.com.au';
    var v = function (n) { return (form.elements[n] && form.elements[n].value.trim()) || ''; };

    var mailtoHref = function () {
      var subject = 'Enquiry' + (v('type') ? ' — ' + v('type') : '') + ' — ' + v('name');
      var lines = [v('message'), '', '—', 'Name: ' + v('name'), 'Email: ' + v('email'),
        v('phone') ? 'Phone: ' + v('phone') : '', v('organisation') ? 'Organisation: ' + v('organisation') : '',
        v('type') ? 'Type of work: ' + v('type') : '', v('date') ? 'Date: ' + v('date') : '']
        .filter(function (l, i) { return l !== '' || i === 1; });
      return 'mailto:' + fallbackEmail + '?subject=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(lines.join('\n'));
    };
    var say = function (html, kind) {
      status.innerHTML = html;
      status.className = 'form-status' + (kind ? ' form-status--' + kind : '');
    };
    var fallback = function () {
      say('Sorry — that didn’t go through. Please <a href="' + mailtoHref() +
        '">send it by email instead</a>, or write to <a href="mailto:' + fallbackEmail + '">' +
        fallbackEmail + '</a>.', 'error');
      button.disabled = false;
      button.textContent = 'Send Enquiry';
    };

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

      if (!endpoint || !window.fetch) { window.location.href = mailtoHref(); return; }

      button.disabled = true;
      button.textContent = 'Sending…';
      say('');
      var payload = {
        name: v('name'), email: v('email'), phone: v('phone'), organisation: v('organisation'),
        type: v('type'), date: v('date'), message: v('message'),
        website: form.elements.website ? form.elements.website.value : '', started: started
      };
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (res.ok && data.ok) {
            form.reset();
            form.classList.add('form--sent');
            button.textContent = 'Sent';
            say('<strong>Thank you — your enquiry is on its way.</strong> I’ll be in touch soon.', 'ok');
            if (window.dataLayer) window.dataLayer.push({ event: 'generate_lead', form: 'enquiry', enquiry_type: payload.type || 'unspecified' });
          } else {
            fallback();
          }
        });
      }).catch(fallback);
    });
  }

  /* ---------- Light / dark toggle ----------
     Follows the visitor's system setting until they choose; the choice is remembered on this device. */
  var toggle = document.querySelector('.theme-toggle');
  if (toggle) {
    var root = document.documentElement;
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    var isDark = function () {
      var t = root.getAttribute('data-theme');
      return t ? t === 'dark' : !!(mq && mq.matches);
    };
    var label = function () {
      toggle.setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
    };
    label();
    if (mq && mq.addEventListener) mq.addEventListener('change', label);
    toggle.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('gsp-theme', next); } catch (e) {}
      label();
    });
  }

  /* ---------- Footer year ---------- */
  var y = document.querySelector('[data-year]');
  if (y) y.textContent = new Date().getFullYear();
})();
