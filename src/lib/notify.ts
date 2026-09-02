export async function notifySlack(text: string) {
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export async function notifyEmail(subject: string, html: string) {
  const key = process.env.RESEND_API_KEY?.trim();
  const to = process.env.ALERT_TO_EMAIL?.trim();
  const from = process.env.ALERT_FROM_EMAIL?.trim() || "calendar-monitor@stateaffairs.com";
  if (!key || !to) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
}

export function formatGapAlert(opts: {
  kind: "new_official" | "missing_on_sa";
  state: string;
  title: string;
  start: string;
  url?: string;
}): { slack: string; subject: string; html: string } {
  const label = opts.kind === "missing_on_sa" ? "Missing on State Affairs" : "New official calendar event";
  const when = opts.start.slice(0, 16).replace("T", " ");
  const link = opts.url ? ` <${opts.url}>` : "";
  const slack = `[${opts.state}] ${label}: ${opts.title} (${when})${link}`;
  const subject = `[${opts.state}] ${label}: ${opts.title}`;
  const html = `<p><strong>${label}</strong> in <strong>${opts.state}</strong></p>
<p>${escapeHtml(opts.title)}</p>
<p>${escapeHtml(when)}</p>
${opts.url ? `<p><a href="${escapeHtml(opts.url)}">${escapeHtml(opts.url)}</a></p>` : ""}`;
  return { slack, subject, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
