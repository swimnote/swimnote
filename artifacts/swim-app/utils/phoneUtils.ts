import { Linking } from "react-native";

export const CALL_COLOR = "#F97316";

export function callPhone(phone: string | null | undefined) {
  if (!phone) return;
  const cleaned = phone.replace(/[^0-9]/g, "");
  if (!cleaned) return;
  Linking.openURL(`tel:${cleaned}`).catch(() => {});
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const cleaned = phone.replace(/[^0-9]/g, "");
  if (cleaned.length === 11) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  if (cleaned.length === 10) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  return phone;
}
