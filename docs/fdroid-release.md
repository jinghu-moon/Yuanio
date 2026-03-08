# F-Droid 发布流程

本文档定义仓库侧的 F-Droid 发布准备流程。

## 1. 前置条件

1. Android release 签名已配置：`android-app/keystore/keystore.properties`
2. Release 构建可通过
3. `fdroid/metadata/com.yuanio.app.yml` 已更新版本号

## 2. 本地验证

在项目根目录执行：

```bash
cd android-app
./gradlew :app:assembleRelease
./gradlew :app:bundleRelease
```

构建产物：

1. `android-app/app/build/outputs/apk/release/app-release.apk`
2. `android-app/app/build/outputs/bundle/release/app-release.aab`

## 3. metadata 维护

编辑：

1. `fdroid/metadata/com.yuanio.app.yml`

每次发布至少更新：

1. `Builds[].versionName`
2. `Builds[].versionCode`
3. `Builds[].commit`（建议使用 tag 或 commit hash）

## 4. 提交到 F-Droid Data

1. Fork `fdroiddata` 仓库
2. 将 `fdroid/metadata/com.yuanio.app.yml` 同步到 `metadata/com.yuanio.app.yml`
3. 提交 PR，等待 bot 构建与人工审核

## 5. 当前约束

1. 本仓库已完成发布侧产物与 metadata 模板准备
2. 实际上架由 F-Droid Data PR 审核结果决定
