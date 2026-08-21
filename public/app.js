const listEl = document.getElementById('list');

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
    row.innerHTML = `
      <div>
        <strong>${a.name}</strong> <span style="color:#888">(${a.id})</span>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <span class="status ${a.status}">${labelFor(a.status)}</span>
        <button data-id="${a.id}">Scan</button>
      </div>
    `;
    listEl.appendChild(row);
  });

  listEl.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => scan(btn.dataset.id));
  });
}

async function scan(attendeeId) {
  await fetch('/api/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attendeeId }),
  });
  loadAttendees();
}

// Poll every second so pending -> checked_in shows up once the webhook lands.
setInterval(loadAttendees, 1000);
loadAttendees();
