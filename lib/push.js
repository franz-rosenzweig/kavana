'use strict';
// Web Push with no dependencies: VAPID (RFC 8292) + aes128gcm payload encryption (RFC 8291).
const crypto = require('node:crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

// Push services we're willing to POST to. A subscription endpoint anywhere else is refused,
// so a signed-in user can't point the server at an arbitrary URL.
const PUSH_HOSTS = ['.push.apple.com', 'fcm.googleapis.com', 'android.googleapis.com',
  '.push.services.mozilla.com', '.notify.windows.com'];

function endpointAllowed(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  return PUSH_HOSTS.some((h) => (h.startsWith('.') ? u.hostname.endsWith(h) : u.hostname === h));
}

function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function vapidSigner({ publicKey, privateKey }, subject) {
  const p = unb64u(publicKey);
  const key = crypto.createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', x: b64u(p.subarray(1, 33)), y: b64u(p.subarray(33, 65)), d: privateKey },
  });
  return (endpoint) => {
    const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const body = b64u(JSON.stringify({
      aud: new URL(endpoint).origin,
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: subject,
    }));
    const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
    return `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey}`;
  };
}

function encrypt(keys, payload) {
  const uaPublic = unb64u(keys.p256dh);
  const authSecret = unb64u(keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = crypto.randomBytes(16);
  const hkdf = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
  const ikm = hkdf(shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]); // 0x02 = last record
  const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, ct]);
}

function validKeys(keys) {
  try {
    return unb64u(keys.p256dh).length === 65 && unb64u(keys.auth).length === 16;
  } catch { return false; }
}

// Returns {status, ok, gone}. gone = the subscription is dead and should be dropped.
async function send(sub, payload, sign, { ttl = 3600, urgency = 'high' } = {}) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: String(ttl),
      Urgency: urgency,
      Authorization: sign(sub.endpoint),
    },
    body: encrypt(sub.keys, JSON.stringify(payload)),
    signal: AbortSignal.timeout(15000),
  });
  const text = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 200);
  return { status: res.status, ok: res.ok, gone: res.status === 404 || res.status === 410, text };
}

module.exports = { b64u, unb64u, endpointAllowed, generateVapidKeys, vapidSigner, encrypt, validKeys, send };
