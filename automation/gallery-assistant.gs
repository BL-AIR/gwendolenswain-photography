/**
 * Gallery assistant: Gwendolen Swain Photography
 * Google Apps Script, installed in gwendolen.swain.photography@gmail.com.
 *
 * Folder convention (My Drive):
 *   Client Galleries/
 *     2026-11 Smith - Portraits #000012     ← job folder; "#" + Square invoice number at the end
 *       1 Proofs                            ← share by hand (Anyone with link, downloads off)
 *       2 Final                             ← released automatically when that invoice is PAID
 *   Folders starting with "_" (the template) are ignored.
 *
 * runEvery15Minutes()  Release on payment: when a job's Square invoice is PAID and "2 Final"
 *                      has files, share "2 Final" (Anyone with the link can view and download),
 *                      email the client the link, and let Gwendolen know.
 * runNightly()         60-day close: any shared job, Proofs or Final folder that has been open
 *                      for 60 days goes back to Restricted, with a heads-up email 7 days before.
 *                      12 months after a job folder was created, a one-off reminder that it can
 *                      be deleted to free space.
 *
 * Setup: Project Settings → Script properties → SQUARE_ACCESS_TOKEN (Square production token).
 *        Then run setup() once and approve the permissions.
 */

const CFG = {
  ROOT: 'Client Galleries',
  PROOFS: '1 Proofs',
  FINAL: '2 Final',
  OPEN_DAYS: 60,
  WARN_DAYS: 7,
  KEEP_MONTHS: 12,
  NOTIFY: 'sales@gwendolen.com.au',
  SENDER_NAME: 'Gwendolen Swain Photography',
  SQUARE_API: 'https://connect.squareup.com/v2',
  SQUARE_VERSION: '2025-01-23',
  LOCATION_ID: 'LAQ0J7407TDAG',
  TZ: 'Australia/Melbourne',
};
const PROPS = PropertiesService.getScriptProperties();

/* ---------- Setup ---------- */

function setup() {
  rootFolder_(); // fail early if the folder is missing
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runEvery15Minutes').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('runNightly').timeBased().everyDays(1).atHour(3).inTimezone(CFG.TZ).create();
  Logger.log('Installed: release check every 15 minutes, gallery check nightly at 3am.');
  if (!PROPS.getProperty('SQUARE_ACCESS_TOKEN')) Logger.log('Note: SQUARE_ACCESS_TOKEN is not set yet; release on payment is paused until it is.');
}

/* ---------- Release on payment ---------- */

