// Google OAuth + the few Calendar and Gmail calls Genie Work needs. Plain fetch, no SDK.

export const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/calendar.events',   // read today, add approved holds
  'https://www.googleapis.com/auth/gmail.readonly',    // read threads that need a reply (restricted scope)
  'https://www.googleapis.com/auth/gmail.send',        // send only after the founder taps Approve
];

export function redirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers.host}/api/google/callback`;
}

export function configured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.SESSION_SECRET);
}

export async function exchangeCode(code, req) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(req), grant_type: 'authorization_code',
    }),
  });
  if (!r.ok) throw new Error(`token exchange failed: ${r.status}`);
  return r.json();
}

export async function accessToken(session) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: session.rt, client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) { const e = new Error('google_reauth'); e.status = 401; throw e; }
  return (await r.json()).access_token;
}

async function g(token, url, init = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!r.ok) { const e = new Error(`google ${r.status} on ${new URL(url).pathname}`); e.status = r.status; throw e; }
  return r.status === 204 ? null : r.json();
}

export function decodeIdToken(idToken) {
  const payload = idToken.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

// Today's events in the founder's own time zone.
export async function todaysEvents(token, tz) {
  const cal = await g(token, 'https://www.googleapis.com/calendar/v3/calendars/primary');
  const zone = tz || cal.timeZone || 'UTC';
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const start = zonedMidnight(ymd, zone);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  const q = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '25' });
  const data = await g(token, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
  const events = (data.items || []).filter(e => e.status !== 'cancelled').map(e => ({
    id: e.id,
    title: e.summary || '(no title)',
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    allDay: Boolean(e.start?.date),
    attendees: (e.attendees || []).length,
    link: e.hangoutLink || null,
  }));
  return { zone, events, dayStart: start.toISOString(), dayEnd: end.toISOString() };
}

function zonedMidnight(ymd, zone) {
  // Midnight of ymd in zone, as a UTC Date.
  const guess = new Date(`${ymd}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const asZone = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(guess.getTime() - (asZone - guess.getTime()));
}

export async function freeBusy(token, timeMin, timeMax) {
  const data = await g(token, 'https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST', body: JSON.stringify({ timeMin, timeMax, items: [{ id: 'primary' }] }),
  });
  return data.calendars?.primary?.busy || [];
}

// Inbox threads from the last two days that are waiting on the founder.
export async function threadsNeedingReply(token, me, limit = 8) {
  const q = new URLSearchParams({ q: 'in:inbox newer_than:2d -category:promotions -category:social -category:updates -from:me', maxResults: String(limit) });
  const list = await g(token, `https://gmail.googleapis.com/gmail/v1/users/me/threads?${q}`);
  const out = [];
  for (const t of list.threads || []) {
    const th = await g(token, `https://gmail.googleapis.com/gmail/v1/users/me/threads/${t.id}?format=full`);
    const msgs = th.messages || [];
    const last = msgs[msgs.length - 1];
    if (!last) continue;
    const h = headers(last);
    if ((h.from || '').toLowerCase().includes(me.toLowerCase())) continue; // already replied
    out.push({
      threadId: th.id,
      messageId: h['message-id'] || '',
      references: [h.references, h['message-id']].filter(Boolean).join(' '),
      from: h.from || '',
      replyTo: h['reply-to'] || h.from || '',
      subject: h.subject || '(no subject)',
      date: h.date || '',
      unread: (last.labelIds || []).includes('UNREAD'),
      snippet: decodeEntities(last.snippet || ''),
      body: plainBody(last).slice(0, 4000),
      count: msgs.length,
    });
  }
  return out;
}

function headers(msg) {
  const o = {};
  for (const x of msg.payload?.headers || []) o[x.name.toLowerCase()] = x.value;
  return o;
}

function plainBody(msg) {
  const walk = (p) => {
    if (!p) return '';
    if (p.mimeType === 'text/plain' && p.body?.data) return Buffer.from(p.body.data, 'base64url').toString('utf8');
    for (const c of p.parts || []) { const t = walk(c); if (t) return t; }
    if (p.mimeType === 'text/html' && p.body?.data) return Buffer.from(p.body.data, 'base64url').toString('utf8').replace(/<[^>]+>/g, ' ');
    return '';
  };
  return walk(msg.payload).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function decodeEntities(s) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function headerSafe(s) { return String(s || '').replace(/[\r\n]+/g, ' ').trim(); }

export async function sendReply(token, { from, to, subject, body, threadId, inReplyTo, references }) {
  const subj = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  const lines = [
    `From: ${headerSafe(from)}`,
    `To: ${headerSafe(to)}`,
    `Subject: =?UTF-8?B?${Buffer.from(headerSafe(subj)).toString('base64')}?=`,
    inReplyTo ? `In-Reply-To: ${headerSafe(inReplyTo)}` : null,
    references ? `References: ${headerSafe(references)}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(String(body)).toString('base64'),
  ].filter(l => l !== null).join('\r\n');
  return g(token, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', body: JSON.stringify({ raw: Buffer.from(lines).toString('base64url'), threadId }),
  });
}

export async function createHold(token, { title, start, end, zone }) {
  return g(token, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify({
      summary: title,
      description: 'Held by Genie Work after your approval.',
      start: { dateTime: start, timeZone: zone }, end: { dateTime: end, timeZone: zone },
      transparency: 'opaque', reminders: { useDefault: true },
    }),
  });
}
