import crypto from 'node:crypto';
import { SCOPES, redirectUri, configured } from '../../lib/google.js';
import { setTemp } from '../../lib/session.js';

export default function handler(req, res) {
  if (!configured()) { res.statusCode = 302; res.setHeader('Location', '/work?setup=1'); return res.end(); }
  const state = crypto.randomBytes(16).toString('base64url');
  setTemp(res, 'gw_state', state);
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(req), response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  res.statusCode = 302;
  res.setHeader('Location', `https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  res.end();
}
