/**
 * SwimNote RevenueCat 초기 설정 스크립트
 *
 * 구독 플랜:
 *   - solo_monthly   : Solo 티어 월정액 (사진 OK, 영상 ❌, 학생수 제한)
 *   - center_monthly : Center 티어 월정액 (영상 OK, 학생수 무제한)
 *
 * 실행: pnpm --filter @workspace/scripts run seed-revenuecat
 */
import { getUncachableRevenueCatClient } from "./revenueCatClient.js";
import {
  listProjects,
  createProject,
  listApps,
  createApp,
  listProducts,
  createProduct,
  listEntitlements,
  createEntitlement,
  attachProductsToEntitlement,
  listOfferings,
  createOffering,
  updateOffering,
  listPackages,
  createPackages,
  attachProductsToPackage,
  listAppPublicApiKeys,
  type App,
  type Product,
  type Project,
  type Entitlement,
  type Offering,
  type Package,
  type CreateProductData,
} from "@replit/revenuecat-sdk";

const PROJECT_NAME = "SwimNote";

const APP_STORE_APP_NAME   = "SwimNote iOS";
const APP_STORE_BUNDLE_ID  = "com.swimnote.app";
const PLAY_STORE_APP_NAME  = "SwimNote Android";
const PLAY_STORE_PACKAGE_NAME = "com.swimnote.app";

const PRODUCTS = [
  {
    label: "Solo Monthly",
    identifier: "swimnote_solo_monthly",
    playIdentifier: "swimnote_solo_monthly:monthly",
    displayName: "Solo 월정액",
    title: "SwimNote Solo – 월정액",
    duration: "P1M" as const,
    prices: [
      { amount_micros: 9990000, currency: "USD" },
    ],
    entitlementKey: "solo",
    entitlementName: "Solo 이용권",
    offeringKey: "solo_monthly",
    offeringName: "Solo 월정액",
    packageKey: "$rc_monthly",
    packageName: "월정액",
  },
  {
    label: "Center Monthly",
    identifier: "swimnote_center_monthly",
    playIdentifier: "swimnote_center_monthly:monthly",
    displayName: "Center 월정액",
    title: "SwimNote Center – 월정액",
    duration: "P1M" as const,
    prices: [
      { amount_micros: 29990000, currency: "USD" },
    ],
    entitlementKey: "center",
    entitlementName: "Center 이용권",
    offeringKey: "center_monthly",
    offeringName: "Center 월정액",
    packageKey: "$rc_monthly",
    packageName: "월정액",
  },
];

type TestStorePricesResponse = {
  object: string;
  prices: { amount_micros: number; currency: string }[];
};

