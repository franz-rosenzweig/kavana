#!/usr/bin/env node
'use strict';
// End-to-end check of lib/push.js against a real push service (Mozilla autopush).
// Acts as the browser: registers a channel bound to our VAPID key, receives the push over
// the autopush WebSocket, decrypts it with the "browser" keys and compares the payload.
// Usage: node tools/push-e2e.js [vapid.json]   (default: a throwaway key pair)
const crypto = require('node:crypto');
const fs = require('node:fs');
const push = require('../lib/push');

const vapid = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : push.generateVapidKeys();
const sign = push.vapidSigner(vapid, 'https://stuffs.tiresia.xyz/kavana/');

function decrypt(body, ua, auth) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const shared = ua.computeSecret(asPublic);
  const hkdf = (ikm, s, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, len));
  const ikm = hkdf(shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString();
}

const ua = crypto.createECDH('prime256v1');
ua.generateKeys();
const auth = crypto.randomBytes(16);
const channelID = crypto.randomUUID();
const payload = { kind: 'test', title: 'Kavana', body: 'e2e ' + Date.now() };

const ws = new WebSocket('wss://push.services.mozilla.com/');
const fail = (m) => { console.error('FAIL', m); process.exit(1); };
setTimeout(() => fail('timed out'), 30000);
ws.onerror = (e) => fail('websocket ' + (e.message || e.type));
ws.onopen = () => ws.send(JSON.stringify({ messageType: 'hello', use_webpush: true, uaid: '' }));
ws.onmessage = async (ev) => {
  const m = JSON.parse(ev.data);
  if (m.messageType === 'hello') {
    ws.send(JSON.stringify({ messageType: 'register', channelID, key: vapid.publicKey }));
  } else if (m.messageType === 'register') {
    if (m.status !== 200) fail('register ' + JSON.stringify(m));
    const sub = { endpoint: m.pushEndpoint, keys: { p256dh: push.b64u(ua.getPublicKey()), auth: push.b64u(auth) } };
    console.log('endpoint allowed:', push.endpointAllowed(sub.endpoint));
    const r = await push.send(sub, payload, sign);
    console.log('send status:', r.status, r.text);
    if (!r.ok) fail('push service refused the send');
  } else if (m.messageType === 'notification') {
    ws.send(JSON.stringify({ messageType: 'ack', updates: [{ channelID: m.channelID, version: m.version }] }));
    const got = decrypt(Buffer.from(m.data, 'base64url'), ua, auth);
    if (got !== JSON.stringify(payload)) fail('payload mismatch: ' + got);
    console.log('PASS received and decrypted:', got);
    process.exit(0);
  }
};
