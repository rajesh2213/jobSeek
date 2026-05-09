import { API_BASE_URL } from "../api";

export async function postMetaAnalyticsSync(
  token: string,
  body: {
    eventName: string;
    eventId: string;
    sourceUrl?: string;
    customData?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/analytics/meta/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    /* non-blocking */
  }
}
