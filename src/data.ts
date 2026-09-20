import { id, type Component, type GitHubPullRequest, type Release, type RepositoryReadme, type Team } from "./domain";

export const teams: Team[] = [
  { id: id("team-identity"), name: "ID基盤チーム", lead: "田中 健", memberCount: 7 },
  { id: id("team-ios"), name: "iOSチーム", lead: "佐藤 葵", memberCount: 5 },
  { id: id("team-android"), name: "Androidチーム", lead: "鈴木 拓", memberCount: 6 },
  { id: id("team-ops"), name: "運用管理チーム", lead: "高橋 凛", memberCount: 4 },
];

export const components: Component[] = [
  { id: id("component-backend"), name: "バックエンド", kind: "backend", ownerTeamId: id("team-identity"), repository: "product/backend", repositoryUrl: "https://github.com/product/backend", defaultBranch: "main", githubConnection: "mock", deliveryMethod: "本番環境へデプロイ" },
  { id: id("component-ios"), name: "iOS", kind: "ios", ownerTeamId: id("team-ios"), repository: "product/ios", repositoryUrl: "https://github.com/product/ios", defaultBranch: "main", githubConnection: "mock", deliveryMethod: "App Storeで段階公開" },
  { id: id("component-android"), name: "Android", kind: "android", ownerTeamId: id("team-android"), repository: "product/android", repositoryUrl: "https://github.com/product/android", defaultBranch: "main", githubConnection: "mock", deliveryMethod: "Google Playで段階公開" },
  { id: id("component-admin"), name: "管理画面", kind: "admin", ownerTeamId: id("team-ops"), repository: "product/admin", repositoryUrl: "https://github.com/product/admin", defaultBranch: "main", githubConnection: "mock", deliveryMethod: "本番環境へデプロイ" },
];

export const githubPullRequests: GitHubPullRequest[] = [
  { componentId: id("component-backend"), repository: "product/backend", number: 1842, title: "本人確認ステータスAPIを追加", body: "本人確認の審査状態と差し戻し理由を返すAPIを追加します。既存レスポンスとの後方互換性を維持します。", author: "tanaka", state: "merged", revision: "a82f9c1", baseBranch: "main", labels: ["feature", "database", "expand-migration"], changedFiles: ["api/identity/status.ts", "db/migrations/20260918_add_kyc_status.sql", "openapi/identity.yaml"], additions: 428, deletions: 36, updatedAt: "2026-09-18T10:24:00+09:00" },
  { componentId: id("component-ios"), repository: "product/ios", number: 921, title: "本人確認フローを更新", body: "本人確認の入力画面と審査状態画面を更新します。新APIはFeature Flagが有効な場合のみ利用します。", author: "sato", state: "review", revision: "5d442a7", baseBranch: "main", labels: ["feature", "feature-flag"], changedFiles: ["KYC/KYCFlowView.swift", "KYC/KYCStatusClient.swift", "Tests/KYCFlowTests.swift"], additions: 312, deletions: 94, updatedAt: "2026-09-19T16:40:00+09:00" },
  { componentId: id("component-android"), repository: "product/android", number: 887, title: "本人確認フローを更新", body: "本人確認入力をComposeへ移行し、新しい審査状態APIへ接続します。", author: "suzuki", state: "review", revision: "2ce84d0", baseBranch: "main", labels: ["feature", "feature-flag"], changedFiles: ["feature/kyc/KycRoute.kt", "data/KycRepository.kt", "feature/kyc/KycViewModelTest.kt"], additions: 377, deletions: 121, updatedAt: "2026-09-19T14:12:00+09:00" },
  { componentId: id("component-admin"), repository: "product/admin", number: 441, title: "本人確認状況の参照項目を追加", body: "ユーザー詳細に審査状態と最終更新日時を追加します。", author: "takahashi", state: "merged", revision: "b19ad42", baseBranch: "main", labels: ["feature"], changedFiles: ["pages/users/[id].tsx", "features/users/KycStatus.tsx"], additions: 146, deletions: 18, updatedAt: "2026-09-18T18:05:00+09:00" },
  { componentId: id("component-backend"), repository: "product/backend", number: 1864, title: "本人確認イベントの監査ログを追加", body: "審査状態の変更イベントを監査ログへ記録します。テーブル追加を含みます。", author: "nakamura", state: "review", revision: "df81c02", baseBranch: "main", labels: ["feature", "database", "online-migration"], changedFiles: ["domain/identity/audit.ts", "db/migrations/20260920_create_kyc_audit.sql", "workers/audit-writer.ts"], additions: 284, deletions: 12, updatedAt: "2026-09-20T09:35:00+09:00" },
  { componentId: id("component-admin"), repository: "product/admin", number: 448, title: "審査履歴タイムラインを追加", body: "監査ログAPIを利用して本人確認の状態変更履歴を表示します。バックエンドPR #1864の反映後に有効化します。", author: "ito", state: "draft", revision: "91ab77e", baseBranch: "main", labels: ["feature", "depends-on-api"], changedFiles: ["features/users/KycHistory.tsx", "api/kycHistory.ts"], additions: 198, deletions: 4, updatedAt: "2026-09-20T11:08:00+09:00" },
];

