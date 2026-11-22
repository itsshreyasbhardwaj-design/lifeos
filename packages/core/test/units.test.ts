import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createDecipheriv, createHmac, generateKeyPairSync, verify, createPublicKey } from 'node:crypto';
import { zonedToUtc, localParts, inQuietHours, quietHoursEnd, tzOffsetMs } from '../src/time.ts';
import { occurrences, nextOccurrence, occurrencesBetween } from '../src/recurrence.ts';
import { parseIcs, toIcs } from '../src/ics.ts';
import { zip, crc32 } from '../src/zip.ts';
import { sniff, validateUpload, safeName } from '../src/files.ts';
import { isBlockedAddress, assertPublicUrl, htmlToText } from '../src/urlfetch.ts';
import { totp, verifyTotp, newTotpSecret, encryptBlob, decryptBlob, hashPassword, verifyPassword } from '../src/crypto.ts';
import { encryptPayload, vapidJwt, vapidKeys, assertPushEndpoint } from '../src/push.ts';
import { sanitiseProps } from '../src/privacy.ts';
import { monthlyEquivalent, advance } from '../src/commitments.ts';
import './helpers.ts';

test('IST conversion', () => {
  assert.equal(zonedToUtc('2026-11-22', '09:00', 'Asia/Kolkata').toISOString(), '2026-11-22T03:30:00.000Z');
  assert.deepEqual(localParts(new Date('2026-11-22T18:45:00Z'), 'Asia/Kolkata'), { date: '2026-11-23', time: '00:15' });
});

test('DST: 09:00 stays 09:00 local across the spring-forward and fall-back transitions', () => {
  // New York: EST (-5) before 8 Mar 2026, EDT (-4) after; back on 1 Nov 2026.
  assert.equal(zonedToUtc('2026-03-07', '09:00', 'America/New_York').toISOString(), '2026-03-07T14:00:00.000Z');
  assert.equal(zonedToUtc('2026-03-09', '09:00', 'America/New_York').toISOString(), '2026-03-09T13:00:00.000Z');
  assert.equal(zonedToUtc('2026-11-02', '09:00', 'America/New_York').toISOString(), '2026-11-02T14:00:00.000Z');
});

