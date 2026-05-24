import { db, type Patient, type Payment, type PaymentStatus } from "@/lib/db";

/** Split full name into first / last. Last token = lastName, rest = firstName. */
export function splitFullName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const lastName = parts.pop()!;
  return { firstName: parts.join(" "), lastName };
}

export function joinFullName(p: Pick<Patient, "firstName" | "lastName">): string {
  return `${p.firstName || ""} ${p.lastName || ""}`.trim();
}

export function ageFromDob(dob?: string): number | undefined {
  if (!dob) return undefined;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return undefined;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a >= 0 ? a : undefined;
}

export function dobFromAge(years: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
  return d.toISOString().slice(0, 10);
}

export function computeBMI(weightKg?: number, heightCm?: number): number | undefined {
  if (!weightKg || !heightCm) return undefined;
  const m = heightCm / 100;
  if (m <= 0) return undefined;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export async function getPatientPayments(patientId: number): Promise<Payment[]> {
  return db.payments.where("patientId").equals(patientId).reverse().toArray();
}

export function paymentBalance(p: Payment): number {
  return Math.max(0, (p.amountDue || 0) - (p.amountPaid || 0));
}

export async function patientPaymentSummary(patientId: number): Promise<{ status: PaymentStatus; balance: number }> {
  const all = await getPatientPayments(patientId);
  if (all.length === 0) return { status: "paid", balance: 0 };
  const balance = all.reduce((s, p) => s + paymentBalance(p), 0);
  if (balance <= 0) return { status: "paid", balance: 0 };
  const totalDue = all.reduce((s, p) => s + (p.amountDue || 0), 0);
  const totalPaid = all.reduce((s, p) => s + (p.amountPaid || 0), 0);
  if (totalPaid <= 0) return { status: "unpaid", balance };
  return totalPaid < totalDue ? { status: "partial", balance } : { status: "paid", balance };
}

export function paymentBadgeEmoji(status: PaymentStatus): string {
  return status === "paid" ? "🟢" : status === "partial" ? "🟡" : "🔴";
}

export function hasFatalAllergy(p?: Patient | null): boolean {
  return !!p?.antecedents?.allergies?.some(a => a.severity === "fatal");
}
