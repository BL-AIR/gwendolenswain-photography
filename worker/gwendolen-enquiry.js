/**
 * gwendolen-enquiry — Cloudflare Worker behind the enquiry form on gwendolen.com.au
 *
 * For each genuine enquiry it:
 *   1. finds the person in Gwendolen's Square customer directory by email,
 *      or creates them (name, email, phone, organisation);
 *   2. adds a dated note to that customer with the enquiry details;
 *   3. emails the enquiry to sales@gwendolen.com.au (reply-to = the client);
 *   4. sends the enquirer a short, fixed-wording acknowledgement;
 *   5. answers the browser with { ok: true }.
 *
 * The email is the safety net: if Square is unavailable the enquiry still
 * arrives, and the email says the Square step needs doing by hand.
 *
 * Secrets (Cloudflare dashboard → Worker → Settings → Variables and Secrets):
 *   SQUARE_ACCESS_TOKEN  production access token for Gwendolen's Square account
 *   RESEND_API_KEY       Resend API key allowed to send from gwendolen.com.au
 *
 * Spam protection: allowed-origin check, hidden honeypot field, minimum fill
 * time, length limits, and the RATE_LIMITER binding (see wrangler.toml).
 */

const ALLOWED_ORIGINS = ['https://gwendolen.com.au', 'https://www.gwendolen.com.au'];
const NOTIFY_TO = 'sales@gwendolen.com.au';
const NOTIFY_FROM = 'Gwendolen Swain Photography <enquiries@gwendolen.com.au>';
const SQUARE_API = 'https://connect.squareup.com/v2';
const SQUARE_VERSION = '2025-01-23';
const MIN_FILL_MS = 3000;                 // humans take longer than 3 s
const LIMITS = { name: 120, email: 254, phone: 30, organisation: 200, type: 60, date: 20, message: 4000 };
const TYPES = ['Event', 'Portrait', 'Artwork or exhibition documentation', 'Something else', ''];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405, cors);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: 'origin' }, 403, cors);

    if (env.RATE_LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return json({ ok: false, error: 'rate' }, 429, cors);
    }

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'bad-json' }, 400, cors); }

    // Bots: honeypot filled, or form submitted impossibly fast. Pretend success.
    if (body.website || (Number(body.started) && Date.now() - Number(body.started) < MIN_FILL_MS)) {
      return json({ ok: true }, 200, cors);
    }

    const e = clean(body);
    const problems = validate(e);
    if (problems.length) return json({ ok: false, error: 'invalid', fields: problems }, 400, cors);

    // 1–2. Square: find or create the customer, then add the note.
    let square = { ok: false, created: false, id: null, error: null };
    try {
      square = await upsertCustomer(env, e);
    } catch (err) {
      square.error = String(err && err.message || err).slice(0, 500);
    }

    // 3. Email. This must succeed, or the enquiry is lost: report failure to the browser.
    try {
      await sendEmail(env, e, square);
    } catch (err) {
      console.log('email failed', err && err.message);
      return json({ ok: false, error: 'email' }, 502, cors);
    }

    // 4. Acknowledge the enquirer. Best effort: a failure here never affects the enquiry.
    const ack = sendAcknowledgement(env, e).catch(err => console.log('ack failed', err && err.message));
    if (ctx && ctx.waitUntil) ctx.waitUntil(ack); else await ack;

    return json({ ok: true }, 200, cors);
  },
};

/* ---------------- Square ---------------- */

async function sq(env, path, method, payload) {
  const res = await fetch(SQUARE_API + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + env.SQUARE_ACCESS_TOKEN,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.errors || []).map(x => `${x.code}: ${x.detail}`).join('; ') || res.status;
    const error = new Error(`Square ${method} ${path} → ${msg}`);
    error.square = data.errors || [];
    throw error;
  }
  return data;
}