test('DST gap moves forward, overlap takes the earlier instant', () => {
  // 02:30 does not exist on 8 Mar 2026 in New York.
  assert.equal(zonedToUtc('2026-03-08', '02:30', 'America/New_York').toISOString(), '2026-03-08T07:30:00.000Z');
  assert.equal(localParts(zonedToUtc('2026-03-08', '02:30', 'America/New_York'), 'America/New_York').time, '03:30');
  // 01:30 happens twice on 1 Nov 2026; first is EDT (05:30Z).
  assert.equal(zonedToUtc('2026-11-01', '01:30', 'America/New_York').toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(tzOffsetMs(new Date('2026-07-01T00:00:00Z'), 'Europe/London'), 3_600_000);
});

test('quiet hours wrap past midnight', () => {
  const tz = 'Asia/Kolkata';
  assert.equal(inQuietHours(new Date('2026-11-22T17:00:00Z'), tz, '22:00', '07:00'), true); // 22:30 IST
  assert.equal(inQuietHours(new Date('2026-11-22T06:30:00Z'), tz, '22:00', '07:00'), false); // 12:00 IST
  assert.equal(quietHoursEnd(new Date('2026-11-22T17:00:00Z'), tz, '07:00').toISOString(), '2026-11-23T01:30:00.000Z');
});

test('recurrence: weekly, monthly clamp, yearly leap day, count and until', () => {
  assert.deepEqual([...occurrences({ freq: 'weekly', interval: 1, byWeekday: [0, 3], count: 4 }, '2026-11-23')], ['2026-11-23', '2026-11-26', '2026-11-30', '2026-12-03']);
  assert.deepEqual(occurrencesBetween({ freq: 'monthly', interval: 1, byMonthDay: 31 }, '2026-01-31', '2026-01-01', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(occurrencesBetween({ freq: 'yearly', interval: 1 }, '2028-02-29', '2028-01-01', '2030-12-31'), ['2028-02-29', '2029-02-28', '2030-02-28']);
  assert.equal(nextOccurrence({ freq: 'daily', interval: 1, until: '2026-11-25' }, '2026-11-22', '2026-11-25'), null);
  assert.equal(nextOccurrence({ freq: 'weekly', interval: 2 }, '2026-11-22', '2026-11-22'), '2026-12-06');
  assert.equal(nextOccurrence({ freq: 'monthly', interval: 3 }, '2026-01-15', '2026-01-15'), '2026-04-15');
});

test('ICS round trip, all-day exclusivity, TZID, unsupported rules reported', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:a1', 'DTSTART;TZID=Asia/Kolkata:20261201T100000', 'DTEND;TZID=Asia/Kolkata:20261201T113000',
    'SUMMARY:Dentist\\, Dr. Rao', 'LOCATION:Indiranagar', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:a2', 'DTSTART;VALUE=DATE:20261224', 'DTEND;VALUE=DATE:20261226', 'SUMMARY:Holiday', 'RRULE:FREQ=YEARLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:a3', 'DTSTART:20261205T043000Z', 'SUMMARY:Stand-up', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'EXDATE:20261210T043000Z', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const { events } = parseIcs(ics, 'Asia/Kolkata');
  assert.equal(events.length, 3);
  assert.equal(events[0]!.title, 'Dentist, Dr. Rao');
  assert.equal(events[0]!.startsAt!.toISOString(), '2026-12-01T04:30:00.000Z');
  assert.equal(events[1]!.endDate, '2026-12-25', 'DTEND is exclusive for all-day');
  assert.deepEqual(events[1]!.recurrence, { freq: 'yearly', interval: 1 });
  assert.equal(events[2]!.recurrence, null);
  assert.ok(events[2]!.warnings.length >= 2);
  const out = toIcs([{ id: 'evt_1', title: 'Long title, with; specials', allDay: false, startsAt: new Date('2026-12-01T04:30:00Z'), endsAt: new Date('2026-12-01T05:30:00Z'), recurrence: { freq: 'weekly', interval: 1, byWeekday: [0, 2] } }]);
  assert.match(out, /SUMMARY:Long title\\, with\\; specials/);
  assert.match(out, /RRULE:FREQ=WEEKLY;BYDAY=MO,WE/);
  assert.equal(parseIcs(out, 'UTC').events[0]!.startsAt!.toISOString(), '2026-12-01T04:30:00.000Z');
});

test('zip writer produces a valid archive', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const z = zip([{ name: 'a.txt', data: Buffer.from('hello') }]);
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50);
});

test('upload validation: magic bytes decide, HTML and executables refused', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
  assert.equal(sniff(png), 'image/png');
  assert.equal(validateUpload('x.png', 'image/png', png).mimeType, 'image/png');
  assert.throws(() => validateUpload('x.png', 'image/png', Buffer.from('<html><script>alert(1)</script></html>')), /not supported/);
  assert.throws(() => validateUpload('a.exe', 'application/octet-stream', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100, 0)])), /not supported/);
  assert.throws(() => validateUpload('a.pdf', 'application/pdf', png), /do not match/);
  assert.throws(() => validateUpload('x.svg', 'image/svg+xml', Buffer.from('<svg onload="x"></svg>')), /not supported/);
  assert.equal(safeName('../../etc/passwd'), 'passwd');
});

