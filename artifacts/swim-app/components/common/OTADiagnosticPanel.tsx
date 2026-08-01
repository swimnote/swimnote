/**
 * OTADiagnosticPanel — 실기기 OTA 식별 진단 패널
 *
 * 표시 항목:
 *   • 배포 식별 문자열 (BUILD_ID)
 *   • app version / native build number
 *   • runtimeVersion
 *   • channel
 *   • Updates.updateId (현재 실행 중인 OTA ID)
 *   • isEmbeddedLaunch
 *
 * 사용: teacher/admin settings 화면 하단
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';

/** 이 OTA에 포함된 커밋 기반 식별 문자열 */
const BUILD_ID = 'AI-FIX-d3b6db3';

export default function OTADiagnosticPanel() {
  const [expanded, setExpanded] = useState(false);

  const appVersion    = Constants.expoConfig?.version ?? Constants.manifest?.version ?? '?';
  const buildNumber   = (Constants.expoConfig?.ios?.buildNumber ?? (Constants.manifest as any)?.ios?.buildNumber ?? '?') as string;
  const runtimeVer    = Updates.runtimeVersion ?? '?';
  const channel       = (Updates as any).channel ?? '?';
  const updateId      = Updates.updateId ?? '(embedded)';
  const isEmbedded    = Updates.isEmbeddedLaunch;

  const rows: { label: string; value: string }[] = [
    { label: '배포 식별',      value: BUILD_ID },
    { label: 'app version',    value: appVersion },
    { label: 'build number',   value: buildNumber },
    { label: 'runtimeVersion', value: runtimeVer },
    { label: 'channel',        value: channel },
    { label: 'updateId',       value: typeof updateId === 'string' ? updateId : JSON.stringify(updateId) },
    { label: 'isEmbedded',     value: String(isEmbedded) },
  ];

  return (
    <View style={s.wrap}>
      <Pressable style={s.header} onPress={() => setExpanded(v => !v)}>
        <Text style={s.headerText}>앱 진단 정보 {expanded ? '▲' : '▼'}</Text>
        <View style={[s.badge, { backgroundColor: isEmbedded ? '#FEF3C7' : '#D1FAE5' }]}>
          <Text style={[s.badgeText, { color: isEmbedded ? '#92400E' : '#065F46' }]}>
            {isEmbedded ? 'EMBEDDED' : 'OTA'}
          </Text>
        </View>
      </Pressable>

      {expanded && (
        <View style={s.body}>
          {rows.map(r => (
            <View key={r.label} style={s.row}>
              <Text style={s.label}>{r.label}</Text>
              <Text style={s.value} selectable numberOfLines={1} ellipsizeMode="middle">
                {r.value}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerText: {
    fontSize: 13,
    fontFamily: 'Pretendard-Regular',
    color: '#64748B',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: 'Pretendard-Regular',
    fontWeight: '600',
  },
  body: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#0F172A',
    padding: 12,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  label: {
    fontSize: 11,
    fontFamily: 'Pretendard-Regular',
    color: '#94A3B8',
    width: 100,
  },
  value: {
    fontSize: 11,
    fontFamily: 'Pretendard-Regular',
    color: '#E2E8F0',
    flex: 1,
  },
});
