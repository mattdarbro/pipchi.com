/**
 * POST /api/subscribe — add an email to the Campfire mailing list.
 *
 * Backed by a Resend Audience. Requires two Vercel env vars (Project >
 * Settings > Environment Variables):
 *   RESEND_API_KEY      — the shared Pipchi Resend key
 *   RESEND_AUDIENCE_ID  — the "The Campfire" audience
 *
 * Degrades honestly: if the env vars aren't set yet, the form gets a clear
 * "not open yet" message instead of a silent success that drops the address.
 * The `stagedoor` field is a honeypot — humans never see it, bots fill it.
 * Ported from blameitontheink's functions/api/subscribe.js (Cloudflare Pages
 * Function) to Vercel's Node serverless handler signature.
 */
export default async function handler(req, res) {
  const respond = (status, message) => res.status(status).json({ message });

  if (req.method !== "POST") {
    return respond(405, "Use POST.");
  }

  const body = req.body || {};

  if (body.stagedoor) {
    // Honeypot tripped: pretend success, save nothing.
    return respond(200, "You're on the list.");
  }

  const email = String(body.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond(400, "That email doesn't look right — check it and try again.");
  }

  const { RESEND_API_KEY, RESEND_AUDIENCE_ID } = process.env;
  if (!RESEND_API_KEY || !RESEND_AUDIENCE_ID) {
    return respond(503, "The lantern isn't lit yet — try again soon.");
  }

  const resp = await fetch(
    `https://api.resend.com/audiences/${RESEND_AUDIENCE_ID}/contacts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, unsubscribed: false }),
    },
  );

  if (!resp.ok && resp.status !== 409) {
    // 409 = already on the list, which is a success from the visitor's side.
    return respond(502, "That didn't go through — try again in a moment.");
  }

  return respond(200, "You're on the list.");
}
