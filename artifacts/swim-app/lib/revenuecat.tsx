/**
 * SwimNote RevenueCat 구독 컨텍스트
 *
 * 이용권(entitlement):
 *   - "solo"   : Solo 티어 (사진 OK, 영상 ❌, 학생수 제한)
 *   - "center" : Center 티어 (영상 OK, 학생수 무제한)
 *
 * 사용법:
 *   const { isSubscribed, isCenterTier, purchase, restore } = useSubscription();
 */
import React, { createContext, useContext } from "react";
import { Platform } from "react-native";
import Purchases from "react-native-purchases";
import { useMutation, useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";

const REVENUECAT_TEST_API_KEY     = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const REVENUECAT_IOS_API_KEY      = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const REVENUECAT_ANDROID_API_KEY  = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

export const REVENUECAT_SOLO_ENTITLEMENT   = "solo";
export const REVENUECAT_CENTER_ENTITLEMENT = "center";

function getRevenueCatApiKey() {
  if (!REVENUECAT_TEST_API_KEY || !REVENUECAT_IOS_API_KEY || !REVENUECAT_ANDROID_API_KEY) {
    throw new Error("RevenueCat API 키가 설정되지 않았습니다.");
  }
  if (__DEV__ || Platform.OS === "web" || Constants.executionEnvironment === "storeClient") {
    return REVENUECAT_TEST_API_KEY;
  }
  if (Platform.OS === "ios")     return REVENUECAT_IOS_API_KEY;
  if (Platform.OS === "android") return REVENUECAT_ANDROID_API_KEY;
  return REVENUECAT_TEST_API_KEY;
}

export function initializeRevenueCat() {
  const apiKey = getRevenueCatApiKey();
  Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
  Purchases.configure({ apiKey });
  console.log("[RevenueCat] 초기화 완료");
}

function useSubscriptionContext() {
  const customerInfoQuery = useQuery({
    queryKey: ["revenuecat", "customer-info"],
    queryFn: async () => Purchases.getCustomerInfo(),
    staleTime: 60 * 1000,
  });

  const soloOfferingQuery = useQuery({
    queryKey: ["revenuecat", "offerings", "solo"],
    queryFn: async () => {
      const all = await Purchases.getOfferings();
      return all.all["solo_monthly"] ?? null;
    },
    staleTime: 300 * 1000,
  });

  const centerOfferingQuery = useQuery({
    queryKey: ["revenuecat", "offerings", "center"],
    queryFn: async () => {
      const all = await Purchases.getOfferings();
      return all.all["center_monthly"] ?? null;
    },
    staleTime: 300 * 1000,
  });

  const purchaseMutation = useMutation({
    mutationFn: async (packageToPurchase: any) => {
      const { customerInfo } = await Purchases.purchasePackage(packageToPurchase);
      return customerInfo;
    },
    onSuccess: () => customerInfoQuery.refetch(),
  });

  const restoreMutation = useMutation({
    mutationFn: async () => Purchases.restorePurchases(),
    onSuccess: () => customerInfoQuery.refetch(),
  });

  const entitlements = customerInfoQuery.data?.entitlements.active ?? {};
  const isSoloTier   = entitlements[REVENUECAT_SOLO_ENTITLEMENT] !== undefined;
  const isCenterTier = entitlements[REVENUECAT_CENTER_ENTITLEMENT] !== undefined;
  const isSubscribed = isSoloTier || isCenterTier;

  return {
    customerInfo:   customerInfoQuery.data,
    soloOffering:   soloOfferingQuery.data,
    centerOffering: centerOfferingQuery.data,
    isSubscribed,
    isSoloTier,
    isCenterTier,
    isLoading: customerInfoQuery.isLoading,
    purchase:  purchaseMutation.mutateAsync,
    restore:   restoreMutation.mutateAsync,
    isPurchasing: purchaseMutation.isPending,
    isRestoring:  restoreMutation.isPending,
    refetchCustomerInfo: customerInfoQuery.refetch,
  };
}

type SubscriptionContextValue = ReturnType<typeof useSubscriptionContext>;
const Context = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const value = useSubscriptionContext();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSubscription() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useSubscription은 SubscriptionProvider 안에서 사용해야 합니다.");
  return ctx;
}
