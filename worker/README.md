# gwendolen-enquiry (Cloudflare Worker)

Receives the enquiry form on gwendolen.com.au/contact.html and:

1. finds or creates the person in Gwendolen's **Square** customer directory (by email),
2. adds a dated note with the enquiry,
3. emails the enquiry to **sales@gwendolen.com.au** via **Resend** (reply-to = the client).

If Square fails, the email still goes and says so. If the email fails, the form
tells the visitor and offers Gwendolen's email address instead — no enquiry is lost.

Live at: `https://gwendolen-enquiry.2bzbk74ry7.workers.dev`
(the form's `data-endpoint` in contact.html points here).

## Secrets

| Name | What |
|---|---|
| `SQUARE_ACCESS_TOKEN` | Production access token from the Square Developer Console app *gwendolen.com.au enquiry form* (Gwendolen's Square account — **not** Prahran Publishing's) |
| `RESEND_API_KEY` | Resend API key; the domain gwendolen.com.au must be verified in Resend |

## Spam protection

Origin must be gwendolen.com.au; hidden honeypot field; minimum 3 s fill time;
field length limits; 3 requests per minute per IP (`RATE_LIMITER`).
