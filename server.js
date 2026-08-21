const express = require('express');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const crypto = require('crypto');
const { enqueuePrintJob } = require('./queue-simulator');

const app = express();

// Only the webhook route needs the raw body (for signature verification).
// Everything else can use normal JSON parsing.
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static('public'));

const WEBHOOK_SECRET = process.env.PRINT_WEBHOOK_SECRET || 'solstice-dev-secret';

// Seed attendees. Status starts at 'not_checked_in'.
const attendees = new Map([
  ['ATT-001', { id: 'ATT-001', name: 'Dana Reyes', status: 'not_checked_in', jobId: null }],
  ['ATT-002', { id: 'ATT-002', name: 'Marcus Lee', status: 'not_checked_in', jobId: null }],
  ['ATT-003', { id: 'ATT-003', name: 'Priya Nair', status: 'not_checked_in', jobId: null }],
]);

// A separate lookup so a webhook arriving with only a jobId can find its attendee.
const jobToAttendee = new Map();

function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const givenBuf = Buffer.from(signatureHeader, 'utf8');
  if (expectedBuf.length !== givenBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, givenBuf);
}

// Staff scans a QR code at the kiosk.
app.post('/api/checkin', (req, res) => {
  const { attendeeId } = req.body;
  const attendee = attendees.get(attendeeId);

  if (!attendee) {
    return res.status(404).json({ error: 'Attendee not found' });
  }

  // Duplicate-scan protection, case 1: already fully checked in.
  // A second scan must not trigger a second print job.
  if (attendee.status === 'checked_in') {
    return res.json({
      attendeeId,
      status: 'checked_in',
      message: 'Already checked in - badge already printed.',
    });
  }

  // Duplicate-scan protection, case 2: a print job is already in flight
  // for this attendee. Don't queue a second one just because staff
  // scanned twice while the vendor was still processing the first.
  if (attendee.status === 'print_pending') {
    return res.json({
      attendeeId,
      status: 'pending',
      jobId: attendee.jobId,
      message: 'Print already in progress for this attendee.',
    });
  }

  // First scan for this attendee: queue the print job and move to pending.
  const jobId = crypto.randomUUID();
  attendee.status = 'print_pending';
  attendee.jobId = jobId;
  jobToAttendee.set(jobId, attendeeId);

  enqueuePrintJob({ jobId, attendeeId, secret: WEBHOOK_SECRET });

  return res.status(202).json({
    attendeeId,
    status: 'pending',
    jobId,
    message: 'Print job queued. Waiting on vendor confirmation.',
  });
});

// Vendor calls this once the badge has actually printed.
app.post('/webhooks/print-complete', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const rawBody = req.body; // Buffer, thanks to express.raw() above

  if (!verifySignature(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Malformed payload' });
  }

  const { jobId, result } = payload;
  const attendeeId = jobToAttendee.get(jobId);
  const attendee = attendeeId && attendees.get(attendeeId);

  if (!attendee) {
    // Unknown job. Ack anyway so the vendor doesn't retry forever,
    // but don't touch any state.
    return res.status(200).json({ received: true, note: 'Unknown job, ignored.' });
  }

  // Idempotency / out-of-order guard: only act if this webhook still
  // matches the job we're currently waiting on. If the attendee is
  // already checked in (e.g. this is a late duplicate delivery of a
  // confirmation we already processed), do nothing.
  if (attendee.status === 'checked_in') {
    return res.status(200).json({ received: true, note: 'Already checked in, ignoring.' });
  }
  if (attendee.jobId !== jobId) {
    return res.status(200).json({ received: true, note: 'Stale job id, ignoring.' });
  }

  if (result === 'success') {
    attendee.status = 'checked_in';
  } else {
    // Failed print: back out to not_checked_in so staff can retry the scan.
    attendee.status = 'not_checked_in';
    attendee.jobId = null;
  }

  return res.status(200).json({ received: true });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/api/attendees', (req, res) => {
  res.json(Array.from(attendees.values()));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Solstice kiosk service listening on port ${PORT}`);
});

module.exports = app;