function runEvery15Minutes() {
  const token = PROPS.getProperty('SQUARE_ACCESS_TOKEN');
  if (!token) return;

  const pending = [];
  jobFolders_().forEach(job => {
    const m = job.getName().match(/#\s*(\d+)\s*$/);
    if (!m) return;
    const fin = sub_(job, CFG.FINAL);
    if (!fin || PROPS.getProperty(key_(fin, 'released'))) return;
    pending.push({ job: job, fin: fin, number: m[1] });
  });
  if (!pending.length) return;

  const invoices = squareInvoices_(token);
  pending.forEach(p => {
    const inv = invoices.find(i => num_(i.invoice_number) === num_(p.number));
    if (!inv) {
      once_(p.job, 'missing', () => notify_('Invoice #' + p.number + ' not found',
        'The folder "' + p.job.getName() + '" ends in #' + p.number + ', but no Square invoice has that number. Check the number at the end of the folder name.'));
      return;
    }
    if (inv.status !== 'PAID') return;

    if (!p.fin.getFiles().hasNext()) {
      once_(p.fin, 'paid-empty', () => notify_('Invoice #' + p.number + ' is paid: upload the finals',
        'Invoice #' + p.number + ' (' + p.job.getName() + ') has been paid, but "' + CFG.FINAL + '" is empty.\n\n' +
        'Upload the final images to that folder and they will be sent to the client automatically within 15 minutes.'));
      return;
    }
    release_(p, inv, token);
  });
}

function release_(p, inv, token) {
  p.fin.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const now = new Date().toISOString();
  PROPS.setProperty(key_(p.fin, 'released'), now);
  PROPS.setProperty(key_(p.fin, 'open'), now);

  const r = recipient_(inv, token);
  const closes = fmt_(addDays_(new Date(), CFG.OPEN_DAYS));
  const link = p.fin.getUrl();

  if (r.email) {
    const hi = r.first ? 'Hi ' + r.first + ',' : 'Hi,';
    const text = [hi, '',
      'Thank you for your payment. Your photographs are ready to view and download:', '', link, '',
      'To save the whole set, open the link on a computer and use the Download button at the top right. You\'ll get a zip file of every image.', '',
      'Please download and back up your images. This gallery will be available until ' + closes + '.', '',
      'It was a pleasure working with you.', '', 'Gwendolen', '', '—', CFG.SENDER_NAME, 'https://gwendolen.com.au'].join('\n');
    MailApp.sendEmail({
      to: r.email, replyTo: CFG.NOTIFY, name: CFG.SENDER_NAME,
      subject: 'Your photographs are ready, ' + CFG.SENDER_NAME,
      body: text, htmlBody: clientHtml_(hi, link, closes),
    });
  }
  notify_('Gallery released: ' + p.job.getName(),
    'Invoice #' + p.number + ' was paid, so "' + CFG.FINAL + '" is now shared and downloadable.\n\n' +
    (r.email ? 'Emailed to ' + r.email + '.' : 'No client email was found on the invoice, so please send them this link yourself.') +
    '\n\nLink: ' + link + '\nCloses automatically on ' + closes + '.');
}

function clientHtml_(hi, link, closes) {
  const p = 'margin:0 0 16px';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><style>:root{color-scheme:light only}</style></head><body style="margin:0;background:#F6F0DC">' +
    '<div style="background:#F6F0DC;padding:32px 16px">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-top:4px solid #2F5A3F;padding:32px 28px;font-family:Georgia,\'Times New Roman\',serif;font-size:17px;line-height:1.55;color:#1B2620">' +
    '<p style="' + p + '">' + esc_(hi) + '</p>' +
    '<p style="' + p + '">Thank you for your payment. Your photographs are ready to view and download.</p>' +
    '<p style="margin:0 0 24px"><a href="' + link + '" style="display:inline-block;background:#2F5A3F;color:#F6F0DC;text-decoration:none;padding:12px 22px;font-family:Helvetica,Arial,sans-serif;font-size:15px;letter-spacing:.04em">View your photographs</a></p>' +
    '<p style="' + p + '">To save the whole set, open the link on a computer and use the Download button at the top right. You\'ll get a zip file of every image.</p>' +
    '<p style="' + p + '">Please download and back up your images. This gallery will be available until <strong>' + closes + '</strong>.</p>' +
    '<p style="' + p + '">It was a pleasure working with you.</p>' +
    '<p style="margin:0 0 28px">Gwendolen</p>' +
    '<p style="margin:0;padding-top:16px;border-top:1px solid #BFD0B4;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#2F5A3F">Gwendolen Swain Photography · <a href="https://gwendolen.com.au" style="color:#2F5A3F;text-decoration:none">gwendolen.com.au</a></p>' +
    '</div></div></body></html>';
}

/* ---------- Nightly: 60-day close, warnings, 12-month reminder ---------- */

function runNightly() {
  const closed = [], warned = [], cleanup = [];

  jobFolders_().forEach(job => {
    [job, sub_(job, CFG.PROOFS), sub_(job, CFG.FINAL)].filter(Boolean).forEach(f => {
      const label = f.getId() === job.getId() ? job.getName() : job.getName() + ' / ' + f.getName();
      if (!isOpen_(f)) {
        PROPS.deleteProperty(key_(f, 'open'));
        PROPS.deleteProperty(key_(f, 'warned'));
        return;
      }
      let since = PROPS.getProperty(key_(f, 'open'));
      if (!since) { since = new Date().toISOString(); PROPS.setProperty(key_(f, 'open'), since); }
      const age = daysSince_(since);
      if (age >= CFG.OPEN_DAYS) {
        f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
        PROPS.deleteProperty(key_(f, 'open'));
        PROPS.deleteProperty(key_(f, 'warned'));
        closed.push(label);
      } else if (age >= CFG.OPEN_DAYS - CFG.WARN_DAYS && !PROPS.getProperty(key_(f, 'warned'))) {
        PROPS.setProperty(key_(f, 'warned'), new Date().toISOString());
        warned.push(label + ' closes on ' + fmt_(addDays_(new Date(since), CFG.OPEN_DAYS)));
      }
    });

    if (daysSince_(job.getDateCreated()) >= CFG.KEEP_MONTHS * 30.44) {
      once_(job, 'cleanup', () => cleanup.push(job.getName() + ' (created ' + fmt_(job.getDateCreated()) + ')'));
    }
  });

  if (!closed.length && !warned.length && !cleanup.length) return;
  const parts = [];
  if (closed.length) parts.push('Closed today (now Restricted; clients can no longer open them):\n• ' + closed.join('\n• '));
  if (warned.length) parts.push('Closing in ' + CFG.WARN_DAYS + ' days. Let the client know if they still need to download:\n• ' + warned.join('\n• '));
  if (cleanup.length) parts.push('More than ' + CFG.KEEP_MONTHS + ' months old. Delete these from Drive when you\'re sure you have your own copy:\n• ' + cleanup.join('\n• '));
  notify_('Gallery check: ' + fmt_(new Date()), parts.join('\n\n'));
}

/* ---------- Square ---------- */

function squareInvoices_(token) {
  const out = [];
  let cursor = '';
  do {
    const url = CFG.SQUARE_API + '/invoices?location_id=' + CFG.LOCATION_ID + '&limit=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    const data = squareGet_(url, token);
    (data.invoices || []).forEach(i => out.push(i));
    cursor = data.cursor || '';
  } while (cursor);
  return out;
}

function recipient_(inv, token) {
  const pr = inv.primary_recipient || {};
  let email = pr.email_address || '', first = pr.given_name || '';
  if ((!email || !first) && pr.customer_id) {
    try {
      const c = squareGet_(CFG.SQUARE_API + '/customers/' + pr.customer_id, token).customer || {};
      email = email || c.email_address || '';
      first = first || c.given_name || '';
    } catch (e) { /* use what we have */ }
  }
  return { email: email, first: first };
}

function squareGet_(url, token) {
  const res = UrlFetchApp.fetch(url, {
    method: 'get', muteHttpExceptions: true,
    headers: { 'Authorization': 'Bearer ' + token, 'Square-Version': CFG.SQUARE_VERSION },
  });
  if (res.getResponseCode() !== 200) throw new Error('Square ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText());
}

/* ---------- Helpers ---------- */

function rootFolder_() {
  const it = DriveApp.getRootFolder().getFoldersByName(CFG.ROOT);
  if (!it.hasNext()) throw new Error('Folder "' + CFG.ROOT + '" not found in My Drive.');
  return it.next();
}
function jobFolders_() {
  const out = [], it = rootFolder_().getFolders();
  while (it.hasNext()) { const f = it.next(); if (f.getName().charAt(0) !== '_') out.push(f); }
  return out;
}
function sub_(folder, name) { const it = folder.getFoldersByName(name); return it.hasNext() ? it.next() : null; }
function isOpen_(f) { const a = f.getSharingAccess(); return a === DriveApp.Access.ANYONE_WITH_LINK || a === DriveApp.Access.ANYONE; }
function key_(f, what) { return what + ':' + f.getId(); }
function once_(f, what, fn) { const k = key_(f, what); if (PROPS.getProperty(k)) return; PROPS.setProperty(k, new Date().toISOString()); fn(); }
function num_(s) { return String(s || '').replace(/\D/g, '').replace(/^0+/, ''); }
function daysSince_(d) { return Math.floor((Date.now() - new Date(d).getTime()) / 86400000); }
function addDays_(d, n) { return new Date(d.getTime() + n * 86400000); }
function fmt_(d) { return Utilities.formatDate(new Date(d), CFG.TZ, 'd MMMM yyyy'); }
function esc_(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function notify_(subject, body) {
  MailApp.sendEmail({ to: CFG.NOTIFY, name: 'Gallery assistant', subject: subject, body: body + '\n\n(Sent automatically by the gallery assistant in gwendolen.swain.photography@gmail.com.)' });
}
