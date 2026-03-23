/**
 * (admin)/extra-storage.tsx — 추가 용량 구매
 * 구독 플랜과 별개 상품 / 구매 시 영상 업로드 잠금 해제
 */
import { Feather } from '@expo/vector-icons'
import React, { useMemo, useState } from 'react'
import {
  Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SubScreenHeader } from '@/components/common/SubScreenHeader'
import { useAuth } from '@/context/AuthContext'
import { useExtraStorageStore } from '@/store/extraStorageStore'
import { useOperatorsStore } from '@/store/operatorsStore'

const G = '#1F8F86'

function fmtMb(mb: number) {
  if (mb < 1024) return `${mb} MB`
  return `${(mb / 1024).toFixed(0)} GB`
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ExtraStorageScreen() {
  const { adminUser, pool } = useAuth()
  const actorName  = adminUser?.name ?? '운영자'
  const operatorId = pool?.id ?? 'op-001'

  const products = useExtraStorageStore(s => s.products)
  const opAccounts = useExtraStorageStore(s => s.opAccounts)
  const purchases = useExtraStorageStore(s => s.purchases)
  const purchaseProduct = useExtraStorageStore(s => s.purchaseProduct)

  const operators = useOperatorsStore(s => s.operators)

  const activeProducts = useMemo(() => products.filter(p => p.isActive), [products])
  const myAccount  = useMemo(() => opAccounts.find(a => a.operatorId === operatorId), [opAccounts, operatorId])
  const myPurchases= useMemo(() => purchases.filter(p => p.operatorId === operatorId), [purchases, operatorId])
  const myOperator = useMemo(() => operators.find(o => o.id === operatorId), [operators, operatorId])

  const planBaseMb = myOperator?.storageTotalMb ?? 512
  const extraMb = myAccount?.extraStoragePurchasedMb ?? 0
  const totalMb = planBaseMb + extraMb
  const usedMb = myOperator?.storageUsedMb ?? 0
  const usedPct = totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : 0
  const videoUnlocked = myAccount?.videoUploadUnlocked ?? false

  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [confirmModal, setConfirmModal] = useState(false)
  const [doneModal, setDoneModal] = useState(false)

  function handleBuy() {
    if (!selectedProduct) return
    const ok = purchaseProduct(operatorId, selectedProduct, actorName)
    if (ok) {
      setConfirmModal(false)
      setDoneModal(true)
    } else {
      Alert.alert('구매 실패', '상품 정보를 찾을 수 없습니다.')
    }
  }

  const selectedProd = products.find(p => p.id === selectedProduct)

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="추가 용량 구매" />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }}>

        {/* 현재 용량 현황 */}
        <View style={s.card}>
          <Text style={s.sectionTitle}>현재 저장공간 현황</Text>
          <View style={s.row}><Text style={s.rowLabel}>기본 용량 (플랜)</Text><Text style={s.rowVal}>{fmtMb(planBaseMb)}</Text></View>
          <View style={s.row}><Text style={s.rowLabel}>추가 구매 용량</Text><Text style={[s.rowVal, { color: G }]}>{fmtMb(extraMb)}</Text></View>
          <View style={[s.row, { borderTopWidth: 1, borderTopColor: '#F6F3F1', paddingTop: 8, marginTop: 4 }]}>
            <Text style={[s.rowLabel, { fontFamily: 'Inter_700Bold', color: '#1F1F1F' }]}>총 사용 가능</Text>
            <Text style={[s.rowVal, { fontFamily: 'Inter_700Bold', color: '#1F1F1F' }]}>{fmtMb(totalMb)}</Text>
          </View>
          <View style={s.row}><Text style={s.rowLabel}>현재 사용량</Text><Text style={s.rowVal}>{fmtMb(usedMb)} ({usedPct}%)</Text></View>

          {/* 사용률 바 */}
          <View style={s.barBg}>
            <View style={[s.barFill, { width: `${Math.min(usedPct, 100)}%` as any, backgroundColor: usedPct >= 95 ? '#D96C6C' : usedPct >= 80 ? '#D97706' : G }]} />
          </View>
        </View>

        {/* 영상 업로드 상태 */}
        <View style={[s.card, { borderColor: videoUnlocked ? '#DDF2EF' : '#F9DEDA' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={[s.iconBox, { backgroundColor: videoUnlocked ? '#DDF2EF' : '#F9DEDA' }]}>
              <Feather name={videoUnlocked ? 'video' : 'video-off'} size={20} color={videoUnlocked ? G : '#D96C6C'} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.sectionTitle}>영상 업로드</Text>
              <Text style={[s.rowLabel, { color: videoUnlocked ? G : '#D96C6C', fontFamily: 'Inter_600SemiBold' }]}>
                {videoUnlocked ? '잠금 해제됨' : '잠금 상태'}
              </Text>
            </View>
          </View>
          {myAccount?.videoUnlockReason === 'extra_storage' && (
            <Text style={[s.rowLabel, { marginTop: 4 }]}>추가 용량 구매로 잠금 해제되었습니다.</Text>
          )}
          {myAccount?.videoUnlockReason === 'manual' && (
            <Text style={[s.rowLabel, { marginTop: 4 }]}>관리자 예외 허용: {myAccount.videoUnlockNote ?? ''}</Text>
          )}
          {!videoUnlocked && (
            <Text style={[s.rowLabel, { marginTop: 4, color: '#D97706' }]}>추가 용량 상품 구매 시 영상 업로드가 가능합니다.</Text>
          )}
        </View>

        {/* 상품 목록 */}
        <Text style={s.sectionTitle}>추가 용량 상품</Text>
        {activeProducts.map(prod => (
          <Pressable
            key={prod.id}
            style={[s.prodCard, selectedProduct === prod.id && s.prodCardSelected]}
            onPress={() => setSelectedProduct(prod.id)}
          >
            <View style={s.prodRadio}>
              {selectedProduct === prod.id ? <View style={s.prodRadioInner} /> : null}
            </View>
            <View style={[s.prodIconBox, { backgroundColor: '#DDF2EF' }]}>
              <Feather name="hard-drive" size={22} color={G} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.prodName}>{prod.name}</Text>
              <Text style={s.prodMb}>{fmtMb(prod.extraStorageMb)}</Text>
              {prod.note ? <Text style={s.prodNote}>{prod.note}</Text> : null}
            </View>
            <Text style={s.prodPrice}>₩{prod.price.toLocaleString()}</Text>
          </Pressable>
        ))}

        <Pressable
          style={[s.primaryBtn, !selectedProduct && s.primaryBtnDisabled]}
          onPress={() => { if (selectedProduct) setConfirmModal(true) }}
          disabled={!selectedProduct}
        >
          <Feather name="shopping-cart" size={16} color="#fff" />
          <Text style={s.primaryBtnTxt}>구매하기</Text>
        </Pressable>

        {/* 구매 내역 */}
        {myPurchases.length > 0 && (
          <>
            <Text style={[s.sectionTitle, { marginTop: 8 }]}>구매 내역</Text>
            {myPurchases.map(p => (
              <View key={p.id} style={s.histCard}>
                <View style={[s.iconBox, { backgroundColor: '#DDF2EF' }]}>
                  <Feather name="package" size={16} color={G} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.histName}>{p.productName}</Text>
                  <Text style={s.histSub}>{fmtMb(p.extraStorageMb)} · {fmtDate(p.purchasedAt)}</Text>
                </View>
                <Text style={s.histPrice}>₩{p.price.toLocaleString()}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* 구매 확인 모달 */}
      <Modal visible={confirmModal} transparent animationType="fade" onRequestClose={() => setConfirmModal(false)}>
        <Pressable style={m.overlay} onPress={() => setConfirmModal(false)}>
          <Pressable style={m.sheet} onPress={e => e.stopPropagation()}>
            <Text style={m.title}>구매 확인</Text>
            <Text style={m.sub}>{selectedProd?.name}</Text>
            <Text style={m.amount}>{selectedProd ? fmtMb(selectedProd.extraStorageMb) : ''}</Text>
            <Text style={m.price}>₩{selectedProd?.price.toLocaleString()}</Text>
            <Text style={m.hint}>구매 후 즉시 용량이 추가되고 영상 업로드가 가능합니다.</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <Pressable style={m.cancelBtn} onPress={() => setConfirmModal(false)}><Text style={m.cancelTxt}>취소</Text></Pressable>
              <Pressable style={m.confirmBtn} onPress={handleBuy}><Text style={m.confirmTxt}>구매 완료</Text></Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 완료 모달 */}
      <Modal visible={doneModal} transparent animationType="fade" onRequestClose={() => setDoneModal(false)}>
        <Pressable style={m.overlay} onPress={() => setDoneModal(false)}>
          <Pressable style={m.sheet} onPress={e => e.stopPropagation()}>
            <Feather name="check-circle" size={48} color={G} style={{ alignSelf: 'center', marginBottom: 8 }} />
            <Text style={[m.title, { textAlign: 'center' }]}>구매 완료</Text>
            <Text style={[m.sub, { textAlign: 'center' }]}>
              {selectedProd?.name ?? '추가 용량'}이 즉시 적용되었습니다.{'\n'}영상 업로드가 가능합니다.
            </Text>
            <Pressable style={[m.confirmBtn, { marginTop: 8 }]} onPress={() => { setDoneModal(false); setSelectedProduct(null) }}>
              <Text style={m.confirmTxt}>확인</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#DFF3EC' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#DDF2EF', gap: 8 },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#1F1F1F', marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#6F6B68' },
  rowVal: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#1F1F1F' },
  barBg: { height: 8, backgroundColor: '#F6F3F1', borderRadius: 4, overflow: 'hidden', marginTop: 6 },
  barFill: { height: '100%', borderRadius: 4 },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  prodCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 2, borderColor: '#E9E2DD' },
  prodCardSelected: { borderColor: G, backgroundColor: '#DFF3EC' },
  prodRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: G, alignItems: 'center', justifyContent: 'center' },
  prodRadioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: G },
  prodIconBox: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  prodName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#1F1F1F' },
  prodMb: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: G, marginTop: 2 },
  prodNote: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#6F6B68', marginTop: 2, lineHeight: 15 },
  prodPrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#1F1F1F' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: G, borderRadius: 14, padding: 16 },
  primaryBtnDisabled: { backgroundColor: '#D1D5DB' },
  primaryBtnTxt: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  histCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E9E2DD' },
  histName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#1F1F1F' },
  histSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#9A948F', marginTop: 2 },
  histPrice: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#1F1F1F' },
})

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12, paddingBottom: 40 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#1F1F1F' },
  sub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#6F6B68' },
  amount: { fontSize: 32, fontFamily: 'Inter_700Bold', color: '#1F1F1F', textAlign: 'center' },
  price: { fontSize: 20, fontFamily: 'Inter_600SemiBold', color: '#1F8F86', textAlign: 'center' },
  hint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#6F6B68', textAlign: 'center', lineHeight: 18 },
  cancelBtn: { flex: 1, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F3F1' },
  cancelTxt: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#6F6B68' },
  confirmBtn: { flex: 2, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1F8F86' },
  confirmTxt: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
})
