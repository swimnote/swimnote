/**
 * (super)/curriculum-import.tsx
 *
 * SWIMNOTE X — Curriculum APP MASTER Import 화면
 *
 * 기능:
 *   - 수영장별 curriculum version 이력 조회
 *   - APP MASTER DOCX 업로드 (DocumentPicker)
 *   - 파싱 Preview (오류/경고/통계)
 *   - Import (transaction)
 *   - 활성화 / Archive
 *   - 노드 목록 조회 (paginated)
 *
 * 진입: (super)/pools.tsx → 각 pool row에서 [커리큘럼 관리] 버튼
 * 또는: (super)/dashboard → 직접 진입
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams, router } from "expo-router";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { LucideIcon } from "@/components/common/LucideIcon";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import Colors from "@/constants/colors";

const C = Colors.light;

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface CurriculumVersion {
  id: string;
  version_name: string;
  is_active: boolean;
  import_status: string;
  node_count: number;
  activated_at: string | null;
  archived_at: string | null;
  created_at: string;
  import_meta: {
    stats?: {
      level_count: number;
      node_count: number;
      drill_count: number;
      relation_count: number;
      test_node_count: number;
    };
    errors?: string[];
    warnings?: string[];
  } | null;
}

interface PreviewResult {
  version_id: string;
  version_name: string;
  import_status: string;
  meta: {
    schema_version: string;
    pool_reference: string | null;
    curriculum_release: string | null;
    version_name: string | null;
    declared_level_count: number | null;
  };
  stats: {
    level_count: number;
    node_count: number;
    drill_count: number;
    relation_count: number;
    test_node_count: number;
  };
  validation: {
    errors: string[];
    warnings: string[];
    is_valid: boolean;
  };
  levels_summary: Array<{
    level_order: number;
    level_name: string;
    node_count: number;
    drill_count: number;
    test_node_count: number;
  }>;
}

// ─── 상태 색상 ────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT:     { bg: "#E8EAF6", text: "#3949AB", label: "초안" },
  VALIDATED: { bg: "#E8F5E9", text: "#2E7D32", label: "검증됨" },
  IMPORTED:  { bg: "#FFF3E0", text: "#E65100", label: "Import 완료" },
  ACTIVE:    { bg: "#E0F2F1", text: "#00695C", label: "활성" },
  ARCHIVED:  { bg: "#F5F5F5", text: "#757575", label: "보관" },
  FAILED:    { bg: "#FFEBEE", text: "#C62828", label: "실패" },
  LEGACY:    { bg: "#F5F5F5", text: "#9E9E9E", label: "기존" },
};

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export default function CurriculumImportScreen() {
  const { token } = useAuth();
  const { pool_id, pool_name } = useLocalSearchParams<{ pool_id: string; pool_name?: string }>();

  const [versions, setVersions] = useState<CurriculumVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<CurriculumVersion | null>(null);

  const [importing, setImporting] = useState(false);
  const [activating, setActivating] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const [confirmActivate, setConfirmActivate] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);

  // ── 버전 목록 조회 ─────────────────────────────────────────────────────────

  const fetchVersions = useCallback(async () => {
    if (!pool_id) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await apiRequest(token, `/super/curriculum/pools/${pool_id}/versions`);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error((body as any)?.error ?? `오류 (${resp.status})`);
      }
      const data = await resp.json();
      setVersions(data.versions ?? []);
    } catch (e: any) {
      setError(e?.message ?? "조회 실패");
    } finally {
      setLoading(false);
    }
  }, [token, pool_id]);

  useEffect(() => { fetchVersions(); }, [fetchVersions]);

  // ── DOCX 업로드 ────────────────────────────────────────────────────────────

  const onUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setUploading(true);

      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      } as any);

      const resp = await apiRequest(
        token,
        `/super/curriculum/pools/${pool_id}/upload`,
        { method: "POST", body: formData },
      );

      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error((body as any)?.error ?? `업로드 실패 (${resp.status})`);

      await fetchVersions();
      // 자동으로 새 버전 선택 후 preview
      const newVersionId = (body as any).version_id;
      if (newVersionId) {
        const newVer = { id: newVersionId, version_name: (body as any).version_name, import_status: "DRAFT",
          is_active: false, node_count: 0, activated_at: null, archived_at: null,
          created_at: new Date().toISOString(), import_meta: null };
        setSelectedVersion(newVer as any);
        await loadPreview(newVersionId);
      }
    } catch (e: any) {
      Alert.alert("업로드 오류", e?.message ?? "알 수 없는 오류");
    } finally {
      setUploading(false);
    }
  };

  // ── Preview ────────────────────────────────────────────────────────────────

  const loadPreview = async (versionId: string) => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const resp = await apiRequest(token, `/super/curriculum/pools/${pool_id}/versions/${versionId}/preview`);
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error((body as any)?.error ?? `오류 (${resp.status})`);
      setPreview(body as PreviewResult);
    } catch (e: any) {
      Alert.alert("Preview 오류", e?.message ?? "파싱 실패");
    } finally {
      setPreviewLoading(false);
    }
  };

  // ── Import ─────────────────────────────────────────────────────────────────

  const onImport = async () => {
    if (!selectedVersion) return;
    setConfirmImport(false);
    setImporting(true);
    try {
      const resp = await apiRequest(
        token,
        `/super/curriculum/pools/${pool_id}/versions/${selectedVersion.id}/import`,
        { method: "POST" },
      );
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error((body as any)?.error ?? `Import 실패 (${resp.status})`);
      await fetchVersions();
      Alert.alert("Import 완료", `${(body as any).stats?.node_count ?? 0}개 노드가 저장되었습니다.\n[활성화] 버튼으로 ACTIVE 전환하세요.`);
    } catch (e: any) {
      Alert.alert("Import 오류", e?.message ?? "Import 실패");
    } finally {
      setImporting(false);
    }
  };

  // ── Activate ───────────────────────────────────────────────────────────────

  const onActivate = async () => {
    if (!selectedVersion) return;
    setConfirmActivate(false);
    setActivating(true);
    try {
      const resp = await apiRequest(
        token,
        `/super/curriculum/pools/${pool_id}/versions/${selectedVersion.id}/activate`,
        { method: "POST" },
      );
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error((body as any)?.error ?? `활성화 실패 (${resp.status})`);
      await fetchVersions();
      Alert.alert("활성화 완료", "커리큘럼이 활성화되었습니다.");
    } catch (e: any) {
      Alert.alert("활성화 오류", e?.message ?? "오류");
    } finally {
      setActivating(false);
    }
  };

  // ── Archive ────────────────────────────────────────────────────────────────

  const onArchive = async () => {
    if (!selectedVersion) return;
    setConfirmArchive(false);
    setArchiving(true);
    try {
      const resp = await apiRequest(
        token,
        `/super/curriculum/pools/${pool_id}/versions/${selectedVersion.id}/archive`,
        { method: "POST" },
      );
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error((body as any)?.error ?? `Archive 실패 (${resp.status})`);
      await fetchVersions();
      Alert.alert("Archive 완료", "버전이 보관 처리되었습니다.");
    } catch (e: any) {
      Alert.alert("Archive 오류", e?.message ?? "오류");
    } finally {
      setArchiving(false);
    }
  };

  // ─── 렌더: 버전 row ───────────────────────────────────────────────────────

  const renderVersionRow = ({ item }: { item: CurriculumVersion }) => {
    const st = STATUS_COLOR[item.import_status] ?? STATUS_COLOR.LEGACY;
    const isSelected = selectedVersion?.id === item.id;
    const stats = item.import_meta?.stats;

    return (
      <Pressable
        style={[s.verRow, isSelected && s.verRowSelected]}
        onPress={() => {
          setSelectedVersion(item);
          setPreview(null);
        }}
      >
        <View style={s.verLeft}>
          <Text style={s.verName}>{item.version_name}</Text>
          <View style={[s.statusChip, { backgroundColor: st.bg }]}>
            <Text style={[s.statusText, { color: st.text }]}>{st.label}</Text>
          </View>
          {stats && (
            <Text style={s.verStats}>
              L{stats.level_count} · N{stats.node_count} · D{stats.drill_count} · R{stats.relation_count}
            </Text>
          )}
        </View>
        <View style={s.verRight}>
          <Text style={s.verDate}>{item.created_at?.slice(0, 10)}</Text>
          {item.is_active && <LucideIcon name="CheckCircle2" size={16} color="#00695C" />}
        </View>
      </Pressable>
    );
  };

  // ─── 렌더: Preview 패널 ───────────────────────────────────────────────────

  const renderPreview = () => {
    if (!preview) return null;
    const { validation, stats, meta, levels_summary } = preview;

    return (
      <View style={s.previewPanel}>
        <Text style={s.panelTitle}>📋 파싱 결과</Text>

        {/* 통계 */}
        <View style={s.statRow}>
          {[
            { label: "레벨", value: stats.level_count },
            { label: "노드", value: stats.node_count },
            { label: "드릴", value: stats.drill_count },
            { label: "관계", value: stats.relation_count },
            { label: "테스트", value: stats.test_node_count },
          ].map(st => (
            <View key={st.label} style={s.statCard}>
              <Text style={s.statValue}>{st.value}</Text>
              <Text style={s.statLabel}>{st.label}</Text>
            </View>
          ))}
        </View>

        {/* 메타 */}
        <View style={s.metaSection}>
          <Text style={s.metaRow}>버전: {meta.version_name ?? "(없음)"}</Text>
          <Text style={s.metaRow}>수영장: {meta.pool_reference ?? "(없음)"}</Text>
          <Text style={s.metaRow}>릴리즈: {meta.curriculum_release ?? "(없음)"}</Text>
          <Text style={s.metaRow}>스키마: {meta.schema_version}</Text>
        </View>

        {/* 레벨별 요약 */}
        <Text style={s.sectionLabel}>레벨별 요약</Text>
        {levels_summary.map(lv => (
          <View key={lv.level_order} style={s.levelRow}>
            <Text style={s.levelName}>L{lv.level_order}: {lv.level_name}</Text>
            <Text style={s.levelDetail}>
              노드 {lv.node_count} · 드릴 {lv.drill_count} · 테스트 {lv.test_node_count}
            </Text>
          </View>
        ))}

        {/* 오류 */}
        {validation.errors.length > 0 && (
          <View style={s.errorBlock}>
            <Text style={s.errorTitle}>❌ 오류 ({validation.errors.length})</Text>
            {validation.errors.map((e, i) => (
              <Text key={i} style={s.errorItem}>• {e}</Text>
            ))}
          </View>
        )}

        {/* 경고 */}
        {validation.warnings.length > 0 && (
          <View style={s.warnBlock}>
            <Text style={s.warnTitle}>⚠️ 경고 ({validation.warnings.length})</Text>
            {validation.warnings.map((w, i) => (
              <Text key={i} style={s.warnItem}>• {w}</Text>
            ))}
          </View>
        )}

        {/* 유효 배지 */}
        <View style={[s.validBadge, { backgroundColor: validation.is_valid ? "#E0F2F1" : "#FFEBEE" }]}>
          <Text style={[s.validText, { color: validation.is_valid ? "#00695C" : "#C62828" }]}>
            {validation.is_valid ? "✅ 검증 통과 — Import 가능" : "❌ 오류 있음 — Import 불가"}
          </Text>
        </View>
      </View>
    );
  };

  // ─── 액션 버튼 ────────────────────────────────────────────────────────────

  const renderActions = () => {
    if (!selectedVersion) return null;
    const st = selectedVersion.import_status;
    const canPreview   = !!selectedVersion.id && st !== "ACTIVE" && st !== "ARCHIVED";
    const canImport    = st === "DRAFT" || st === "VALIDATED" || st === "FAILED";
    const canActivate  = st === "IMPORTED" || st === "VALIDATED";
    const canArchive   = st !== "ARCHIVED";

    return (
      <View style={s.actionBar}>
        {canPreview && (
          <TouchableOpacity style={s.actionBtn} onPress={() => loadPreview(selectedVersion.id)} disabled={previewLoading}>
            {previewLoading
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.actionBtnText}>🔍 검증</Text>
            }
          </TouchableOpacity>
        )}
        {canImport && preview?.validation.is_valid && (
          <TouchableOpacity style={[s.actionBtn, s.importBtn]} onPress={() => setConfirmImport(true)} disabled={importing}>
            {importing
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.actionBtnText}>💾 Import</Text>
            }
          </TouchableOpacity>
        )}
        {canActivate && (
          <TouchableOpacity style={[s.actionBtn, s.activateBtn]} onPress={() => setConfirmActivate(true)} disabled={activating}>
            {activating
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.actionBtnText}>⚡ 활성화</Text>
            }
          </TouchableOpacity>
        )}
        {canArchive && (
          <TouchableOpacity style={[s.actionBtn, s.archiveBtn]} onPress={() => setConfirmArchive(true)} disabled={archiving}>
            <Text style={[s.actionBtnText, { color: "#555" }]}>📦 보관</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // ─── 메인 렌더 ────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.safe}>
      <SubScreenHeader
        title={`커리큘럼 관리${pool_name ? ` — ${pool_name}` : ""}`}
        homePath="/(super)/pools"
      />

      <ScrollView contentContainerStyle={s.scroll}>

        {/* 업로드 버튼 */}
        <TouchableOpacity style={s.uploadBtn} onPress={onUpload} disabled={uploading}>
          {uploading
            ? <ActivityIndicator size="small" color="#fff" />
            : <>
                <LucideIcon name="Upload" size={16} color="#fff" />
                <Text style={s.uploadBtnText}>APP MASTER Word 업로드</Text>
              </>
          }
        </TouchableOpacity>

        {/* 버전 이력 */}
        <Text style={s.sectionTitle}>버전 이력</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 20 }} />
        ) : error ? (
          <View style={s.errorWrap}>
            <Text style={s.errorBody}>{error}</Text>
            <TouchableOpacity onPress={fetchVersions}>
              <Text style={s.retryText}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        ) : versions.length === 0 ? (
          <Text style={s.emptyText}>업로드된 커리큘럼 버전이 없습니다.</Text>
        ) : (
          <FlatList
            data={versions}
            keyExtractor={v => v.id}
            renderItem={renderVersionRow}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={s.separator} />}
          />
        )}

        {/* 선택된 버전 액션 */}
        {renderActions()}

        {/* Preview 결과 */}
        {previewLoading ? (
          <View style={s.previewLoading}>
            <ActivityIndicator />
            <Text style={s.previewLoadingText}>파싱 중...</Text>
          </View>
        ) : renderPreview()}

      </ScrollView>

      {/* 확인 모달들 */}
      <ConfirmModal
        visible={confirmImport}
        title="Import 확인"
        message={`"${selectedVersion?.version_name}" 버전을 Import합니다.\n기존 노드/드릴/관계 데이터가 이 버전에 저장됩니다.\n계속하시겠습니까?`}
        destructive={false}
        onConfirm={onImport}
        onCancel={() => setConfirmImport(false)}
      />
      <ConfirmModal
        visible={confirmActivate}
        title="활성화 확인"
        message={`"${selectedVersion?.version_name}" 버전을 ACTIVE로 설정합니다.\n기존 ACTIVE 버전은 자동으로 ARCHIVED 처리됩니다.`}
        destructive={false}
        onConfirm={onActivate}
        onCancel={() => setConfirmActivate(false)}
      />
      <ConfirmModal
        visible={confirmArchive}
        title="보관 확인"
        message={`"${selectedVersion?.version_name}" 버전을 보관 처리합니다.`}
        destructive
        onConfirm={onArchive}
        onCancel={() => setConfirmArchive(false)}
      />
    </SafeAreaView>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: C.background },
  scroll: { paddingHorizontal: 16, paddingBottom: 60 },

  uploadBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#0C1A2E", borderRadius: 12,
    paddingVertical: 14, justifyContent: "center", marginTop: 16, marginBottom: 20,
  },
  uploadBtnText: { color: "#fff", fontSize: 15, fontFamily: "Pretendard-SemiBold" },

  sectionTitle: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: C.textPrimary, marginBottom: 8 },

  verRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "#fff", borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: "#E0E0E0",
  },
  verRowSelected: { borderColor: "#0C1A2E", borderWidth: 2 },
  verLeft:  { flex: 1, gap: 4 },
  verRight: { alignItems: "flex-end", gap: 4 },
  verName:  { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textPrimary },
  verStats: { fontSize: 11, color: C.textMuted, fontFamily: "Pretendard-Regular" },
  verDate:  { fontSize: 11, color: C.textMuted, fontFamily: "Pretendard-Regular" },
  statusChip:  { alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  statusText:  { fontSize: 10, fontFamily: "Pretendard-Medium" },
  separator:   { height: 6 },

  actionBar: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16, marginBottom: 8 },
  actionBtn:     { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: "#334155" },
  importBtn:     { backgroundColor: "#1565C0" },
  activateBtn:   { backgroundColor: "#00695C" },
  archiveBtn:    { backgroundColor: "#E0E0E0" },
  actionBtnText: { color: "#fff", fontSize: 13, fontFamily: "Pretendard-SemiBold" },

  previewLoading:     { alignItems: "center", gap: 8, paddingVertical: 20 },
  previewLoadingText: { fontSize: 13, color: C.textMuted },

  previewPanel: {
    backgroundColor: "#fff", borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: "#E0E0E0", marginTop: 8, gap: 10,
  },
  panelTitle: { fontSize: 15, fontFamily: "Pretendard-Bold", color: C.textPrimary },

  statRow:   { flexDirection: "row", gap: 6 },
  statCard:  { flex: 1, backgroundColor: "#F5F5F5", borderRadius: 8, padding: 8, alignItems: "center" },
  statValue: { fontSize: 18, fontFamily: "Pretendard-Bold", color: C.textPrimary },
  statLabel: { fontSize: 10, color: C.textMuted, fontFamily: "Pretendard-Regular" },

  metaSection: { backgroundColor: "#F8F9FA", borderRadius: 8, padding: 10, gap: 2 },
  metaRow:     { fontSize: 12, color: C.textSecondary, fontFamily: "Pretendard-Regular" },

  sectionLabel: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: C.textPrimary, marginTop: 4 },
  levelRow:     { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4,
                  borderBottomWidth: 1, borderBottomColor: "#F0F0F0" },
  levelName:    { fontSize: 12, fontFamily: "Pretendard-Medium", color: C.textPrimary },
  levelDetail:  { fontSize: 11, color: C.textMuted, fontFamily: "Pretendard-Regular" },

  errorBlock: { backgroundColor: "#FFEBEE", borderRadius: 8, padding: 10, gap: 4 },
  errorTitle: { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#C62828" },
  errorItem:  { fontSize: 12, color: "#C62828", fontFamily: "Pretendard-Regular" },

  warnBlock:  { backgroundColor: "#FFF8E1", borderRadius: 8, padding: 10, gap: 4 },
  warnTitle:  { fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#E65100" },
  warnItem:   { fontSize: 12, color: "#E65100", fontFamily: "Pretendard-Regular" },

  validBadge: { borderRadius: 8, padding: 10 },
  validText:  { fontSize: 13, fontFamily: "Pretendard-SemiBold", textAlign: "center" },

  errorWrap: { alignItems: "center", paddingTop: 20, gap: 8 },
  errorBody: { color: "#C62828", fontSize: 14 },
  retryText: { color: "#1565C0", fontSize: 13 },
  emptyText: { color: C.textMuted, fontSize: 13, textAlign: "center", paddingTop: 20 },
});