test('SSRF guard blocks private, loopback, link-local, metadata and mapped addresses', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(isBlockedAddress(ip), true, ip);
  assert.equal(isBlockedAddress('93.184.216.34'), false);
  const resolver = async (h: string) => (h === 'evil.test' ? [{ address: '10.0.0.7', family: 4 }] : [{ address: '93.184.216.34', family: 4 }]);
  await assert.rejects(assertPublicUrl('http://evil.test/x', resolver), /Private network/);
  await assert.rejects(assertPublicUrl('http://localhost/', resolver), /Private network/);
  await assert.rejects(assertPublicUrl('file:///etc/passwd', resolver), /Only http/);
  await assert.rejects(assertPublicUrl('http://user:pw@example.com/', resolver), /credentials/);
  await assert.rejects(assertPublicUrl('http://example.com:8080/', resolver), /non-standard/);
  await assert.rejects(assertPublicUrl('http://[::1]/', resolver), /Private network/);
  assert.equal((await assertPublicUrl('https://example.com/a', resolver)).address, '93.184.216.34');
  assert.deepEqual(htmlToText('<title>T &amp; C</title><script>x</script><p>Hello</p>').title, 'T & C');
});

test('password hashing, file envelope encryption, TOTP', async () => {
  const h = await hashPassword('correct horse');
  assert.equal(await verifyPassword('correct horse', h), true);
  assert.equal(await verifyPassword('wrong', h), false);
  const blob = encryptBlob(Buffer.from('secret receipt'));
  assert.ok(!blob.includes(Buffer.from('secret receipt')));
  assert.equal(decryptBlob(blob).toString(), 'secret receipt');
  const tampered = Buffer.from(blob);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptBlob(tampered));
  // RFC 6238 test vector (SHA-1, T = 59s): 94287082 → last 6 digits 287082.
  assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000), '287082');
  const s = newTotpSecret();
  assert.equal(verifyTotp(s, totp(s, 1_000_000), 1_000_000 + 25_000), true);
  assert.equal(verifyTotp(s, '000000', 1_000_000), totp(s, 1_000_000) === '000000');
});

test('web push: aes128gcm payload decrypts with the subscriber key (independent decryptor)', () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = Buffer.from('0123456789abcdef');
  const msg = Buffer.from(JSON.stringify({ title: 'Pay rent', body: 'Due today' }));
  const enc = encryptPayload(msg, ua.getPublicKey().toString('base64url'), auth.toString('base64url'));
  // Receiver side, written from RFC 8291 §3.4 independently of the sender code.
  const salt = enc.subarray(0, 16);
  assert.equal(enc.readUInt32BE(16), 4096);
  const idlen = enc[20]!;
  const asPublic = enc.subarray(21, 21 + idlen);
  const ct = enc.subarray(21 + idlen);
  const H = (k: Buffer, d: Buffer) => createHmac('sha256', k).update(d).digest();
  const secret = ua.computeSecret(asPublic);
  const ikm = H(H(auth, secret), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = H(salt, ikm);
  const cek = H(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = H(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
  assert.deepEqual(plain.subarray(0, -1), msg);
});

test('web push: VAPID JWT verifies with the public key; endpoints restricted to push services', () => {
  const jwt = vapidJwt('https://fcm.googleapis.com/fcm/send/abc');
  const [h, c, s] = jwt.split('.') as [string, string, string];
  const raw = Buffer.from(vapidKeys().publicKey, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.equal(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), true);
  assert.equal(JSON.parse(Buffer.from(c, 'base64url').toString()).aud, 'https://fcm.googleapis.com');
  assert.throws(() => assertPushEndpoint('https://169.254.169.254/latest'), /push service/);
  assert.throws(() => assertPushEndpoint('http://fcm.googleapis.com/x'), /push service/);
  void generateKeyPairSync;
});

test('analytics properties cannot carry free text', () => {
  assert.deepEqual(sanitiseProps('capture_created', { source: 'pdf', files: 2, text: 'my secret receipt', extra: 'x' }), { source: 'pdf', files: 2 });
  assert.deepEqual(sanitiseProps('candidate_confirmed', { kind: 'my lab results', edited: true }), { edited: true });
});

test('subscription arithmetic', () => {
  assert.equal(monthlyEquivalent(1_49_000, 'yearly'), 12_417);
  assert.equal(advance('2026-01-31', 'monthly'), '2026-02-28');
});
