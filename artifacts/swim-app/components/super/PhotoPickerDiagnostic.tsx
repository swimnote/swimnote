import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useRef, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  onClose: () => void;
  isAuthorized: boolean;
}

function isLocalUri(uri: unknown): uri is string {
  return typeof uri === "string" && /^(file:|ph:|assets-library:)/i.test(uri);
}

export default function PhotoPickerDiagnostic({ onClose, isAuthorized }: Props) {
  const [assets, setAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(false);
  const launchRef = useRef(false);
  const tokenRef = useRef(0);

  useEffect(() => {
    return () => {
      tokenRef.current += 1;
      launchRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isAuthorized) {
      tokenRef.current += 1;
      launchRef.current = false;
      setAssets([]);
      setOpening(false);
      setError(false);
    }
  }, [isAuthorized]);

  if (isAuthorized !== true) return null;

  async function pick() {
    if (launchRef.current) return;
    launchRef.current = true;
    const myToken = ++tokenRef.current;
    setOpening(true);
    setError(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        orderedSelection: true,
        selectionLimit: 50,
        quality: 0.85,
        exif: false,
        base64: false,
      });
      if (myToken !== tokenRef.current) return;
      if (!result.canceled && result.assets?.length) setAssets(result.assets);
    } catch {
      if (myToken === tokenRef.current) setError(true);
    } finally {
      if (myToken === tokenRef.current) {
        launchRef.current = false;
        setOpening(false);
      }
    }
  }

  function close() {
    tokenRef.current += 1;
    launchRef.current = false;
    setAssets([]);
    setOpening(false);
    setError(false);
    onClose();
  }

  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={s.root}>
        <ScrollView contentContainerStyle={s.body}>
          <Text style={s.hint}>
            01~50 번호가 크게 표시된 테스트 이미지만 사용하세요. 실제 학생사진은 사용하지 마세요.
            한 장씩 빠르게 탭하기, 스크롤하며 선택하기, 선택기가 허용하면 드래그/연속 선택하기를 각각 테스트하세요.
            선택한 번호 순서와 선택기의 배지를 아래 [1]~[50] 결과와 비교하세요. 각 테스트는 다시 선택으로 시작하세요.
          </Text>
          <View style={s.row}>
            <Pressable
              style={[s.btn, s.primary, opening && s.disabled]}
              disabled={opening}
              onPress={pick}
            >
              <Text style={s.primaryTx}>다시 선택</Text>
            </Pressable>
            <Pressable style={[s.btn, s.secondary]} onPress={close}>
              <Text style={s.secondaryTx}>닫기</Text>
            </Pressable>
          </View>
          {error ? <Text style={s.err}>사진을 불러오지 못했습니다.</Text> : null}
          <View style={s.grid}>
            {assets.map((a, i) => (
              <View key={i} style={s.cell}>
                {isLocalUri(a.uri) ? (
                   <Image source={{ uri: a.uri }} style={s.img} resizeMode="contain" />
                ) : (
                  <View style={[s.img, s.blank]} />
                )}
                <View style={s.badge}>
                  <Text style={s.badgeTx}>[{i + 1}]</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  body: { padding: 16, gap: 14 },
  hint: { color: C.textPrimary, fontSize: 14, lineHeight: 21 },
  row: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  primary: { backgroundColor: C.brandStrong },
  secondary: { backgroundColor: C.brandMist, borderWidth: 1, borderColor: C.border },
  disabled: { opacity: 0.5 },
  primaryTx: { color: C.surface, fontSize: 15, fontWeight: "700" },
  secondaryTx: { color: C.textStrong, fontSize: 15, fontWeight: "700" },
  err: { color: C.error, fontSize: 13 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cell: { width: "47%", aspectRatio: 1, borderRadius: 10, overflow: "hidden", backgroundColor: C.backgroundSoft },
  img: { width: "100%", height: "100%" },
  blank: { backgroundColor: C.border },
  badge: {
    position: "absolute", top: 6, left: 6, minWidth: 38, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8, backgroundColor: C.textStrong, alignItems: "center",
  },
  badgeTx: { color: C.surface, fontSize: 16, fontWeight: "800" },
});
