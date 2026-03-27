import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface EditFieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: any;
  multiline?: boolean;
}

export function EditField({ label, value, onChangeText, placeholder, keyboardType, multiline }: EditFieldProps) {
  return (
    <View style={ef.wrap}>
      <Text style={ef.label}>{label}</Text>
      <TextInput
        style={[ef.input, multiline && ef.multiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || label}
        placeholderTextColor={C.textMuted}
        keyboardType={keyboardType || "default"}
        multiline={multiline}
        returnKeyType="done"
      />
    </View>
  );
}

const ef = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Pretendard-Medium", color: C.textSecondary },
  input: {
    backgroundColor: "#F1F5F9", borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text,
  },
  multiline: { minHeight: 80, textAlignVertical: "top" },
});