export const repositoryReadmes: RepositoryReadme[] = [
  { componentId: id("component-backend"), repository: "product/backend", path: "README.md", revision: "main@a82f9c1", summary: "本番デプロイとDB migrationの実行順を記載", commands: [{ purpose: "expand migration", command: "pnpm db:migrate:production" }, { purpose: "本番デプロイ", command: "pnpm deploy:production --revision <revision>" }], cautions: ["schemaの削除は旧クライアントの利用終了後に実行", "デプロイ後にAPI契約テストを実行"] },
  { componentId: id("component-ios"), repository: "product/ios", path: "README.md", revision: "main@5d442a7", summary: "TestFlight検証とApp Store段階公開の操作を記載", commands: [{ purpose: "リリースビルド", command: "bundle exec fastlane release" }], cautions: ["段階公開中はFeature Flagを既定で無効化", "問題発生時は配信停止とFeature Flag無効化を併用"] },
  { componentId: id("component-android"), repository: "product/android", path: "README.md", revision: "main@2ce84d0", summary: "内部テストとGoogle Play段階公開の操作を記載", commands: [{ purpose: "リリースbundle", command: "./gradlew bundleRelease" }], cautions: ["内部テスト完了後に段階公開へ昇格", "エラー率が基準を超えた場合は段階公開を停止"] },
  { componentId: id("component-admin"), repository: "product/admin", path: "README.md", revision: "main@b19ad42", summary: "管理画面のbuild、本番反映、反映後確認を記載", commands: [{ purpose: "production build", command: "pnpm build" }, { purpose: "本番デプロイ", command: "pnpm deploy:production --revision <revision>" }], cautions: ["バックエンドAPI反映後にデプロイ", "ユーザー詳細の本人確認状態を反映後に確認"] },
];

