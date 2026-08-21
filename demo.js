const BASE = 'http://localhost:3000';

async function checkin(attendeeId) {
  const res = await fetch(`${BASE}/api/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attendeeId }),
  });
  const body = await res.json();
  console.log(`Scan ${attendeeId} ->`, body);
  return body;
}

async function status() {
  const res = await fetch(`${BASE}/api/attendees`);
  return res.json();
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  console.log('--- Scanning three attendees ---');
  await checkin('ATT-001');
  await checkin('ATT-002');
  await checkin('ATT-003');

  console.log('\n--- Duplicate scan while ATT-001 is still pending ---');
  await checkin('ATT-001'); // should say "already in progress", no second job

  console.log('\n--- Waiting for webhook confirmations to arrive ---');
  await wait(3500);

  const afterFirstRound = await status();
  console.log('Status after confirmations:', afterFirstRound);

  console.log('\n--- Duplicate scan after ATT-001 is fully checked in ---');
  await checkin('ATT-001'); // should say "already checked in", no print at all

  const finalState = await status();
  console.log('\nFinal state:', finalState);
})();
