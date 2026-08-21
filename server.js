const express = require('express');
const crypto = require('crypto');
const app = express();

app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json());

const WEBHOOK_SECRET = process.env.PRINT_WEBHOOK_SECRET || 'solstice-dev-secret';

// In-memory state for Vercel (Holds the 3 test attendees required)
let attendees = new Map([
  ['ATT-001', { id: 'ATT-001', name: 'Dana Reyes', status: 'not_checked_in', jobId: null }],
  ['ATT-002', { id: 'ATT-002', name: 'Marcus Lee', status: 'not_checked_in', jobId: null }],
  ['ATT-003', { id: 'ATT-003', name: 'Priya Nair', status: 'not_checked_in', jobId: null }],
]);
const jobToAttendee = new Map();

function verifySignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const givenBuf = Buffer.from(signatureHeader, 'utf8');
  if (expectedBuf.length !== givenBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, givenBuf);
}

// Route 1: Get attendee state
app.get('/api/attendees', (req, res) => {
  res.json(Array.from(attendees.values()));
});

// Route 2: Staff scans a badge
app.post('/api/checkin', (req, res) => {
  const { attendeeId } = req.body;
  const attendee = attendees.get(attendeeId);

  if (!attendee) return res.status(404).json({ error: 'Attendee not found' });

  // Pivot Requirement: Duplicate-scan protection
  if (attendee.status === 'checked_in') {
    return res.json({ attendeeId, status: 'checked_in', message: 'Already checked in - badge already printed.' });
  }
  if (attendee.status === 'print_pending') {
    return res.json({ attendeeId, status: 'pending', jobId: attendee.jobId, message: 'Print already in progress for this attendee.' });
  }

  // First scan: Generate Job ID and flip to Pending
  const jobId = crypto.randomUUID();
  attendee.status = 'print_pending';
  attendee.jobId = jobId;
  jobToAttendee.set(jobId, attendeeId);

  return res.status(202).json({
    attendeeId, status: 'pending', jobId, message: 'Print job queued. Waiting on vendor confirmation.'
  });
});

// Route 3: Vendor callback webhook
app.post('/webhooks/print-complete', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const rawBody = req.body; 

  if (!verifySignature(rawBody, signature)) return res.status(401).json({ error: 'Invalid signature' });

  const { jobId, result } = JSON.parse(rawBody.toString('utf8'));
  const attendeeId = jobToAttendee.get(jobId);
  const attendee = attendees.get(attendeeId);

  if (!attendee || attendee.status === 'checked_in' || attendee.jobId !== jobId) {
    return res.status(200).json({ received: true, note: 'Stale or duplicate job, ignoring.' });
  }

  if (result === 'success') {
    attendee.status = 'checked_in';
  } else {
    attendee.status = 'not_checked_in';
    attendee.jobId = null;
  }
  return res.status(200).json({ received: true });
});

module.exports = app;