async function upsertCustomer(env, e) {
  const note = noteFor(e);

  const found = await sq(env, '/customers/search', 'POST', {
    query: { filter: { email_address: { exact: e.email } } },
    limit: 1,
  });
  const existing = (found.customers || [])[0];

  if (existing) {
    const combined = (note + '\n\n' + (existing.note || '')).trim().slice(0, 4000);
    const update = { note: combined, version: existing.version };
    // Fill gaps only — never overwrite what Gwendolen has already recorded.
    if (!existing.phone_number && e.phone) update.phone_number = e.phone;
    if (!existing.company_name && e.organisation) update.company_name = e.organisation;
    try {
      await sq(env, `/customers/${existing.id}`, 'PUT', update);
    } catch (err) {
      if (update.phone_number && isPhoneError(err)) {   // bad phone: keep it in the note instead
        delete update.phone_number;
        await sq(env, `/customers/${existing.id}`, 'PUT', update);
      } else throw err;
    }
    return { ok: true, created: false, id: existing.id, error: null };
  }

  const [given, family] = splitName(e.name);
  const create = {
    idempotency_key: crypto.randomUUID(),
    given_name: given,
    family_name: family || undefined,
    email_address: e.email,
    phone_number: e.phone || undefined,
    company_name: e.organisation || undefined,
    reference_id: 'website-enquiry',
    note,
  };
  let made;
  try {
    made = await sq(env, '/customers', 'POST', create);
  } catch (err) {
    if (create.phone_number && isPhoneError(err)) {
      delete create.phone_number;
      create.idempotency_key = crypto.randomUUID();
      made = await sq(env, '/customers', 'POST', create);
    } else throw err;
  }
  return { ok: true, created: true, id: made.customer && made.customer.id, error: null };
}

function isPhoneError(err) {
  return (err.square || []).some(x => (x.field || '').includes('phone') || /phone/i.test(x.detail || ''));
}

function noteFor(e) {
  const lines = [`Website enquiry — ${todayMelbourne()}`];
  if (e.type) lines.push(`Type: ${e.type}`);
  if (e.date) lines.push(`Date: ${formatDate(e.date)}`);
  if (e.phone) lines.push(`Phone given: ${e.phone}`);
  if (e.organisation) lines.push(`Organisation: ${e.organisation}`);
  lines.push('', e.message);
  return lines.join('\n');
}

/* ---------------- Email (Resend) ---------------- */

async function sendEmail(env, e, square) {
  const squareLine = square.ok
    ? (square.created ? 'New customer added to Square.' : 'Existing Square customer — enquiry added to their notes.')
    : 'Square was not updated automatically — please add this customer by hand. (' + (square.error || 'unknown error') + ')';
  const squareLink = square.ok && square.id
    ? `https://app.squareup.com/dashboard/customers/directory/customer/${square.id}` : '';

  const rows = [
    ['Name', e.name], ['Email', e.email], ['Phone', e.phone], ['Organisation', e.organisation],
    ['Type of work', e.type], ['Date', e.date ? formatDate(e.date) : ''],
  ].filter(r => r[1]);

  const text = [
    `New enquiry from gwendolen.com.au`, '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '',
    e.message, '', '—', squareLine, squareLink,
  ].join('\n');

  const html = `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.5;color:#1B2620">
<p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#5C6455">New enquiry · gwendolen.com.au</p>
<table style="border-collapse:collapse">${rows.map(([k, v]) =>
    `<tr><td style="padding:2px 16px 2px 0;color:#5C6455">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
<p style="white-space:pre-wrap;border-left:3px solid #2F5A3F;padding-left:12px">${esc(e.message)}</p>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#5C6455">${esc(squareLine)}${squareLink
    ? ` <a href="${squareLink}" style="color:#2F5A3F">Open in Square →</a>` : ''}</p></div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: [NOTIFY_TO],
      reply_to: e.email,
      subject: `Enquiry${e.type ? ' — ' + e.type : ''} — ${e.name}`,
      text, html,
    }),
  });
  if (!res.ok) throw new Error('Resend ' + res.status + ' ' + (await res.text()).slice(0, 300));
}

/* ---------------- Acknowledgement to the enquirer ----------------
   Deliberately fixed wording: it never repeats the visitor's message, so the
   form can't be used to send arbitrary content to arbitrary addresses. */