async function seedRevenueCat() {
  const client = await getUncachableRevenueCatClient();

  // ── 1. 프로젝트 ─────────────────────────────────────────────────────
  let project: Project;
  const { data: existingProjects, error: listProjectsError } = await listProjects({ client, query: { limit: 20 } });
  if (listProjectsError) throw new Error("Failed to list projects");

  const found = existingProjects.items?.find((p) => p.name === PROJECT_NAME);
  if (found) {
    console.log("Project already exists:", found.id);
    project = found;
  } else {
    const { data: newProject, error } = await createProject({ client, body: { name: PROJECT_NAME } });
    if (error) throw new Error("Failed to create project");
    console.log("Created project:", newProject.id);
    project = newProject;
  }

  // ── 2. 앱 ────────────────────────────────────────────────────────────
  const { data: apps, error: listAppsError } = await listApps({ client, path: { project_id: project.id }, query: { limit: 20 } });
  if (listAppsError || !apps || apps.items.length === 0) throw new Error("No apps found");

  let testStoreApp = apps.items.find((a) => a.type === "test_store");
  let appStoreApp  = apps.items.find((a) => a.type === "app_store");
  let playStoreApp = apps.items.find((a) => a.type === "play_store");

  if (!testStoreApp) throw new Error("No test_store app found");
  console.log("Test Store app:", testStoreApp.id);

  if (!appStoreApp) {
    const { data, error } = await createApp({ client, path: { project_id: project.id }, body: { name: APP_STORE_APP_NAME, type: "app_store", app_store: { bundle_id: APP_STORE_BUNDLE_ID } } });
    if (error) throw new Error("Failed to create App Store app");
    appStoreApp = data;
    console.log("Created App Store app:", data.id);
  } else { console.log("App Store app:", appStoreApp.id); }

  if (!playStoreApp) {
    const { data, error } = await createApp({ client, path: { project_id: project.id }, body: { name: PLAY_STORE_APP_NAME, type: "play_store", play_store: { package_name: PLAY_STORE_PACKAGE_NAME } } });
    if (error) throw new Error("Failed to create Play Store app");
    playStoreApp = data;
    console.log("Created Play Store app:", data.id);
  } else { console.log("Play Store app:", playStoreApp.id); }

  // ── 3. 상품 / 이용권 / 오퍼링 생성 ────────────────────────────────────
  const { data: existingProducts, error: listProductsError } = await listProducts({ client, path: { project_id: project.id }, query: { limit: 100 } });
  if (listProductsError) throw new Error("Failed to list products");

  const { data: existingEntitlements, error: listEntitlementsError } = await listEntitlements({ client, path: { project_id: project.id }, query: { limit: 20 } });
  if (listEntitlementsError) throw new Error("Failed to list entitlements");

  const { data: existingOfferings, error: listOfferingsError } = await listOfferings({ client, path: { project_id: project.id }, query: { limit: 20 } });
  if (listOfferingsError) throw new Error("Failed to list offerings");

  for (const plan of PRODUCTS) {
    console.log(`\n── ${plan.label} ──`);

    // 상품 3개 (test, appStore, playStore)
    const ensureProduct = async (targetApp: App, label: string, storeId: string, isTestStore: boolean): Promise<Product> => {
      const existing = existingProducts.items?.find((p) => p.store_identifier === storeId && p.app_id === targetApp.id);
      if (existing) { console.log(`  ${label} product exists:`, existing.id); return existing; }
      const body: CreateProductData["body"] = { store_identifier: storeId, app_id: targetApp.id, type: "subscription", display_name: plan.displayName };
      if (isTestStore) { body.subscription = { duration: plan.duration }; body.title = plan.title; }
      const { data, error } = await createProduct({ client, path: { project_id: project.id }, body });
      if (error) throw new Error(`Failed to create ${label} product`);
      console.log(`  Created ${label} product:`, data.id);
      return data;
    };

    const testProduct  = await ensureProduct(testStoreApp!, "TestStore",  plan.identifier,       true);
    const iosProduct   = await ensureProduct(appStoreApp!,  "AppStore",   plan.identifier,       false);
    const droidProduct = await ensureProduct(playStoreApp!, "PlayStore",  plan.playIdentifier,   false);

    // 테스트 스토어 가격 추가
    const { error: priceError } = await client.post<TestStorePricesResponse>({
      url: "/projects/{project_id}/products/{product_id}/test_store_prices",
      path: { project_id: project.id, product_id: testProduct.id },
      body: { prices: plan.prices },
    });
    if (priceError && (priceError as any)?.type !== "resource_already_exists") {
      console.warn("  Warning: could not set test store prices:", priceError);
    } else {
      console.log("  Test store prices set");
    }

    // 이용권
    let entitlement: Entitlement;
    const existingEnt = existingEntitlements.items?.find((e) => e.lookup_key === plan.entitlementKey);
    if (existingEnt) { console.log(`  Entitlement exists:`, existingEnt.id); entitlement = existingEnt; }
    else {
      const { data, error } = await createEntitlement({ client, path: { project_id: project.id }, body: { lookup_key: plan.entitlementKey, display_name: plan.entitlementName } });
      if (error) throw new Error(`Failed to create entitlement ${plan.entitlementKey}`);
      console.log(`  Created entitlement:`, data.id);
      entitlement = data;
    }

    const { error: attachErr } = await attachProductsToEntitlement({
      client,
      path: { project_id: project.id, entitlement_id: entitlement.id },
      body: { product_ids: [testProduct.id, iosProduct.id, droidProduct.id] },
    });
    if (attachErr && (attachErr as any)?.type !== "unprocessable_entity_error") {
      throw new Error(`Failed to attach products to entitlement ${plan.entitlementKey}`);
    } else { console.log("  Products attached to entitlement"); }

    // 오퍼링
    let offering: Offering;
    const existingOff = existingOfferings.items?.find((o) => o.lookup_key === plan.offeringKey);
    if (existingOff) { console.log(`  Offering exists:`, existingOff.id); offering = existingOff; }
    else {
      const { data, error } = await createOffering({ client, path: { project_id: project.id }, body: { lookup_key: plan.offeringKey, display_name: plan.offeringName } });
      if (error) throw new Error(`Failed to create offering ${plan.offeringKey}`);
      console.log(`  Created offering:`, data.id);
      offering = data;
    }

    // 패키지
    const { data: existingPkgs, error: listPkgsError } = await listPackages({ client, path: { project_id: project.id, offering_id: offering.id }, query: { limit: 20 } });
    if (listPkgsError) throw new Error(`Failed to list packages for offering ${plan.offeringKey}`);

    let pkg: Package;
    const existingPkg = existingPkgs.items?.find((p) => p.lookup_key === plan.packageKey);
    if (existingPkg) { console.log(`  Package exists:`, existingPkg.id); pkg = existingPkg; }
    else {
      const { data, error } = await createPackages({ client, path: { project_id: project.id, offering_id: offering.id }, body: { lookup_key: plan.packageKey, display_name: plan.packageName } });
      if (error) throw new Error(`Failed to create package ${plan.packageKey}`);
      console.log(`  Created package:`, data.id);
      pkg = data;
    }

    const { error: attachPkgErr } = await attachProductsToPackage({
      client,
      path: { project_id: project.id, package_id: pkg.id },
      body: {
        products: [
          { product_id: testProduct.id,  eligibility_criteria: "all" },
          { product_id: iosProduct.id,   eligibility_criteria: "all" },
          { product_id: droidProduct.id, eligibility_criteria: "all" },
        ],
      },
    });
    if (attachPkgErr && !(attachPkgErr as any)?.message?.includes("Cannot attach product")) {
      throw new Error(`Failed to attach products to package ${plan.packageKey}`);
    } else { console.log("  Products attached to package"); }
  }

  // ── 4. API 키 출력 ─────────────────────────────────────────────────
  const { data: testKeys }  = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: testStoreApp!.id } });
  const { data: iosKeys }   = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: appStoreApp!.id } });
  const { data: droidKeys } = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: playStoreApp!.id } });

  console.log("\n====================");
  console.log("RevenueCat 설정 완료!");
  console.log("Project ID:", project.id);
  console.log("Test Store App ID:", testStoreApp!.id);
  console.log("App Store App ID:", appStoreApp!.id);
  console.log("Play Store App ID:", playStoreApp!.id);
  console.log("Public API Keys - Test Store:", testKeys?.items.map((k) => k.key).join(", ") ?? "N/A");
  console.log("Public API Keys - App Store:", iosKeys?.items.map((k) => k.key).join(", ") ?? "N/A");
  console.log("Public API Keys - Play Store:", droidKeys?.items.map((k) => k.key).join(", ") ?? "N/A");
  console.log("Entitlements: solo, center");
  console.log("Offerings: solo_monthly, center_monthly");
  console.log("====================\n");
  console.log("다음 환경변수를 설정하세요:");
  console.log("  REVENUECAT_PROJECT_ID=", project.id);
  console.log("  REVENUECAT_TEST_STORE_APP_ID=", testStoreApp!.id);
  console.log("  REVENUECAT_APPLE_APP_STORE_APP_ID=", appStoreApp!.id);
  console.log("  REVENUECAT_GOOGLE_PLAY_STORE_APP_ID=", playStoreApp!.id);
  console.log("  EXPO_PUBLIC_REVENUECAT_TEST_API_KEY=", testKeys?.items[0]?.key ?? "???");
  console.log("  EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=", iosKeys?.items[0]?.key ?? "???");
  console.log("  EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=", droidKeys?.items[0]?.key ?? "???");
}

seedRevenueCat().catch(console.error);
