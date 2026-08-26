/**
 * Google Chat incoming-webhook notifications — the sole notification
 * channel used by lib/notify.ts, posting events to a shared Space. Google
 * Chat webhooks are a plain authenticated-by-URL POST, no OAuth setup needed.
 *
 * This posts to one shared Space, not a DM to each user — messages name the
 * relevant person inline (e.g. "New upload from Mahesh M (mahesh.m@...)")
 * since there's no per-recipient targeting with a single webhook URL.
 */
async function postToWebhook(webhookUrl: string, text: string, context: string) {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(`Google Chat notification failed (${context}): ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`Google Chat notification failed (${context}):`, err);
  }
}

export async function notifyGChat(text: string) {
  const webhookUrl = process.env.GCHAT_WEBHOOK_URL;
  if (!webhookUrl) return; // no-op until a webhook URL is configured
  await postToWebhook(webhookUrl, text, "team space");
}

/**
 * Separate manager-only Space — action items that need a manager's
 * attention specifically (a document landed in pending_review, an
 * automatic retention cleanup ran) rather than the whole-team channel above.
 */
export async function notifyGChatManager(text: string) {
  const webhookUrl = process.env.GCHAT_MANAGER_WEBHOOK_URL;
  if (!webhookUrl) return; // no-op until a webhook URL is configured
  await postToWebhook(webhookUrl, text, "manager space");
}