async function sendAcknowledgement(env, e) {
  const first = (e.name.split(' ')[0] || '').replace(/[^\p{L}\p{M}'\-]/gu, '').slice(0, 30);
  const hi = first ? `Hi ${first},` : 'Hi,';
  const dateLine = e.date
    ? `You mentioned ${formatDate(e.date)}, so I'll check my availability and let you know in my reply.`
    : '';

  const text = [
    hi, '',
    "Thanks for getting in touch. Your enquiry has reached me, and I'll reply as soon as I can, usually within two business days.",
    ...(dateLine ? ['', dateLine] : []), '',
    'In the meantime, you can see more of my work at https://gwendolen.com.au/work.html or on Instagram @gswain_photography.', '',
    'Gwendolen', '',
    '—', 'Gwendolen Swain Photography', 'https://gwendolen.com.au', '',
    'This is an automatic reply. To add anything to your enquiry, just reply to this email.',
  ].join('\n');

  const p = 'margin:0 0 16px';
  const html = `<div style="background:#F6F0DC;padding:32px 16px">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-top:4px solid #2F5A3F;padding:32px 28px;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.55;color:#1B2620">
<p style="${p}">${esc(hi)}</p>
<p style="${p}">Thanks for getting in touch. Your enquiry has reached me, and I'll reply as soon as I can, usually within two business days.</p>
${dateLine ? `<p style="${p}">${esc(dateLine)}</p>` : ''}
<p style="${p}">In the meantime, you can see more of my work on <a href="https://gwendolen.com.au/work.html" style="color:#2F5A3F">my website</a> or on Instagram <a href="https://www.instagram.com/gswain_photography/" style="color:#2F5A3F">@gswain_photography</a>.</p>
<p style="margin:0 0 28px">Gwendolen</p>
<p style="margin:0;padding-top:16px;border-top:1px solid #BFD0B4;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#2F5A3F">Gwendolen Swain Photography · <a href="https://gwendolen.com.au" style="color:#2F5A3F;text-decoration:none">gwendolen.com.au</a></p>
</div>
<p style="max-width:560px;margin:12px auto 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#5C6455;text-align:center">This is an automatic reply. To add anything to your enquiry, just reply to this email.</p>
</div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Gwendolen Swain Photography <sales@gwendolen.com.au>',
      to: [e.email],
      reply_to: NOTIFY_TO,
      subject: 'Thanks for your enquiry, Gwendolen Swain Photography',
      text, html,
    }),
  });
  if (!res.ok) throw new Error('Resend ack ' + res.status + ' ' + (await res.text()).slice(0, 300));
}

/* ---------------- Helpers ---------------- */

function clean(b) {
  const s = (v, n) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, n);
  return {
    name: s(b.name, LIMITS.name).replace(/\s+/g, ' '),
    email: s(b.email, LIMITS.email).toLowerCase(),
    phone: auPhone(s(b.phone, LIMITS.phone).replace(/[^\d+]/g, '')),
    organisation: s(b.organisation, LIMITS.organisation),
    type: s(b.type, LIMITS.type),
    date: s(b.date, LIMITS.date),
    message: s(b.message, LIMITS.message),
  };
}

// Australian numbers to international format for Square: 0412345678 → +61412345678
function auPhone(p) {
  if (/^0[2-478]\d{8}$/.test(p)) return '+61' + p.slice(1);
  if (/^61\d{9}$/.test(p)) return '+' + p;
  return p;
}

function validate(e) {
  const p = [];
  if (!e.name) p.push('name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email)) p.push('email');
  if (!e.message) p.push('message');
  if (e.date && !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) p.push('date');
  if (!TYPES.includes(e.type)) p.push('type');
  return p;
}

function splitName(full) {
  const parts = full.split(' ');
  if (parts.length === 1) return [parts[0], ''];
  return [parts.slice(0, -1).join(' '), parts[parts.length - 1]];
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${d} ${months[m - 1]} ${y}`;
}

function todayMelbourne() {
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
