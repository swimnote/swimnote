/**
 * (admin)/sms-credit.tsx — 운영자 문자·크레딧 관리
 * 선불 충전형 SMS 크레딧 시스템
 */
import { Feather } from '@expo/vector-icons'
import { router } from 'expo-router'
import React, { useMemo, useState } from 'react'
import {
  Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SubScreenHeader } from '@/components/common/SubScreenHeader'
import { useAuth } from '@/context/AuthContext'
import { useSmsCreditStore, CREDIT_PACKAGES } from '@/store/smsCreditStore'
import { useSmsStore } from '@/store/smsStore'

const P = '#1F8F86'
const TABS = ['현황', '크레딧 충전', '문자 발송', '발송 이력', '실패 내역'] as const
type Tab = typeof TABS[number]

const TYPE_LABEL: Record<string, string> = {
  invite: '초대', auth: '인증', notice: '안내', warning: '경고',
}
const SMS_TYPE_LABEL: Record<string, string> = {
  teacher_invite: '선생님 초대', parent_connect: '학부모 연결',
  phone_verify: '인증', policy_reconfirm: '정책 안내',
  payment_fail: '결제 실패', storage_warn: '저장공간 경고', deletion_notice: '삭제 예정',
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function SmsCreditScreen() {
  const { adminUser, pool } = useAuth()
  const actorName  = adminUser?.name ?? '운영자'
  const operatorId = pool?.id ?? 'op-001'
  const [tab, setTab] = useState<Tab>('현황')

  const accounts = useSmsCreditStore(s => s.accounts)
  const chargeCredit = useSmsCreditStore(s => s.chargeCredit)

  const records = useSmsStore(s => s.records)
  const invites = useSmsStore(s => s.invites)
  const templates = useSmsStore(s => s.templates)
  const createInvite = useSmsStore(s => s.createInvite)
  const sendSms = useSmsStore(s => s.sendSms)

  const account = useMemo(() => accounts.find(a => a.operatorId === operatorId), [accounts, operatorId])
  const myRecords = useMemo(() => records.filter(r => r.operatorId === operatorId), [records, operatorId])
  const sentRecords = useMemo(() => myRecords.filter(r => r.status === 'sent'), [myRecords])
  const failedRecords = useMemo(() => myRecords.filter(r => r.status === 'failed'), [myRecords])

  const freeRemaining = (account?.freeQuotaMonthly ?? 500) - (account?.freeUsedMonthly ?? 0)
  const creditBalance = account?.creditBalance ?? 0
  const isBlocked = account?.smsBlocked ?? false

  // 충전 모달
  const [chargeModal, setChargeModal] = useState(false)
  const [selectedPkg, setSelectedPkg] = useState(CREDIT_PACKAGES[1].id)
  const [chargeConfirm, setChargeConfirm] = useState(false)

  // 발송 모달
  const [sendModal, setSendModal] = useState(false)
  const [sendType, setSendType] = useState<'teacher_invite' | 'parent_connect' | 'notice' | 'warning'>('teacher_invite')
  const [sendName, setSendName] = useState('')
  const [sendPhone, setSendPhone] = useState('')
  const [sendMsg, setSendMsg] = useState('')
  const [sendDone, setSendDone] = useState(false)

  function handleCharge() {
    const pkg = CREDIT_PACKAGES.find(p => p.id === selectedPkg)
    if (!pkg) return
    const ok = chargeCredit(operatorId, selectedPkg, actorName)
    if (ok) {
      setChargeConfirm(false)
      setChargeModal(false)
      Alert.alert('충전 완료', `${pkg.creditCount}건 크레딧이 충전되었습니다.`)
    }
  }

  function handleSend() {
    if (!sendName.trim() || !sendPhone.trim()) {
      Alert.alert('입력 오류', '이름과 휴대폰 번호를 입력하세요.')
      return
    }
    if (isBlocked) {
      Alert.alert('발송 차단', '현재 SMS 크레딧이 부족하거나 차단된 상태입니다. 크레딧을 충전하세요.')
      return
    }
    if (sendType === 'teacher_invite' || sendType === 'parent_connect') {
      createInvite({
        role: sendType === 'teacher_invite' ? 'teacher' : 'parent',
        recipientName: sendName,
        recipientPhone: sendPhone,
        operatorId,
        operatorName: pool?.name ?? '수영장',
        actorName,
        note: sendMsg,
      })
    } else {
      sendSms({
        type: sendType === 'notice' ? 'policy_reconfirm' : 'payment_fail',
        recipientName: sendName,
        recipientPhone: sendPhone,
        operatorId,
        operatorName: pool?.name ?? '수영장',
        actorName,
        message: sendMsg || undefined,
      })
    }
    setSendDone(true)
  }

  function resetSendModal() {
    setSendModal(false)
    setSendDone(false)
    setSendName('')
    setSendPhone('')
    setSendMsg('')
    setSendType('teacher_invite')
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="문자·크레딧 관리" />

      {/* 상태 배너 */}
      {isBlocked && (
        <View style={s.blockBanner}>
          <Feather name="alert-triangle" size={14} color="#fff" />
          <Text style={s.blockTxt}>SMS 발송이 차단된 상태입니다. 크레딧을 충전하세요.</Text>
        </View>
      )}

      {/* 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabScroll} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {TABS.map(t => (
          <Pressable key={t} style={[s.tabChip, tab === t && s.tabChipActive]} onPress={() => setTab(t)}>
            <Text style={[s.tabChipTxt, tab === t && s.tabChipTxtActive]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }}>

        {/* ── 현황 ── */}
        {tab === '현황' && (
          <>
            {/* 요약 카드 */}
            <View style={s.summaryGrid}>
              <View style={[s.summaryCard, { backgroundColor: freeRemaining > 100 ? '#ECFEFF' : '#FFF1BF' }]}>
                <Text style={s.summaryVal}>{Math.max(0, freeRemaining)}</Text>
                <Text style={s.summaryLabel}>무료 잔여</Text>
              </View>
              <View style={[s.summaryCard, { backgroundColor: creditBalance > 0 ? '#DFF3EC' : '#FEF2F2' }]}>
                <Text style={[s.summaryVal, { color: creditBalance > 0 ? '#1F8F86' : '#D96C6C' }]}>{creditBalance.toLocaleString()}</Text>
                <Text style={s.summaryLabel}>크레딧 잔액</Text>
              </View>
              <View style={s.summaryCard}>
                <Text style={s.summaryVal}>{sentRecords.length}</Text>
                <Text style={s.summaryLabel}>이번 달 발송</Text>
              </View>
              <View style={[s.summaryCard, { backgroundColor: failedRecords.length > 0 ? '#FEF2F2' : '#fff' }]}>
                <Text style={[s.summaryVal, { color: failedRecords.length > 0 ? '#D96C6C' : '#1F1F1F' }]}>{failedRecords.length}</Text>
                <Text style={s.summaryLabel}>실패</Text>
              </View>
            </View>

            {/* 크레딧 상세 */}
            <View style={s.card}>
              <Text style={s.sectionTitle}>크레딧 상세</Text>
              <View style={s.row}><Text style={s.rowLabel}>월 무료 제공</Text><Text style={s.rowVal}>{account?.freeQuotaMonthly ?? 500}건</Text></View>
              <View style={s.row}><Text style={s.rowLabel}>무료 사용</Text><Text style={s.rowVal}>{account?.freeUsedMonthly ?? 0}건</Text></View>
              <View style={s.row}><Text style={s.rowLabel}>무료 잔여</Text><Text style={[s.rowVal, { color: freeRemaining > 0 ? '#1F8F86' : '#D96C6C', fontFamily: 'Inter_700Bold' }]}>{Math.max(0, freeRemaining)}건</Text></View>
              <View style={[s.divider, { marginVertical: 8 }]} />
              <View style={s.row}><Text style={s.rowLabel}>크레딧 잔액</Text><Text style={[s.rowVal, { color: creditBalance > 0 ? '#1F8F86' : '#D96C6C', fontFamily: 'Inter_700Bold' }]}>{creditBalance.toLocaleString()}건</Text></View>
              <View style={s.row}><Text style={s.rowLabel}>총 구매 크레딧</Text><Text style={s.rowVal}>{account?.creditPurchasedTotal.toLocaleString() ?? 0}건</Text></View>
              <View style={s.row}><Text style={s.rowLabel}>총 유료 사용</Text><Text style={s.rowVal}>{account?.creditUsedTotal.toLocaleString() ?? 0}건</Text></View>
              <View style={s.row}><Text style={s.rowLabel}>초과 발송 허용</Text><Text style={[s.rowVal, { color: account?.allowOverage ? '#1F8F86' : '#6F6B68' }]}>{account?.allowOverage ? 'ON' : 'OFF'}</Text></View>
              <View style={s.row}><Text style={s.rowLabel}>발송 상태</Text><Text style={[s.rowVal, { color: isBlocked ? '#D96C6C' : '#1F8F86', fontFamily: 'Inter_700Bold' }]}>{isBlocked ? '차단됨' : '정상'}</Text></View>
            </View>

            {/* 유형별 현황 */}
            <View style={s.card}>
              <Text style={s.sectionTitle}>유형별 발송 현황</Text>
              {(['invite', 'auth', 'notice', 'warning'] as const).map(type => {
                const cnt = account?.typesCount[type] ?? 0
                return (
                  <View key={type} style={s.row}>
                    <Text style={s.rowLabel}>{TYPE_LABEL[type]}</Text>
                    <Text style={s.rowVal}>{cnt}건</Text>
                  </View>
                )
              })}
            </View>

            <Pressable style={s.primaryBtn} onPress={() => { setTab('크레딧 충전') }}>
              <Feather name="plus-circle" size={16} color="#fff" />
              <Text style={s.primaryBtnTxt}>크레딧 충전하기</Text>
            </Pressable>
          </>
        )}

        {/* ── 크레딧 충전 ── */}
        {tab === '크레딧 충전' && (
          <>
            <View style={s.card}>
              <Text style={s.sectionTitle}>현재 잔액</Text>
              <View style={s.bigBalanceRow}>
                <Text style={s.bigBalance}>{creditBalance.toLocaleString()}</Text>
                <Text style={s.bigBalanceUnit}>건</Text>
              </View>
              <Text style={s.balanceSub}>무료 잔여 {Math.max(0, freeRemaining)}건 포함 시 총 {(Math.max(0, freeRemaining) + creditBalance).toLocaleString()}건 발송 가능</Text>
            </View>

            <Text style={s.sectionTitle}>충전 패키지 선택</Text>
            {CREDIT_PACKAGES.filter(p => p.isActive).map(pkg => (
              <Pressable
                key={pkg.id}
                style={[s.pkgCard, selectedPkg === pkg.id && s.pkgCardSelected]}
                onPress={() => setSelectedPkg(pkg.id)}
              >
                <View style={s.pkgRadio}>
                  {selectedPkg === pkg.id ? <View style={s.pkgRadioInner} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.pkgName}>{pkg.name}</Text>
                  <Text style={s.pkgDetail}>{pkg.creditCount.toLocaleString()}건 · 건당 ₩{(pkg.price / pkg.creditCount).toFixed(1)}</Text>
                </View>
                <Text style={s.pkgPrice}>₩{pkg.price.toLocaleString()}</Text>
              </Pressable>
            ))}

            <Pressable style={s.primaryBtn} onPress={() => setChargeConfirm(true)}>
              <Feather name="credit-card" size={16} color="#fff" />
              <Text style={s.primaryBtnTxt}>충전 신청</Text>
            </Pressable>

            {/* 구매 내역 */}
            {(account?.purchaseHistory ?? []).length > 0 && (
              <>
                <Text style={[s.sectionTitle, { marginTop: 8 }]}>충전 내역</Text>
                {(account?.purchaseHistory ?? []).map(p => (
                  <View key={p.id} style={s.histCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.histPkg}>{p.packageName}</Text>
                      <Text style={s.histSub}>{fmtDate(p.purchasedAt)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={s.histCredit}>+{p.creditCount.toLocaleString()}건</Text>
                      <Text style={s.histPrice}>₩{p.price.toLocaleString()}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </>
        )}

        {/* ── 문자 발송 ── */}
        {tab === '문자 발송' && (
          <>
            {isBlocked && (
              <View style={s.alertBox}>
                <Feather name="alert-circle" size={16} color="#D96C6C" />
                <Text style={s.alertTxt}>크레딧 부족으로 발송이 차단되었습니다. 먼저 크레딧을 충전하세요.</Text>
              </View>
            )}

            <Text style={s.sectionTitle}>발송 유형 선택</Text>
            {(
              [
                { type: 'teacher_invite', label: '선생님 초대', icon: 'user-plus', color: '#7C3AED', desc: '선생님을 초대하는 SMS 발송' },
                { type: 'parent_connect', label: '학부모 연결', icon: 'users', color: '#1F8F86', desc: '학부모 계정 연결 요청 SMS' },
                { type: 'notice', label: '안내 문자', icon: 'info', color: '#1F8F86', desc: '공지·안내 문자 발송' },
                { type: 'warning', label: '경고 문자', icon: 'alert-triangle', color: '#D97706', desc: '경고·주의 문자 발송' },
              ] as const
            ).map(item => (
              <Pressable
                key={item.type}
                style={s.sendTypeCard}
                onPress={() => { setSendType(item.type as any); setSendModal(true) }}
              >
                <View style={[s.sendTypeIcon, { backgroundColor: item.color + '15' }]}>
                  <Feather name={item.icon as any} size={22} color={item.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.sendTypeLabel}>{item.label}</Text>
                  <Text style={s.sendTypeSub}>{item.desc}</Text>
                </View>
                <Feather name="chevron-right" size={16} color="#D1D5DB" />
              </Pressable>
            ))}

            <View style={s.card}>
              <Text style={s.sectionTitle}>발송 안내</Text>
              <Text style={s.infoTxt}>· 무료 잔여 건수가 있으면 우선 차감됩니다</Text>
              <Text style={s.infoTxt}>· 무료 소진 후 크레딧이 차감됩니다</Text>
              <Text style={s.infoTxt}>· 크레딧 부족 시 발송이 차단됩니다</Text>
              <Text style={s.infoTxt}>· 현재 무료 잔여: {Math.max(0, freeRemaining)}건</Text>
              <Text style={s.infoTxt}>· 현재 크레딧: {creditBalance}건</Text>
            </View>
          </>
        )}

        {/* ── 발송 이력 ── */}
        {tab === '발송 이력' && (
          sentRecords.length === 0
            ? <View style={s.empty}><Feather name="send" size={36} color="#D1D5DB" /><Text style={s.emptyTxt}>발송 이력이 없습니다</Text></View>
            : sentRecords.map(r => (
              <View key={r.id} style={s.logCard}>
                <View style={s.logTop}>
                  <View style={[s.typeBadge, { backgroundColor: '#ECFEFF' }]}>
                    <Text style={[s.typeBadgeTxt, { color: P }]}>{SMS_TYPE_LABEL[r.type] ?? r.type}</Text>
                  </View>
                  <Text style={s.logDate}>{fmtDate(r.sentAt)}</Text>
                </View>
                <Text style={s.logName}>{r.recipientName} · {r.recipientPhone}</Text>
                <Text style={s.logMsg} numberOfLines={2}>{r.message}</Text>
                <Text style={s.logBy}>발송: {r.sentBy}</Text>
              </View>
            ))
        )}

        {/* ── 실패 내역 ── */}
        {tab === '실패 내역' && (
          failedRecords.length === 0
            ? <View style={s.empty}><Feather name="check-circle" size={36} color="#D1D5DB" /><Text style={s.emptyTxt}>실패 내역이 없습니다</Text></View>
            : failedRecords.map(r => (
              <View key={r.id} style={[s.logCard, { borderLeftColor: '#D96C6C', borderLeftWidth: 3 }]}>
                <View style={s.logTop}>
                  <View style={[s.typeBadge, { backgroundColor: '#FEF2F2' }]}>
                    <Text style={[s.typeBadgeTxt, { color: '#D96C6C' }]}>{SMS_TYPE_LABEL[r.type] ?? r.type}</Text>
                  </View>
                  <Text style={s.logDate}>{fmtDate(r.sentAt)}</Text>
                </View>
                <Text style={s.logName}>{r.recipientName} · {r.recipientPhone}</Text>
                <Text style={[s.logMsg, { color: '#D96C6C' }]}>실패 사유: {r.failReason ?? '알 수 없음'}</Text>
              </View>
            ))
        )}
      </ScrollView>

      {/* 충전 확인 모달 */}
      <Modal visible={chargeConfirm} transparent animationType="fade" onRequestClose={() => setChargeConfirm(false)}>
        <Pressable style={m.overlay} onPress={() => setChargeConfirm(false)}>
          <Pressable style={m.sheet} onPress={e => e.stopPropagation()}>
            <Text style={m.title}>충전 확인</Text>
            {(() => {
              const pkg = CREDIT_PACKAGES.find(p => p.id === selectedPkg)
              return pkg ? (
                <>
                  <Text style={m.sub}>{pkg.name}</Text>
                  <Text style={m.amount}>{pkg.creditCount.toLocaleString()}건</Text>
                  <Text style={m.price}>₩{pkg.price.toLocaleString()}</Text>
                  <Text style={m.hint}>결제 후 즉시 크레딧이 충전됩니다.</Text>
                </>
              ) : null
            })()}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <Pressable style={m.cancelBtn} onPress={() => setChargeConfirm(false)}>
                <Text style={m.cancelTxt}>취소</Text>
              </Pressable>
              <Pressable style={m.confirmBtn} onPress={handleCharge}>
                <Text style={m.confirmTxt}>충전 완료</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 발송 모달 */}
      <Modal visible={sendModal} transparent animationType="slide" onRequestClose={resetSendModal}>
        <Pressable style={m.overlay} onPress={resetSendModal}>
          <Pressable style={m.sheet} onPress={e => e.stopPropagation()}>
            {sendDone ? (
              <>
                <Feather name="check-circle" size={40} color="#1F8F86" style={{ alignSelf: 'center', marginBottom: 12 }} />
                <Text style={[m.title, { textAlign: 'center' }]}>발송 완료</Text>
                <Text style={[m.sub, { textAlign: 'center' }]}>{sendName}님께 SMS를 발송했습니다.</Text>
                <Pressable style={[m.confirmBtn, { marginTop: 16 }]} onPress={resetSendModal}>
                  <Text style={m.confirmTxt}>닫기</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={m.title}>{sendType === 'teacher_invite' ? '선생님 초대' : sendType === 'parent_connect' ? '학부모 연결' : sendType === 'notice' ? '안내 문자' : '경고 문자'}</Text>
                <Text style={m.label}>수신자 이름</Text>
                <TextInput style={m.input} placeholder="이름" value={sendName} onChangeText={setSendName} />
                <Text style={m.label}>휴대폰 번호</Text>
                <TextInput style={m.input} placeholder="010-0000-0000" value={sendPhone} onChangeText={setSendPhone} keyboardType="phone-pad" />
                <Text style={m.label}>메시지 (선택)</Text>
                <TextInput style={[m.input, { height: 80, textAlignVertical: 'top' }]} placeholder="추가 메시지..." value={sendMsg} onChangeText={setSendMsg} multiline />
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                  <Pressable style={m.cancelBtn} onPress={resetSendModal}><Text style={m.cancelTxt}>취소</Text></Pressable>
                  <Pressable style={m.confirmBtn} onPress={handleSend}><Text style={m.confirmTxt}>발송</Text></Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F0F9FF' },
  blockBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#D96C6C', padding: 12, paddingHorizontal: 16 },
  blockTxt: { flex: 1, color: '#fff', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  tabScroll: { maxHeight: 52, borderBottomWidth: 1, borderBottomColor: '#E0F2FE' },
  tabChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E0F2FE', alignSelf: 'flex-start', marginVertical: 8 },
  tabChipActive: { backgroundColor: P, borderColor: P },
  tabChipTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#6F6B68' },
  tabChipTxtActive: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#E0F2FE', gap: 8 },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#1F1F1F', marginBottom: 2 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryCard: { flex: 1, minWidth: '45%', backgroundColor: '#fff', borderRadius: 14, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#E0F2FE' },
  summaryVal: { fontSize: 24, fontFamily: 'Inter_700Bold', color: '#1F1F1F' },
  summaryLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#6F6B68', marginTop: 3 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#6F6B68' },
  rowVal: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#1F1F1F' },
  divider: { height: 1, backgroundColor: '#F6F3F1' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: P, borderRadius: 14, padding: 16, marginTop: 4 },
  primaryBtnTxt: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  bigBalanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 4 },
  bigBalance: { fontSize: 40, fontFamily: 'Inter_700Bold', color: '#1F1F1F' },
  bigBalanceUnit: { fontSize: 18, fontFamily: 'Inter_400Regular', color: '#6F6B68' },
  balanceSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#6F6B68' },
  pkgCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 2, borderColor: '#E0F2FE' },
  pkgCardSelected: { borderColor: P, backgroundColor: '#F0F9FF' },
  pkgRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: P, alignItems: 'center', justifyContent: 'center' },
  pkgRadioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: P },
  pkgName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#1F1F1F' },
  pkgDetail: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#6F6B68', marginTop: 2 },
  pkgPrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: P },
  histCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E0F2FE' },
  histPkg: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#1F1F1F' },
  histSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9A948F', marginTop: 2 },
  histCredit: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#1F8F86' },
  histPrice: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#6F6B68' },
  alertBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FEF2F2', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#FCA5A5' },
  alertTxt: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: '#991B1B', lineHeight: 18 },
  sendTypeCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#E0F2FE' },
  sendTypeIcon: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sendTypeLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#1F1F1F' },
  sendTypeSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#6F6B68', marginTop: 2 },
  infoTxt: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#6F6B68', lineHeight: 22 },
  logCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#E0F2FE', gap: 6 },
  logTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typeBadgeTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  logDate: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#9A948F' },
  logName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#1F1F1F' },
  logMsg: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#6F6B68', lineHeight: 17 },
  logBy: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#9A948F' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTxt: { fontSize: 15, fontFamily: 'Inter_400Regular', color: '#9A948F' },
})

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12, paddingBottom: 40 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#1F1F1F' },
  sub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#6F6B68' },
  amount: { fontSize: 32, fontFamily: 'Inter_700Bold', color: '#1F1F1F', textAlign: 'center' },
  price: { fontSize: 20, fontFamily: 'Inter_600SemiBold', color: P, textAlign: 'center' },
  hint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#6F6B68', textAlign: 'center' },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#1F1F1F', marginTop: 4 },
  input: { backgroundColor: '#FBF8F6', borderWidth: 1, borderColor: '#E9E2DD', borderRadius: 12, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: '#1F1F1F' },
  cancelBtn: { flex: 1, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F3F1' },
  cancelTxt: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#6F6B68' },
  confirmBtn: { flex: 2, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: P },
  confirmTxt: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
})
