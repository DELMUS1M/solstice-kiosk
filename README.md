# Solstice Events - Check-In Kiosk (Post-Pivot)

## What changed and why

The original build called the badge printer's REST API directly and waited for a synchronous "yes, it printed" response before showing "Checked In." That vendor is retiring that API. The replacement model is a message queue: you hand off a print job and get a callback later, on the vendor's schedule, not yours.

That single change ripples through the whole app. "Checked In" can no longer be the immediate result of a button press - it has to be the result of a webhook arriving, possibly seconds later, possibly out of order if two jobs are in flight at once.

## How the new flow works

1. Staff scans a badge. `POST /api/checkin` looks up the attendee and, if they're not already checked in or mid-print, generates a job ID and hands it to `queue-simulator.js` (standing in for the vendor's queue).
2. The attendee's status flips to `print_pending` immediately. The kiosk UI reflects that - not "Checked In."
3. On a random delay (simulating real queue latency), the "vendor" fires a signed webhook back to `POST /webhooks/print-complete`.
4. The server verifies the signature with `crypto.timingSafeEqual` - the same timing-safe comparison from the Day 1-2 prototype - then flips the attendee to `checked_in` only if the job ID still matches what's on file for them.

## Duplicate-scan protection under async

This was the part that actually got harder. Under the old synchronous model, duplicate protection was trivial: the second call just saw "already printed" because the first call had already finished. Under the new model, a second scan can land while the first print job is still sitting in the queue, and a webhook can arrive late or - in theory - a stale one could show up after a job's already been superseded.

Two guards handle this:

- **On scan:** if the attendee is already `print_pending`, the second scan is a no-op response, not a second queued job.
- **On webhook:** the server only acts on a callback if its job ID matches the job currently on file for that attendee, and only if the attendee isn't already `checked_in`. A late or duplicate delivery just gets acknowledged and dropped.

That second guard is what actually survives out-of-order delivery - it's checking identity (is this confirmation for the job I'm still waiting on?), not just sequence.

## Scope delta (original spec -> pivot)

| | Original (sync) | Pivot (async) |
|---|---|---|
| Print call | Direct REST call, block for response | Publish job to queue, return immediately |
| "Checked In" trigger | HTTP response from print call | Webhook confirmation |
| UI state | Binary: checked in or not | Three states: not checked in / pending / checked in |
| Duplicate protection | Check status before calling | Check status before *and* validate job ID on webhook receipt |
| New surface area | none | Webhook endpoint + signature verification |
| Dropped | Synchronous print-and-wait logic | - |

Nothing from the original spec survives untouched - even the parts that "still work" (looking up an attendee, rendering a status) now sit inside a different state machine.

## Running it

```bash
npm install
node server.js
```

Open `http://localhost:3000` for the kiosk UI, or in a second terminal run:

```bash
node demo.js
```

`demo.js` scans three attendees, fires a duplicate scan mid-print (rejected, no second job), waits for webhook confirmations, then fires a duplicate scan after check-in (rejected, no print at all). Console output shows the state transitions end to end.
