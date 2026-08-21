const listEl = document.getElementById('list');
const logsEl = document.getElementById('logs');
const WEBHOOK_SECRET = 'solstice-dev-secret';

function logEvent(msg) {
  logsEl.innerHTML += `> ${msg}<br>`;
  logsEl.scrollTop = logsEl.scrollHeight;
}

function labelFor(status) {
  if (status === 'checked_in') return 'Checked In';
  if (status === 'print_pending') return 'Printing...';
  return 'Not Checked In';
}

async function loadAttendees() {
  const res = await fetch('/api/attendees');
  const attendees = await res.json();
  render(attendees);
}

function render(attendees) {
  listEl.innerHTML = '';
  attendees.forEach((a) => {
    const row = document.createElement('div');
    row.className = 'row';
    const disableBtn = a.status === 'checked_in' ? 'disabled' : '';
    row.innerHTML = `
      <div>
        <strong style="font-size: 1.1rem; color: #111827;">${a.name}</strong> <br>
        <span style="color:#6b7280; font-size: 0.9rem;">ID: ${a.id}</span>
      </div>
      <div style="display:flex; align-items:center; gap:16px;">
        <span class="status ${a.status}">${labelFor(a.status)}</span>
        <button data-id="${a.id}" ${disableBtn}>Scan Badge</button>
      </div>
    `;
    listEl.appendChild(row);
  });

  listEl.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => scan(btn.dataset.id));
  });
}

// 1. Staff scans a badge
async function scan(attendeeId) {
  logEvent(`SCAN: Attempting check-in for ${attendeeId}`);
  const res = await fetch('/api/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attendeeId }),
  });
  
  const data = await res.json();
  
  // Pivot Guard: Block duplicate scans if pending or completed
  if (data.status === 'checked_in' || data.message.includes('already in progress')) {
    logEvent(`REJECTED: ${data.message}`);
    return;
  }

  logEvent(`QUEUED: Print job ${data.jobId} created. Waiting on vendor callback...`);
  loadAttendees(); // UI flips to Pending

  // Simulate vendor's async queue delay (2 to 5 seconds)
  const delay = Math.floor(Math.random() * 3000) + 2000;
  setTimeout(() => simulateVendorWebhook(data.jobId, attendeeId), delay);
}

// 2. Vendor queue simulator (fires webhook callback)
async function simulateVendorWebhook(jobId, attendeeId) {
  logEvent(`VENDOR: Firing webhook for job ${jobId}...`);
  
  const payload = JSON.stringify({ jobId, attendeeId, result: 'success' });
  const signature = CryptoJS.HmacSHA256(payload, WEBHOOK_SECRET).toString(CryptoJS.enc.Hex);

  const res = await fetch('/webhooks/print-complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-signature': signature,
    },
    body: payload,
  });

  if (res.ok) {
    logEvent(`SUCCESS: Webhook verified. ${attendeeId} is now Checked In!`);
    loadAttendees(); // UI flips to Checked In
  }
}

// Initial load
loadAttendees();
