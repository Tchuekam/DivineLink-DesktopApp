import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

async function sendWebPush(
  subscription: PushSubscription,
  payload: string,
  vapidPrivateKey: string,
  vapidPublicKey: string,
  vapidSubject: string
): Promise<boolean> {
  try {
    const url = new URL(subscription.endpoint);
    const origin = url.origin;

    // Generate JWT for VAPID
    const encoder = new TextEncoder();
    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = { aud: origin, exp: now + 12 * 3600, sub: vapidSubject };
    const header = { alg: "ES256", typ: "JWT" };

    const headerB64 = base64url(encoder.encode(JSON.stringify(header)));
    const payloadB64 = base64url(encoder.encode(JSON.stringify(jwtPayload)));
    const signInput = `${headerB64}.${payloadB64}`;

    const keyData = decodeVapidPrivateKey(vapidPrivateKey);
    const key = await crypto.subtle.importKey("pkcs8", keyData, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(signInput));
    const sigB64 = base64url(new Uint8Array(signature));
    const jwt = `${signInput}.${sigB64}`;

    const encrypted = await encryptPayload(subscription.keys.auth, subscription.keys.p256dh, payload);

    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        "TTL": "86400",
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aesgcm",
        "Authorization": `vapid t=${jwt}, k=${vapidPublicKey}`,
        "Crypto-Key": `dh=${base64url(encrypted.serverPublicKey)};p256ecdsa=${vapidPublicKey}`,
      },
      body: encrypted.ciphertext,
    });

    return response.status >= 200 && response.status < 300;
  } catch (e) {
    console.error("Web Push send error:", e);
    return false;
  }
}

function base64url(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeVapidPrivateKey(base64: string): ArrayBuffer {
  const binary = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function encryptPayload(authSecret: string, p256dhKey: string, payload: string) {
  const auth = new Uint8Array(atob(authSecret.replace(/-/g, "+").replace(/_/g, "/")).split("").map(c => c.charCodeAt(0)));
  const clientKeyRaw = new Uint8Array(atob(p256dhKey.replace(/-/g, "+").replace(/_/g, "/")).split("").map(c => c.charCodeAt(0)));

  const clientKey = await crypto.subtle.importKey("raw", clientKeyRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const serverKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeyPair.publicKey));
  const sharedSecret = await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, serverKeyPair.privateKey, 256);

  const prk = await hmacSha256(auth, new Uint8Array(sharedSecret));
  const info = new TextEncoder().encode("Content-Encoding: aesgcm\0");
  const key = (await hmacSha256(prk, concat(info, new Uint8Array([0, 0, 0, 1])))).slice(0, 16);
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");
  const nonce = (await hmacSha256(prk, concat(nonceInfo, new Uint8Array([0, 0, 0, 1])))).slice(0, 12);

  const paddedPayload = new Uint8Array(payload.length + 2);
  paddedPayload[0] = 0; paddedPayload[1] = 0;
  new TextEncoder().encodeInto(payload, paddedPayload.subarray(2));

  const aesKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, paddedPayload));

  return { ciphertext, serverPublicKey };
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Read VAPID keys from app_settings table
    const { data: settings } = await supabase.from("app_settings").select("key, value").in("key", ["VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY", "VAPID_SUBJECT"]);
    const getSetting = (key: string) => settings?.find((s: any) => s.key === key)?.value || "";

    const vapidPrivateKey = getSetting("VAPID_PRIVATE_KEY");
    const vapidPublicKey = getSetting("VAPID_PUBLIC_KEY");
    const vapidSubject = getSetting("VAPID_SUBJECT") || "mailto:admin@divinelink.app";

    if (!vapidPrivateKey || !vapidPublicKey) {
      return new Response(JSON.stringify({ error: "VAPID keys not configured in app_settings" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find due reminders that haven't been sent
    const now = new Date().toISOString();
    const { data: reminders, error: fetchError } = await supabase
      .from("scheduled_reminders")
      .select("*")
      .eq("sent", false)
      .lte("remind_at", now)
      .limit(50);

    if (fetchError) {
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!reminders || reminders.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: "No due reminders" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sentCount = 0;
    const errors: string[] = [];

    for (const reminder of reminders) {
      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("*")
        .eq("clinic_id", reminder.clinic_id);

      if (!subs || subs.length === 0) continue;

      const offsetLabel: Record<string, string> = { "15min": "15 min", "30min": "30 min", "1h": "1 heure", "1day": "1 jour" };

      const payload = JSON.stringify({
        title: "DivineLink Rappel",
        body: `RDV ${reminder.patient_name} le ${reminder.appointment_date} a ${reminder.appointment_time} avec Dr. ${reminder.doctor_name}.${reminder.reason ? " Motif: " + reminder.reason : ""} (Rappel ${offsetLabel[reminder.reminder_offset] || reminder.reminder_offset})`,
        icon: "/placeholder.svg",
        badge: "/placeholder.svg",
        tag: `reminder-${reminder.appointment_id}`,
        data: { type: "appointment-reminder", appointmentId: reminder.appointment_id, date: reminder.appointment_date, time: reminder.appointment_time },
        actions: [{ action: "open", title: "Ouvrir" }, { action: "dismiss", title: "Fermer" }],
      });

      for (const sub of subs) {
        const pushSub: PushSubscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
        const ok = await sendWebPush(pushSub, payload, vapidPrivateKey, vapidPublicKey, vapidSubject);
        if (ok) sentCount++;
        else errors.push(`Failed: ${sub.endpoint.slice(0, 40)}...`);
      }

      await supabase.from("scheduled_reminders").update({ sent: true, sent_at: new Date().toISOString() }).eq("id", reminder.id);
    }

    return new Response(JSON.stringify({ sent: sentCount, errors: errors.length ? errors : undefined }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
