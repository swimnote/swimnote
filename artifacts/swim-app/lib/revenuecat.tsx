/**
 * SwimNote RevenueCat 구독 컨텍스트
 *
 * 오퍼링: solo_monthly → 패키지 3개 (solo_30 / solo_50 / solo_100)
 * 이용권: "solo" (Solo 30/50/100 모두 포함)
 *
 * 사용법:
 *   const { offerings, isSubscribed, purchase, restore } = useSubscription();
 */
import React, { createContext, useContext } from "react";
import { Platform } from "react-native";
import Purchases from "react-native-purchases";
import { useMutation, useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";

const REVENUECAT_TEST_API_KEY    = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const REVENUECAT_IOS_API_KEY     = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

export const REVENUECAT_SOLO_ENTITLEMENT = "solo";
export const SOLO_OFFERING_ID            = "solo_monthly";

export const PACKAGE_META: Record<string, { name: string; memberLimit: number; storage: string }> = {
  solo_30:  { name: "Solo 30",  memberLimit: 30,  storage: "3GB"  },
  solo_50:  { name: "Solo 50",  memberLimit: 50,  storage: "5GB"  },
  solo_100: { name: "Solo 100", memberLimit: 100, storage: "10GB" },
};

function getRevenueCatApiKey(): string {
  if (__DEV__ || Platform.OS === "web" || Constants.executionEnvironment === "storeClient") {
    if (!REVENUECAT_TEST_API_KEY) throw new Error("EXPO_PUBLIC_REVENUECAT_TEST_API_KEY 미설정");
    return REVENUECAT_TEST_API_KEY;
  }
  if (Platform.OS === "ios") {
    if (!REVENUECAT_IOS_API_KEY) throw new Error("EXPO_PUBLIC_REVENUECAT_IOS_API_KEY 미설정");
    return REVENUECAT_IOS_API_KEY;
  }
  if (Platform.OS === "android") {
    if (!REVENUECAT_ANDROID_API_KEY) throw new Error("EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY 미설정");
    return REVENUECAT_ANDROID_API_KEY;
  }
  if (!REVENUECAT_TEST_API_KEY) throw new Error("EXPO_PUBLIC_REVENUECAT_TEST_API_KEY 미설정");
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
    queryKey: ["rc", "customerInfo"],
    queryFn:  () => Purchases.getCustomerInfo(),
    staleTime: 60_000,
    retry: false,
  });

  const offeringsQuery = useQuery({
    queryKey: ["rc", "offerings"],
    queryFn:  async () => {
      const all = await Purchases.getOfferings();
      const solo   = all.all[SOLO_OFFERING_ID] ?? null;
      const center = all.all["center_monthly"] ?? null;
      return { solo, center, current: all.current };
    },
    staleTime: 300_000,
    retry: false,
  });

  const purchaseMutation = useMutation({
    mutationFn: async (pkg: any) => {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      return customerInfo;
    },
    onSuccess: () => customerInfoQuery.refetch(),
  });

  const restoreMutation = useMutation({
    mutationFn: () => Purchases.restorePurchases(),
    onSuccess:  () => customerInfoQuery.refetch(),
  });

  const entitlements   = customerInfoQuery.data?.entitlements.active ?? {};
  const isSubscribed   = REVENUECAT_SOLO_ENTITLEMENT in entitlements;
  const activePackageId = isSubscribed
    ? (customerInfoQuery.data?.entitlements.active[REVENUECAT_SOLO_ENTITLEMENT]?.productIdentifier ?? null)
    : null;

  return {
    customerInfo:     customerInfoQuery.data ?? null,
    soloOffering:     offeringsQuery.data?.solo ?? null,
    centerOffering:   offeringsQuery.data?.center ?? null,
    isSubscribed,
    activePackageId,
    isLoading:        customerInfoQuery.isLoading || offeringsQuery.isLoading,
    purchase:         purchaseMutation.mutateAsync,
    restore:          restoreMutation.mutateAsync,
    isPurchasing:     purchaseMutation.isPending,
    isRestoring:      restoreMutation.isPending,
    purchaseError:    purchaseMutation.error,
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
