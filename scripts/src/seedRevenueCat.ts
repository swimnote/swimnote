/**
 * SwimNote RevenueCat 초기 설정 스크립트
 *
 * Solo 플랜 3가지 (Solo 30 / Solo 50 / Solo 100) + Center 1가지
 * - solo_monthly 오퍼링에 solo_30 / solo_50 / solo_100 패키지 3개
 * - center_monthly 오퍼링에 center_monthly 패키지 1개
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
const APP_STORE_APP_NAME      = "SwimNote iOS";
const APP_STORE_BUNDLE_ID     = "com.swimnote.app";
const PLAY_STORE_APP_NAME     = "SwimNote Android";
const PLAY_STORE_PACKAGE_NAME = "com.swimnote.app";

type PlanDef = {
  label: string;
  identifier: string;
  playIdentifier: string;
  displayName: string;
  title: string;
  duration: "P1M";
  testPrices: { amount_micros: number; currency: string }[];
  entitlementKey: string;
  entitlementName: string;
  offeringKey: string;
  offeringName: string;
  packageKey: string;
  packageName: string;
};

const SOLO_PLANS: PlanDef[] = [
  {
    label: "Solo 30",
    identifier: "swimnote_solo_30",
    playIdentifier: "swimnote_solo_30:monthly",
    displayName: "Solo 30",
    title: "SwimNote Solo 30 – 최대 30명",
    duration: "P1M",
    testPrices: [{ amount_micros: 2490000, currency: "USD" }],
    entitlementKey: "solo",
    entitlementName: "Solo 이용권",
    offeringKey: "solo_monthly",
    offeringName: "Solo 월정액",
    packageKey: "solo_30",
    packageName: "Solo 30 (최대 30명)",
  },
  {
    label: "Solo 50",
    identifier: "swimnote_solo_50",
    playIdentifier: "swimnote_solo_50:monthly",
    displayName: "Solo 50",
    title: "SwimNote Solo 50 – 최대 50명",
    duration: "P1M",
    testPrices: [{ amount_micros: 4990000, currency: "USD" }],
    entitlementKey: "solo",
    entitlementName: "Solo 이용권",
    offeringKey: "solo_monthly",
    offeringName: "Solo 월정액",
    packageKey: "solo_50",
    packageName: "Solo 50 (최대 50명)",
  },
  {
    label: "Solo 100",
    identifier: "swimnote_solo_100",
    playIdentifier: "swimnote_solo_100:monthly",
    displayName: "Solo 100",
    title: "SwimNote Solo 100 – 최대 100명",
    duration: "P1M",
    testPrices: [{ amount_micros: 6990000, currency: "USD" }],
    entitlementKey: "solo",
    entitlementName: "Solo 이용권",
    offeringKey: "solo_monthly",
    offeringName: "Solo 월정액",
    packageKey: "solo_100",
    packageName: "Solo 100 (최대 100명)",
  },
];

const CENTER_PLAN: PlanDef = {
  label: "Center Monthly",
  identifier: "swimnote_center_monthly",
  playIdentifier: "swimnote_center_monthly:monthly",
  displayName: "Center 월정액",
  title: "SwimNote Center – 월정액",
  duration: "P1M",
  testPrices: [{ amount_micros: 49990000, currency: "USD" }],
  entitlementKey: "center",
  entitlementName: "Center 이용권",
  offeringKey: "center_monthly",
  offeringName: "Center 월정액",
  packageKey: "$rc_monthly",
  packageName: "월정액",
};

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

  // ── 2. 앱 (Test / App Store / Play Store) ────────────────────────────
  const { data: apps, error: listAppsError } = await listApps({ client, path: { project_id: project.id }, query: { limit: 20 } });
  if (listAppsError || !apps || apps.items.length === 0) throw new Error("No apps found");

  let testStoreApp = apps.items.find((a) => a.type === "test_store");
  let appStoreApp  = apps.items.find((a) => a.type === "app_store");
  let playStoreApp = apps.items.find((a) => a.type === "play_store");

  if (!testStoreApp) throw new Error("No test_store app found – RevenueCat 연결을 확인하세요");
  console.log("Test Store app:", testStoreApp.id);

  if (!appStoreApp) {
    const { data, error } = await createApp({ client, path: { project_id: project.id }, body: { name: APP_STORE_APP_NAME, type: "app_store", app_store: { bundle_id: APP_STORE_BUNDLE_ID } } });
    if (error) { console.error("App Store app 생성 실패:", error); throw new Error("Failed to create App Store app"); }
    appStoreApp = data;
    console.log("Created App Store app:", data.id);
  } else {
    console.log("App Store app:", appStoreApp.id);
  }

  if (!playStoreApp) {
    const { data, error } = await createApp({ client, path: { project_id: project.id }, body: { name: PLAY_STORE_APP_NAME, type: "play_store", play_store: { package_name: PLAY_STORE_PACKAGE_NAME } } });
    if (error) { console.error("Play Store app 생성 실패:", error); throw new Error("Failed to create Play Store app"); }
    playStoreApp = data;
    console.log("Created Play Store app:", data.id);
  } else {
    console.log("Play Store app:", playStoreApp.id);
  }

  // ── 3. 기존 데이터 목록 로드 ─────────────────────────────────────────
  const { data: existingProducts, error: listProductsError } = await listProducts({ client, path: { project_id: project.id }, query: { limit: 100 } });
  if (listProductsError) throw new Error("Failed to list products");

  const { data: existingEntitlements, error: listEntitlementsError } = await listEntitlements({ client, path: { project_id: project.id }, query: { limit: 20 } });
  if (listEntitlementsError) throw new Error("Failed to list entitlements");

  const { data: existingOfferings, error: listOfferingsError } = await listOfferings({ client, path: { project_id: project.id }, query: { limit: 20 } });
  if (listOfferingsError) throw new Error("Failed to list offerings");

  // ── 상품 생성 헬퍼 ────────────────────────────────────────────────────
  const ensureProduct = async (targetApp: App, label: string, storeId: string, plan: PlanDef, isTestStore: boolean): Promise<Product> => {
    const existing = existingProducts.items?.find((p) => p.store_identifier === storeId && p.app_id === targetApp.id);
    if (existing) { console.log(`    ${label} product exists:`, existing.id); return existing; }

    const body: CreateProductData["body"] = {
      store_identifier: storeId,
      app_id: targetApp.id,
      type: "subscription",
      display_name: plan.displayName,
    };
    if (isTestStore) {
      body.subscription = { duration: plan.duration };
      body.title = plan.title;
    }
    const { data, error } = await createProduct({ client, path: { project_id: project.id }, body });
    if (error) throw new Error(`Failed to create ${label} product for ${plan.label}: ${JSON.stringify(error)}`);
    console.log(`    Created ${label} product:`, data.id);
    return data;
  };

  // ── 이용권 생성 헬퍼 ────────────────────────────────────────────────
  const ensureEntitlement = async (key: string, name: string): Promise<Entitlement> => {
    const existing = existingEntitlements.items?.find((e) => e.lookup_key === key);
    if (existing) { console.log(`  Entitlement exists (${key}):`, existing.id); return existing; }
    const { data, error } = await createEntitlement({ client, path: { project_id: project.id }, body: { lookup_key: key, display_name: name } });
    if (error) throw new Error(`Failed to create entitlement ${key}`);
    console.log(`  Created entitlement (${key}):`, data.id);
    return data;
  };

  // ── 오퍼링 생성 헬퍼 ────────────────────────────────────────────────
  const ensureOffering = async (key: string, name: string): Promise<Offering> => {
    const existing = existingOfferings.items?.find((o) => o.lookup_key === key);
    if (existing) { console.log(`  Offering exists (${key}):`, existing.id); return existing; }
    const { data, error } = await createOffering({ client, path: { project_id: project.id }, body: { lookup_key: key, display_name: name } });
    if (error) throw new Error(`Failed to create offering ${key}`);
    console.log(`  Created offering (${key}):`, data.id);
    if (!data.is_current) {
      await updateOffering({ client, path: { project_id: project.id, offering_id: data.id }, body: { is_current: true } });
    }
    return data;
  };

  // ── 패키지 생성 헬퍼 ────────────────────────────────────────────────
  const ensurePackage = async (offeringId: string, packageKey: string, packageName: string): Promise<Package> => {
    const { data: pkgList, error: listPkgsError } = await listPackages({ client, path: { project_id: project.id, offering_id: offeringId }, query: { limit: 20 } });
    if (listPkgsError) throw new Error(`Failed to list packages for offering ${offeringId}`);

    const existing = pkgList.items?.find((p) => p.lookup_key === packageKey);
    if (existing) { console.log(`    Package exists (${packageKey}):`, existing.id); return existing; }

    const { data, error } = await createPackages({ client, path: { project_id: project.id, offering_id: offeringId }, body: { lookup_key: packageKey, display_name: packageName } });
    if (error) throw new Error(`Failed to create package ${packageKey}`);
    console.log(`    Created package (${packageKey}):`, data.id);
    return data;
  };

  // ── 4. Solo 플랜 3가지 처리 ──────────────────────────────────────────
  console.log("\n── Solo 플랜 설정 시작 ──");

  // Solo 오퍼링 1개 (Solo 30/50/100 공통)
  const soloOffering  = await ensureOffering("solo_monthly", "Solo 월정액");
  // Solo 이용권 1개 (Solo 30/50/100 공통)
  const soloEntitlement = await ensureEntitlement("solo", "Solo 이용권");

  const soloProductIds: string[] = [];

  for (const plan of SOLO_PLANS) {
    console.log(`\n  ▸ ${plan.label}`);

    const testProd  = await ensureProduct(testStoreApp!, "TestStore", plan.identifier,     plan, true);
    const iosProd   = await ensureProduct(appStoreApp!,  "AppStore",  plan.identifier,     plan, false);
    const droidProd = await ensureProduct(playStoreApp!, "PlayStore", plan.playIdentifier, plan, false);

    soloProductIds.push(testProd.id, iosProd.id, droidProd.id);

    // 테스트 스토어 가격
    const { error: priceErr } = await client.post<TestStorePricesResponse>({
      url: "/projects/{project_id}/products/{product_id}/test_store_prices",
      path: { project_id: project.id, product_id: testProd.id },
      body: { prices: plan.testPrices },
    });
    if (priceErr && (priceErr as any)?.type !== "resource_already_exists") {
      console.warn("    Warning – test store price:", JSON.stringify(priceErr));
    } else {
      console.log("    Test store price set");
    }

    // 패키지 생성 & 연결
    const pkg = await ensurePackage(soloOffering.id, plan.packageKey, plan.packageName);

    const { error: attachPkgErr } = await attachProductsToPackage({
      client,
      path: { project_id: project.id, package_id: pkg.id },
      body: {
        products: [
          { product_id: testProd.id,  eligibility_criteria: "all" },
          { product_id: iosProd.id,   eligibility_criteria: "all" },
          { product_id: droidProd.id, eligibility_criteria: "all" },
        ],
      },
    });
    if (attachPkgErr && !(attachPkgErr as any)?.message?.includes("Cannot attach product")) {
      console.warn("    Warning – attach package:", JSON.stringify(attachPkgErr));
    } else {
      console.log("    Package products attached");
    }
  }

  // Solo 이용권에 모든 Solo 상품 연결
  const { error: soloEntErr } = await attachProductsToEntitlement({
    client,
    path: { project_id: project.id, entitlement_id: soloEntitlement.id },
    body: { product_ids: soloProductIds },
  });
  if (soloEntErr && (soloEntErr as any)?.type !== "unprocessable_entity_error") {
    throw new Error("Failed to attach Solo products to solo entitlement");
  }
  console.log("\n  Solo 이용권에 Solo 30/50/100 모두 연결 완료");

  // ── 5. Center 플랜 처리 ───────────────────────────────────────────────
  console.log("\n── Center 플랜 설정 시작 ──");
  {
    const plan = CENTER_PLAN;
    const testProd  = await ensureProduct(testStoreApp!, "TestStore", plan.identifier,     plan, true);
    const iosProd   = await ensureProduct(appStoreApp!,  "AppStore",  plan.identifier,     plan, false);
    const droidProd = await ensureProduct(playStoreApp!, "PlayStore", plan.playIdentifier, plan, false);

    const { error: priceErr } = await client.post<TestStorePricesResponse>({
      url: "/projects/{project_id}/products/{product_id}/test_store_prices",
      path: { project_id: project.id, product_id: testProd.id },
      body: { prices: plan.testPrices },
    });
    if (priceErr && (priceErr as any)?.type !== "resource_already_exists") {
      console.warn("  Warning – center test store price:", JSON.stringify(priceErr));
    } else {
      console.log("  Center test store price set");
    }

    const centerEntitlement = await ensureEntitlement(plan.entitlementKey, plan.entitlementName);
    const { error: centerEntErr } = await attachProductsToEntitlement({
      client,
      path: { project_id: project.id, entitlement_id: centerEntitlement.id },
      body: { product_ids: [testProd.id, iosProd.id, droidProd.id] },
    });
    if (centerEntErr && (centerEntErr as any)?.type !== "unprocessable_entity_error") {
      throw new Error("Failed to attach Center products to entitlement");
    }
    console.log("  Center 이용권 연결 완료");

    const centerOffering = await ensureOffering(plan.offeringKey, plan.offeringName);
    const pkg = await ensurePackage(centerOffering.id, plan.packageKey, plan.packageName);
    const { error: attachPkgErr } = await attachProductsToPackage({
      client,
      path: { project_id: project.id, package_id: pkg.id },
      body: {
        products: [
          { product_id: testProd.id,  eligibility_criteria: "all" },
          { product_id: iosProd.id,   eligibility_criteria: "all" },
          { product_id: droidProd.id, eligibility_criteria: "all" },
        ],
      },
    });
    if (attachPkgErr && !(attachPkgErr as any)?.message?.includes("Cannot attach product")) {
      console.warn("  Warning – attach center package:", JSON.stringify(attachPkgErr));
    } else {
      console.log("  Center 패키지 연결 완료");
    }
  }

  // ── 6. API 키 출력 ─────────────────────────────────────────────────
  const { data: testKeys }  = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: testStoreApp!.id } });
  const { data: iosKeys }   = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: appStoreApp!.id } });
  const { data: droidKeys } = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: playStoreApp!.id } });

  const testKey  = testKeys?.items[0]?.key  ?? "???";
  const iosKey   = iosKeys?.items[0]?.key   ?? "???";
  const droidKey = droidKeys?.items[0]?.key ?? "???";

  console.log("\n====================");
  console.log("RevenueCat 설정 완료!");
  console.log("Project ID:", project.id);
  console.log("Test Store App ID:", testStoreApp!.id);
  console.log("App Store App ID:",  appStoreApp!.id);
  console.log("Play Store App ID:", playStoreApp!.id);
  console.log("Public API Keys - Test Store:", testKey);
  console.log("Public API Keys - App Store:",  iosKey);
  console.log("Public API Keys - Play Store:", droidKey);
  console.log("Entitlements: solo, center");
  console.log("Offerings: solo_monthly (packages: solo_30, solo_50, solo_100) | center_monthly");
  console.log("====================\n");
  console.log("▼ 아래 환경변수를 Replit Secrets에 저장하세요 ▼");
  console.log(`REVENUECAT_PROJECT_ID=${project.id}`);
  console.log(`REVENUECAT_TEST_STORE_APP_ID=${testStoreApp!.id}`);
  console.log(`REVENUECAT_APPLE_APP_STORE_APP_ID=${appStoreApp!.id}`);
  console.log(`REVENUECAT_GOOGLE_PLAY_STORE_APP_ID=${playStoreApp!.id}`);
  console.log(`EXPO_PUBLIC_REVENUECAT_TEST_API_KEY=${testKey}`);
  console.log(`EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=${iosKey}`);
  console.log(`EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=${droidKey}`);
}

seedRevenueCat().catch(console.error);
