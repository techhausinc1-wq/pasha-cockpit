// Shared "tell a worker something" primitive -- Cockpit plan Phase 3.
// Looks up the real phone on a real user record (Phase 2's roster) and
// sends over WhatsApp. Fails soft by design: a missing phone, an
// unconfigured WhatsApp account, or a send error all return a reason
// instead of throwing, so a caller (delivery assignment, a complaint
// forward) never has its own write blocked by a notification failing --
// same pattern as the existing notifyCustomerOfDelivery in main.ts.

import { getUserById } from "./auth.ts";
import { sendWhatsAppText } from "./whatsapp.ts";

export interface NotifyResult {
  ok: boolean;
  reason?: "user_not_found" | "no_phone_on_file" | "send_failed";
  detail?: string;
}

export async function notifyWorker(userId: string, message: string): Promise<NotifyResult> {
  try {
    const user = await getUserById(userId);
    if (!user) return { ok: false, reason: "user_not_found" };
    if (!user.phone) return { ok: false, reason: "no_phone_on_file" };
    const result = await sendWhatsAppText(user.phone, message);
    if (!result.ok) return { ok: false, reason: "send_failed", detail: result.error };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "send_failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
