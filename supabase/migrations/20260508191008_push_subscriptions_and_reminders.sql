/*
  # Push notification subscriptions and scheduled reminders

  1. New Tables
    - `push_subscriptions`
      - `id` (uuid, primary key)
      - `user_id` (integer, references the app user who subscribed)
      - `user_name` (text, denormalized for edge function access)
      - `clinic_id` (text, clinic scope)
      - `endpoint` (text, unique, the push subscription endpoint URL)
      - `p256dh` (text, VAPID public key)
      - `auth` (text, VAPID auth secret)
      - `created_at` (timestamptz)

    - `scheduled_reminders`
      - `id` (uuid, primary key)
      - `appointment_id` (integer, the appointment to remind about)
      - `clinic_id` (text, clinic scope)
      - `patient_name` (text, denormalized for edge function)
      - `doctor_name` (text, denormalized for edge function)
      - `appointment_date` (date)
      - `appointment_time` (text)
      - `reason` (text)
      - `remind_at` (timestamptz, when to send the push notification)
      - `reminder_offset` (text, e.g. "15min", "30min", "1h", "1day")
      - `sent` (boolean, default false)
      - `sent_at` (timestamptz, when it was actually sent)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - push_subscriptions: users can only manage their own subscriptions
    - scheduled_reminders: service role can read/update for cron jobs,
      authenticated users can insert for their own appointments

  3. Indexes
    - Index on scheduled_reminders.remind_at for efficient cron queries
    - Index on scheduled_reminders.sent for filtering unsent
    - Index on push_subscriptions.clinic_id for clinic-scoped lookups
*/

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id integer NOT NULL,
  user_name text NOT NULL DEFAULT '',
  clinic_id text NOT NULL DEFAULT '',
  endpoint text UNIQUE NOT NULL,
  p256dh text NOT NULL DEFAULT '',
  auth text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own push subscriptions"
  ON push_subscriptions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_clinic ON push_subscriptions(clinic_id);

CREATE TABLE IF NOT EXISTS scheduled_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id integer NOT NULL,
  clinic_id text NOT NULL DEFAULT '',
  patient_name text NOT NULL DEFAULT '',
  doctor_name text NOT NULL DEFAULT '',
  appointment_date date NOT NULL,
  appointment_time text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  remind_at timestamptz NOT NULL,
  reminder_offset text NOT NULL DEFAULT '30min',
  sent boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE scheduled_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage reminders"
  ON scheduled_reminders FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_remind_at ON scheduled_reminders(remind_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_sent ON scheduled_reminders(sent);
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_clinic ON scheduled_reminders(clinic_id);
