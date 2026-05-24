/**
 * Push notification manager for DivineLink.
 *
 * Handles:
 * - VAPID key configuration
 * - Service worker push subscription
 * - Registering/unregistering with Supabase backend
 * - Scheduling reminders in the scheduled_reminders table
 */

const VAPID_PUBLIC_KEY = "BHBmUKtnKTEeDUBhzq7KkByTAW8wi99NU6OS0TgyOFUaTwnfePwjECIMiZLy-Rvsqqvl_cr0lY3RD4lL5_YG5ow";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64url = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64url);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

/** Check if push notifications are supported in this browser. */
export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

/** Get current push permission state. */
export function getPermissionState(): NotificationPermission {
  if (!("Notification" in window)) return "denied";
  return Notification.permission;
}

/** Request notification permission from the user. */
export async function requestPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied";
  return Notification.requestPermission();
}

/** Get the current push subscription, if any. */
export async function getSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Subscribe to push notifications. Returns the subscription or null. */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  const permission = await requestPermission();
  if (permission !== "granted") return null;

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;

  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  });

  return subscription;
}

/** Unsubscribe from push notifications. */
export async function unsubscribeFromPush(): Promise<boolean> {
  const sub = await getSubscription();
  if (!sub) return true;
  return sub.unsubscribe();
}

/** Register a push subscription with the Supabase backend. */
export async function registerSubscriptionWithBackend(sub: PushSubscription, userId: number, userName: string, clinicId: string): Promise<boolean> {
  try {
    const json = sub.toJSON();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/push-subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        action: "subscribe",
        userId,
        userName,
        clinicId,
        endpoint: sub.endpoint,
        p256dh: (json.keys as any)?.p256dh || "",
        auth: (json.keys as any)?.auth || "",
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Remove a push subscription from the backend. */
export async function unregisterSubscriptionWithBackend(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/push-subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ action: "unsubscribe", endpoint }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Schedule a reminder in the Supabase scheduled_reminders table. */
export async function scheduleReminder(params: {
  appointmentId: number;
  clinicId: string;
  patientName: string;
  doctorName: string;
  appointmentDate: string;
  appointmentTime: string;
  reason: string;
  reminderOffset: string;
}): Promise<boolean> {
  try {
    const offsets: Record<string, number> = {
      "15min": 15 * 60_000,
      "30min": 30 * 60_000,
      "1h": 3600_000,
      "1day": 86400_000,
    };

    const apptTime = new Date(`${params.appointmentDate}T${params.appointmentTime}`);
    const remindAt = new Date(apptTime.getTime() - (offsets[params.reminderOffset] || 30 * 60_000));

    // Don't schedule if the reminder time is already past
    if (remindAt.getTime() <= Date.now()) return false;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/scheduled_reminders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        appointment_id: params.appointmentId,
        clinic_id: params.clinicId,
        patient_name: params.patientName,
        doctor_name: params.doctorName,
        appointment_date: params.appointmentDate,
        appointment_time: params.appointmentTime,
        reason: params.reason,
        remind_at: remindAt.toISOString(),
        reminder_offset: params.reminderOffset,
        sent: false,
      }),
    });

    return res.ok;
  } catch {
    return false;
  }
}

/** Cancel a scheduled reminder for an appointment. */
export async function cancelReminder(appointmentId: number): Promise<boolean> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/scheduled_reminders?appointment_id=eq.${appointmentId}&sent=eq.false`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
          Prefer: "return=minimal",
        },
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Full subscribe flow: request permission, subscribe, register with backend. */
export async function enablePushNotifications(userId: number, userName: string, clinicId: string): Promise<{ success: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { success: false, error: "Push notifications not supported in this browser" };
  }

  const sub = await subscribeToPush();
  if (!sub) {
    return { success: false, error: "Permission denied or subscription failed" };
  }

  const registered = await registerSubscriptionWithBackend(sub, userId, userName, clinicId);
  if (!registered) {
    return { success: false, error: "Failed to register with server" };
  }

  return { success: true };
}

/** Full unsubscribe flow: unregister from backend, unsubscribe from push. */
export async function disablePushNotifications(): Promise<{ success: boolean }> {
  const sub = await getSubscription();
  if (sub) {
    await unregisterSubscriptionWithBackend(sub.endpoint);
    await sub.unsubscribe();
  }
  return { success: true };
}

/** Check if the user is currently subscribed to push notifications. */
export async function isSubscribed(): Promise<boolean> {
  const sub = await getSubscription();
  return sub !== null;
}
