import { StyleSheet } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

export const ms = StyleSheet.create({
  tabContent: { padding: 16, gap: 12, paddingBottom: 100 },
  section: {
    backgroundColor: "#fff", borderRadius: 18, padding: 16, gap: 12,
    shadowColor: "#00000010", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1, shadowRadius: 6, elevation: 2,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },

  saveBtn: { height: 50, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  saveBtnText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
  outlineBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5 },
  outlineBtnText: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  infoRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  infoLabel: { width: 90, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  infoValue: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },

  fieldLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 4 },
  weekBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, alignItems: "center" },
  weekBtnText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  warnBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F9DEDA", padding: 12, borderRadius: 12 },
  classChip: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1.5, gap: 10 },
  className: { fontSize: 14, fontFamily: "Pretendard-Regular" },

  connCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14 },
  connStatus: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  inviteBox: { marginTop: 12, gap: 8 },
  inviteCode: { fontSize: 22, fontFamily: "Pretendard-Regular", letterSpacing: 3 },

  logRow: { paddingVertical: 12 },
  logDot: { width: 28, height: 28, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 2 },
  logDotInner: { width: 10, height: 10, borderRadius: 5 },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusBadgeLg: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  statusBadgeLgText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  changeStatusBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: C.tint },
  changeStatusText: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  restoreBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F3E8FF", padding: 14, borderRadius: 14 },
  restoreText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#7C3AED", flex: 1 },

  infoCard: { borderRadius: 16, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2, borderWidth: 1, borderColor: C.border },
});
