'use strict';
// Chataltul's few emails (sign-in codes), sent through an SMTP server: here Proton Mail Bridge on this
// machine. No dependencies: SMTP with STARTTLS and AUTH PLAIN, one message per connection.
//
// Where it sends, from mail.json in the state directory (mode 600, never in git):
//   { "host": "127.0.0.1", "port": 1025, "user": "...", "pass": "...", "from": "Chataltul <support@example.com>" }
// No mail.json means no email: the app offers names and passwords only.
// KAVANA_MAIL=outbox writes each message to outbox.jsonl in the state directory instead (tests, walks).
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LOCAL = new Set(['127.0.0.1', '::1', 'localhost']);

// Reads SMTP replies off a socket: each read() resolves with the next complete reply.
function replies(sock) {
  let buf = '';
  const ready = [];
  const waiting = [];
  const pump = () => {
    for (;;) {
      const m = /(?:^|\r\n)(\d{3}) [^\r\n]*\r\n/.exec(buf);
      if (!m) return;
      const end = m.index + m[0].length;
      const reply = { code: Number(m[1]), text: buf.slice(0, end).trim() };
      buf = buf.slice(end);
      if (waiting.length) waiting.shift().ok(reply); else ready.push(reply);
    }
  };
  const onData = (c) => { buf += c.toString('utf8'); pump(); };
  const onEnd = (e) => { while (waiting.length) waiting.shift().no(e || new Error('smtp closed')); };
  sock.on('data', onData);
  sock.on('error', onEnd);
  sock.on('close', () => onEnd());
  return {
    read: () => (ready.length ? Promise.resolve(ready.shift()) : new Promise((ok, no) => waiting.push({ ok, no }))),
    detach: () => { sock.off('data', onData); sock.off('error', onEnd); sock.removeAllListeners('close'); },
  };
}

async function step(io, sock, line, want) {
  if (line !== null) sock.write(line + '\r\n');
  const r = await io.read();
  if (![].concat(want).includes(r.code)) {
    const shown = line && line.startsWith('AUTH') ? 'AUTH' : line;
    throw Object.assign(new Error(`smtp ${shown || 'greeting'}: ${r.text.slice(0, 200)}`), { code: r.code });
  }
  return r;
}

const addrOf = (from) => (/<([^>]+)>/.exec(from) || [null, from])[1];
const header = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);

function message(from, to, subject, text) {
  const body = Buffer.from(text.replace(/\r?\n/g, '\r\n')).toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${from}`, `To: ${to}`, `Subject: ${header(subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${addrOf(from).split('@')[1]}>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64',
    '', body,
  ].join('\r\n');
}

async function smtp(cfg, to, subject, text) {
  let sock = net.connect(cfg.port || 25, cfg.host || '127.0.0.1');
  sock.setTimeout(20000, () => sock.destroy(new Error('smtp timeout')));
  let io = replies(sock);
  try {
    await step(io, sock, null, 220);
    await step(io, sock, 'EHLO kavana', 250);
    // STARTTLS always. Bridge's certificate is its own, which is fine on this machine and nowhere else.
    await step(io, sock, 'STARTTLS', 220);
    io.detach();
    const host = cfg.host || '127.0.0.1';
    const t = tls.connect({ socket: sock, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: !LOCAL.has(host) });
    await new Promise((ok, no) => { t.once('secureConnect', ok); t.once('error', no); });
    sock = t;
    sock.setTimeout(20000, () => sock.destroy(new Error('smtp timeout')));
    io = replies(sock);
    await step(io, sock, 'EHLO kavana', 250);
    await step(io, sock, 'AUTH PLAIN ' + Buffer.from(`\0${cfg.user}\0${cfg.pass}`).toString('base64'), 235);
    await step(io, sock, `MAIL FROM:<${addrOf(cfg.from)}>`, 250);
    await step(io, sock, `RCPT TO:<${to}>`, [250, 251]);
    await step(io, sock, 'DATA', 354);
    // base64 lines never start with a dot, so the message needs no dot-stuffing.
    await step(io, sock, message(cfg.from, to, subject, text) + '\r\n.', 250);
    sock.write('QUIT\r\n');
  } finally {
    sock.end();
  }
}

// mailer(dir) -> { on, send(to, subject, text) } for this server's state directory.
function mailer(dir) {
  if (process.env.KAVANA_MAIL === 'outbox') {
    const file = path.join(dir, 'outbox.jsonl');
    return {
      on: true,
      send: async (to, subject, text) => { fs.appendFileSync(file, JSON.stringify({ to, subject, text, at: Date.now() }) + '\n', { mode: 0o600 }); },
    };
  }
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(path.join(dir, 'mail.json'), 'utf8')); } catch {}
  if (!cfg || !cfg.user || !cfg.pass || !cfg.from) return { on: false, send: async () => { throw new Error('no mail'); } };
  return { on: true, send: (to, subject, text) => smtp(cfg, to, subject, text) };
}

// An address we'll send to: one line, no spaces or brackets, a dot in the domain.
const cleanEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => e.length <= 254 && /^[^\s@<>()[\]",;:\\]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(e);

module.exports = { mailer, cleanEmail, validEmail };
