const crypto = require('crypto');

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhooks/print-complete';

function sign(payloadString, secret) {
  return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
}

/**
 * Simulates handing a print job to the vendor's queue. In reality this
 * would be a message published to something like SQS or RabbitMQ; here
 * it's just a delayed callback so we can exercise the webhook path
 * without a real vendor integration.
 *
 * delayMs is randomized on purpose - the pivot explicitly says
 * confirmations may now arrive out of order, so two jobs queued back
 * to back are not guaranteed to resolve in the order they were sent.
 */
function enqueuePrintJob({ jobId, attendeeId, secret, delayMs, forceResult }) {
  const delay = delayMs ?? Math.floor(300 + Math.random() * 2000);
  const result = forceResult || 'success';

  setTimeout(async () => {
    const payload = JSON.stringify({ jobId, attendeeId, result });
    const signature = sign(payload, secret);

    try {
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-signature': signature,
        },
        body: payload,
      });
    } catch (err) {
      console.error(`Webhook delivery failed for job ${jobId}:`, err.message);
    }
  }, delay);
}

module.exports = { enqueuePrintJob };
