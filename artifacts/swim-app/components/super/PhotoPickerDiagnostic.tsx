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
        selectionLimit: 10,
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
            사진 선택기에서 이 순서로 탭하세요: 03 → 01 → 07 → 02 → 10 → 04 → 06 → 09 → 05 → 08.
            선택기의 번호 배지와 아래 결과 번호를 비교하세요.
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
