import { router } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

export default function AdminModeSwitch() {
  useEffect(() => {
    router.replace("/org-role-select");
  }, []);
  return <View />;
}