const identityChanges = [
  { id: id<"ComponentChange">("change-backend-kyc"), componentId: id<"Component">("component-backend"), ownerTeamId: id<"Team">("team-identity"), summary: "本人確認ステータスAPIを追加", pullRequests: [{ repository: "product/backend", number: 1842, revision: "a82f9c1", state: "merged" as const }], migration: { required: true, phase: "expand" as const, execution: "online" as const, backwardCompatible: true, estimatedMinutes: 8 }, maintenance: "none" as const, dependencyIds: [], deploymentWindow: "9月24日 19:00", recovery: "旧APIへ切り戻し" },
  { id: id<"ComponentChange">("change-ios-kyc"), componentId: id<"Component">("component-ios"), ownerTeamId: id<"Team">("team-ios"), summary: "本人確認フローを更新", pullRequests: [{ repository: "product/ios", number: 921, revision: "5d442a7", state: "review" as const }], migration: { required: false }, maintenance: "none" as const, dependencyIds: [id<"ComponentChange">("change-backend-kyc")], deploymentWindow: "9月27日 審査通過後", recovery: "Feature Flagを無効化" },
  { id: id<"ComponentChange">("change-android-kyc"), componentId: id<"Component">("component-android"), ownerTeamId: id<"Team">("team-android"), summary: "本人確認フローを更新", pullRequests: [{ repository: "product/android", number: 887, revision: "2ce84d0", state: "review" as const }], migration: { required: false }, maintenance: "none" as const, dependencyIds: [id<"ComponentChange">("change-backend-kyc")], deploymentWindow: "9月27日 審査通過後", recovery: "Feature Flagを無効化" },
  { id: id<"ComponentChange">("change-admin-kyc"), componentId: id<"Component">("component-admin"), ownerTeamId: id<"Team">("team-ops"), summary: "本人確認状況の参照項目を追加", pullRequests: [{ repository: "product/admin", number: 441, revision: "b19ad42", state: "merged" as const }], migration: { required: false }, maintenance: "none" as const, dependencyIds: [id<"ComponentChange">("change-backend-kyc")], deploymentWindow: "9月24日 20:00", recovery: "直前revisionへ切り戻し" },
];

export const releases: Release[] = [
  {
    id: id("release-024"), code: "R–024", name: "本人確認フロー刷新", status: "preparing", ownerTeamId: id("team-identity"), scheduledFor: "2026-09-27",
    featureChanges: [{ id: id("feature-128"), name: "本人確認フロー刷新", description: "本人確認の入力と審査状態表示を更新する", componentChanges: identityChanges }],
    verifications: [
      { id: id("verify-api"), releaseId: id("release-024"), componentChangeId: id("change-backend-kyc"), name: "API契約テスト", condition: "バックエンド反映後", ownerTeamId: id("team-identity"), status: "pending" },
      { id: id("verify-migration"), releaseId: id("release-024"), componentChangeId: id("change-backend-kyc"), name: "migration完了確認", condition: "migration実行直後", ownerTeamId: id("team-identity"), status: "pending" },
      { id: id("verify-ios"), releaseId: id("release-024"), componentChangeId: id("change-ios-kyc"), name: "TestFlight実機回帰", condition: "審査提出前", ownerTeamId: id("team-ios"), status: "running" },
      { id: id("verify-android"), releaseId: id("release-024"), componentChangeId: id("change-android-kyc"), name: "内部テスト実機回帰", condition: "審査提出前", ownerTeamId: id("team-android"), status: "running" },
    ],
  },
  { id: id("release-025"), code: "R–025", name: "通知設定の再設計", status: "draft", ownerTeamId: id("team-ios"), scheduledFor: "2026-10-04", featureChanges: [{ id: id("feature-131"), name: "通知設定の再設計", description: "通知カテゴリと許諾導線を変更する", componentChanges: [] }], verifications: [] },
  { id: id("release-023"), code: "R–023", name: "監査ログ検索改善", status: "ready", ownerTeamId: id("team-ops"), scheduledFor: "2026-09-22", featureChanges: [{ id: id("feature-125"), name: "監査ログ検索改善", description: "管理画面の監査ログ検索条件を追加する", componentChanges: [] }], verifications: [] },
  { id: id("release-022"), code: "R–022", name: "セッション更新方式変更", status: "completed", ownerTeamId: id("team-identity"), scheduledFor: "2026-09-15", featureChanges: [{ id: id("feature-119"), name: "セッション更新方式変更", description: "アクセストークン更新方式を変更する", componentChanges: [] }], verifications: [] },
];

export const teamById = (teamId: Team["id"]) => teams.find((team) => team.id === teamId)!;
export const componentById = (componentId: Component["id"]) => components.find((component) => component.id === componentId)!;
