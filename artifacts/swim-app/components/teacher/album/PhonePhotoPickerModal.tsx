import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SetStateAction } from "react";
import {
  ActivityIndicator, AppState, FlatList, Linking, Modal, Platform, Pressable,
  StyleSheet, Text, View, useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import * as MediaLibrary from "expo-media-library";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { usePhotoDragSelection } from "@/hooks/usePhotoDragSelection";
import {
  appendPhonePhotoPage, canReadPhonePhotos, changePhoneSelection, emptyPhoneSelection,
  orderedPhonePhotoIds, phonePhotoPageQuery, PHONE_PHOTO_LIMIT, resolvePhonePhotos,
  selectedPhonePhotos,
} from "@/utils/phonePhotoPicker";
import type { PhoneLibraryAsset, PhoneUploadPhoto } from "@/utils/phonePhotoPicker";

const C = Colors.light;
type Access = "loading" | "all" | "limited" | "denied";

interface Props {
  onCancel: () => void;
  onConfirm: (photos: PhoneUploadPhoto[]) => void;
}

export default function PhonePhotoPickerModal({ onCancel, onConfirm }: Props) {
  const { width } = useWindowDimensions();
  const cellSize = Math.floor((width - 8) / 3);
  const [assets, setAssets] = useState<PhoneLibraryAsset[]>([]);
  const [selection, setSelection] = useState(emptyPhoneSelection);
  const [access, setAccess] = useState<Access>("loading");
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const token = useRef(0);
  const pageBusy = useRef(false);
  const prepareBusy = useRef(false);
  const cursor = useRef<string | undefined>(undefined);
  const more = useRef(true);
  const accessRef = useRef<Access>("loading");
  const setSelected = useCallback((update: SetStateAction<Set<string>>) => {
    setSelection(previous => changePhoneSelection(previous,
      typeof update === "function" ? update(previous.ids) : update));
  }, []);
  const drag = usePhotoDragSelection<PhoneLibraryAsset>({
    enabled: (access === "all" || access === "limited") && !preparing,
    ids: assets.map(asset => asset.id), selected: selection.ids, setSelected,
    limit: PHONE_PHOTO_LIMIT, columns: 3, cellSize, columnGap: 2, rowGap: 2, padding: 2,
  });
  const orderedIds = orderedPhonePhotoIds(selection);
  const badges = new Map(orderedIds.map((id, index) => [id, index + 1]));

  const loadPage = useCallback(async (generation: number, reset = false) => {
    if (pageBusy.current || (!reset && !more.current)) return;
    pageBusy.current = true;
    setLoading(true);
    try {
      const after = reset ? undefined : cursor.current;
      const query = phonePhotoPageQuery(after);
      const page = await MediaLibrary.getAssetsAsync({
        ...query, sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      });
      if (generation !== token.current) return;
      if (page.hasNextPage && (!page.endCursor || page.endCursor === after)) {
        throw new Error("사진 목록을 이어서 불러오지 못했습니다. 다시 시도해주세요.");
      }
      cursor.current = page.endCursor;
      more.current = page.hasNextPage;
      setHasMore(page.hasNextPage);
      setAssets(previous => appendPhonePhotoPage(reset ? [] : previous, page.assets));
    } catch {
      if (generation === token.current) setError("사진 목록을 불러오지 못했습니다. 권한을 확인하거나 다시 시도해주세요.");
    } finally {
      if (generation === token.current) {
        pageBusy.current = false;
        setLoading(false);
      }
    }
  }, []);

  const reload = useCallback(async (requestPermission = true) => {
    const generation = ++token.current;
    pageBusy.current = false;
    prepareBusy.current = false;
    cursor.current = undefined;
    more.current = true;
    accessRef.current = "loading";
    setAccess("loading"); setPreparing(false);
    setError(null); setAssets([]); setSelection(emptyPhoneSelection());
    try {
      let permission = await MediaLibrary.getPermissionsAsync(false, ["photo"]);
      if (!canReadPhonePhotos(permission) && permission.canAskAgain && requestPermission) {
        permission = await MediaLibrary.requestPermissionsAsync(false, ["photo"]);
      }
      if (generation !== token.current) return;
      const nextAccess: Access = canReadPhonePhotos(permission)
        ? permission.accessPrivileges === "limited" ? "limited" : "all" : "denied";
      accessRef.current = nextAccess;
      setAccess(nextAccess);
      if (nextAccess !== "denied") await loadPage(generation, true);
    } catch {
      if (generation === token.current) {
        accessRef.current = "denied";
        setAccess("denied");
        setError("사진 접근 권한을 확인하지 못했습니다.");
      }
    }
  }, [loadPage]);

  useEffect(() => {
    void reload();
    return () => { token.current++; };
  }, [reload]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", async state => {
      if (state !== "active" || accessRef.current === "loading") return;
      const generation = token.current;
      try {
        const permission = await MediaLibrary.getPermissionsAsync(false, ["photo"]);
        if (generation !== token.current) return;
        const next = canReadPhonePhotos(permission)
          ? permission.accessPrivileges === "limited" ? "limited" : "all" : "denied";
        if (next !== accessRef.current || next === "limited") void reload(false);
      } catch {
        if (generation === token.current) void reload(false);
      }
    });
    return () => listener.remove();
  }, [reload]);

  function cancel() {
    token.current++;
    onCancel();
  }

  async function done() {
    if (!selection.ids.size || prepareBusy.current) return;
    prepareBusy.current = true;
    const generation = token.current;
    setPreparing(true); setError(null);
    try {
      const ordered = selectedPhonePhotos(selection, assets);
      const photos = await resolvePhonePhotos(ordered,
        asset => MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: true }),
        () => generation === token.current);
      if (generation === token.current) onConfirm(photos);
    } catch (e) {
      if (generation === token.current) {
        setError(e instanceof Error ? e.message : "사진 원본을 가져오지 못했습니다.");
      }
    } finally {
      if (generation === token.current) { prepareBusy.current = false; setPreparing(false); }
    }
  }

  function toggle(id: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < PHONE_PHOTO_LIMIT) next.add(id);
      return next;
    });
  }

  async function manageLimited() {
    try {
      await MediaLibrary.presentPermissionsPickerAsync(["photo"]);
      void reload(false);
    } catch {
      setError("사진 접근 범위는 휴대폰 설정에서 변경할 수 있습니다.");
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={cancel}>
      <SafeAreaView style={s.root}>
        <View style={s.header}>
          <Pressable testID="phone-photo-cancel" onPress={cancel} style={s.button}>
            <Text style={s.action}>취소</Text>
          </Pressable>
          <View style={s.titleBlock}>
            <Text style={s.title}>휴대폰 사진</Text>
            <Text style={s.count}>{selection.ids.size} / {PHONE_PHOTO_LIMIT}장 선택</Text>
          </View>
          <Pressable testID="phone-photo-done" onPress={done}
            disabled={!selection.ids.size || preparing || access === "denied"}
            style={[s.button, (!selection.ids.size || preparing) && s.disabled]}>
            {preparing ? <ActivityIndicator color={C.brandStrong} /> : <Text style={s.action}>완료</Text>}
          </Pressable>
        </View>
        <Text style={s.hint}>사진을 잠깐 누른 뒤 쓸어 선택/해제하세요. 화면 끝에서는 자동으로 스크롤됩니다.</Text>
        {access === "limited" && (
          <View style={s.notice}>
            <Text style={s.noticeText}>허용한 사진만 표시됩니다. 접근 범위를 바꾸면 현재 선택은 초기화됩니다.</Text>
            <Pressable onPress={manageLimited} disabled={preparing}><Text style={s.action}>사진 추가 허용</Text></Pressable>
          </View>
        )}
        {error && <View style={s.notice}>
          <Text style={s.error}>{error}</Text>
          {!preparing && access !== "denied" && (
            <Pressable onPress={() => { setError(null); void loadPage(token.current, !assets.length); }}>
              <Text style={s.action}>목록 다시 시도</Text>
            </Pressable>
          )}
        </View>}
        {preparing && <Text style={s.hint}>선택한 사진 원본을 준비 중입니다. iCloud 사진은 시간이 걸릴 수 있습니다.</Text>}
        {access === "denied" ? (
          <View style={s.center}>
            <Text style={s.title}>사진 접근 권한이 필요합니다</Text>
            <Text style={s.hint}>설정에서 사진 접근을 허용해주세요.</Text>
            <Pressable onPress={() => Linking.openSettings()} style={s.button}><Text style={s.action}>설정 열기</Text></Pressable>
            <Pressable onPress={() => reload()} style={s.button}><Text style={s.action}>권한 다시 확인</Text></Pressable>
          </View>
        ) : access === "loading" || (loading && !assets.length) ? (
          <View style={s.center}><ActivityIndicator color={C.brandStrong} /></View>
        ) : (
          <View {...drag.containerProps} style={s.grid}>
            <FlatList {...drag.listProps}
              data={assets} keyExtractor={asset => asset.id} numColumns={3}
              contentContainerStyle={s.content} columnWrapperStyle={s.row}
              initialNumToRender={18} maxToRenderPerBatch={18} windowSize={5}
              removeClippedSubviews={Platform.OS === "android"}
              onEndReachedThreshold={0.7}
              onEndReached={() => { if (!error && !preparing) void loadPage(token.current); }}
              renderItem={({ item }) => (
                <Pressable {...drag.cellProps(item.id, () => toggle(item.id))}
                  disabled={preparing}
                  testID={`phone-photo-${item.id}`}
                  accessibilityLabel={`사진${badges.has(item.id) ? `, 선택 순번 ${badges.get(item.id)}` : ""}`}
                  accessibilityState={{ selected: selection.ids.has(item.id) }}
                  style={[s.cell, { width: cellSize, height: cellSize }]}>
                  <Image source={{ uri: item.uri, width: cellSize, height: cellSize }} style={s.image}
                    contentFit="cover" cachePolicy="none" recyclingKey={item.id} />
                  {badges.has(item.id) && <View style={s.badge}><Text style={s.badgeText}>{badges.get(item.id)}</Text></View>}
                </Pressable>
              )}
              ListEmptyComponent={<Text style={s.hint}>표시할 사진이 없습니다.</Text>}
              ListFooterComponent={loading ? <ActivityIndicator style={s.footer} color={C.brandStrong} />
                : hasMore ? <Pressable onPress={() => { setError(null); void loadPage(token.current); }} style={s.button}>
                  <Text style={s.action}>사진 더 보기</Text>
                </Pressable> : null}
            />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  header: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: C.border },
  button: { minWidth: 64, minHeight: 48, paddingHorizontal: 14, justifyContent: "center", alignItems: "center" },
  action: { color: C.brandStrong, fontSize: 14, fontWeight: "600" },
  titleBlock: { flex: 1, alignItems: "center", paddingVertical: 10 },
  title: { color: C.textPrimary, fontSize: 17, fontWeight: "600" },
  count: { color: C.textSecondary, fontSize: 13, marginTop: 3 },
  hint: { color: C.textSecondary, fontSize: 12, lineHeight: 18, padding: 12 },
  disabled: { opacity: 0.4 },
  notice: { paddingHorizontal: 12, paddingVertical: 8, gap: 8, backgroundColor: C.backgroundSoft },
  noticeText: { color: C.textSecondary, fontSize: 12, lineHeight: 18 },
  error: { color: C.error, fontSize: 13, lineHeight: 19 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  grid: { flex: 1 },
  content: { padding: 2, gap: 2 },
  row: { gap: 2 },
  cell: { overflow: "hidden", backgroundColor: C.backgroundSoft },
  image: { width: "100%", height: "100%" },
  badge: { position: "absolute", top: 5, right: 5, minWidth: 25, height: 25, paddingHorizontal: 4,
    borderRadius: 13, backgroundColor: C.brandStrong, alignItems: "center", justifyContent: "center" },
  badgeText: { color: C.surface, fontSize: 12, fontWeight: "700" },
  footer: { padding: 18 },
});
