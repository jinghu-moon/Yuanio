import java.io.FileInputStream
import java.util.Properties
import org.gradle.api.tasks.testing.logging.TestExceptionFormat
import org.gradle.api.tasks.testing.logging.TestLogEvent

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
}

android {
    namespace = "com.yuanio.app"
    compileSdk = 36

    val keystoreProperties = Properties()
    val keystorePropertiesFile = rootProject.file("keystore/keystore.properties")
    if (keystorePropertiesFile.exists()) {
        keystoreProperties.load(FileInputStream(keystorePropertiesFile))
    }

    defaultConfig {
        applicationId = "com.yuanio.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        if (keystorePropertiesFile.exists()) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    val isBundleBuild = gradle.startParameter.taskNames.any { it.contains("bundle", ignoreCase = true) }
    val isReleaseTask = gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) }
    splits {
        abi {
            // 快速开发期不追求 release ABI split，避免 assembleRelease 在 shrink/minify 链路上发生冲突
            isEnable = !isBundleBuild && !isReleaseTask
            if (!isBundleBuild && !isReleaseTask) {
                reset()
                include("arm64-v8a")
                isUniversalApk = false
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.all {
            it.jvmArgs(
                "-Dfile.encoding=UTF-8",
                "-Dsun.stdout.encoding=UTF-8",
                "-Dsun.stderr.encoding=UTF-8",
            )
            it.systemProperty("file.encoding", "UTF-8")
            it.systemProperty("sun.stdout.encoding", "UTF-8")
            it.systemProperty("sun.stderr.encoding", "UTF-8")
            it.testLogging {
                showStandardStreams = true
                events(
                    TestLogEvent.PASSED,
                    TestLogEvent.SKIPPED,
                    TestLogEvent.FAILED,
                    TestLogEvent.STANDARD_OUT,
                    TestLogEvent.STANDARD_ERROR,
                )
                exceptionFormat = TestExceptionFormat.FULL
            }
        }
    }
}


composeCompiler {
    stabilityConfigurationFiles.add(rootProject.layout.projectDirectory.file("stability_config.conf"))
    metricsDestination = layout.buildDirectory.dir("compose_metrics")
    reportsDestination = layout.buildDirectory.dir("compose_metrics")
}
dependencies {
    // Compose BOM
    val composeBom = platform("androidx.compose:compose-bom:2026.01.01")
    implementation(composeBom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Navigation
    implementation("androidx.navigation:navigation-compose:2.7.7")

    // Lifecycle + ViewModel
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.7.0")
    implementation("androidx.activity:activity-compose:1.8.2")

    // OkHttp
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Socket.IO
    implementation("io.socket:socket.io-client:2.1.1")

    // BouncyCastle (HKDF + crypto primitives)
    implementation("org.bouncycastle:bcprov-jdk15to18:1.83")
    implementation("com.lambdapioneer.argon2kt:argon2kt:1.6.0")

    // Encrypted SharedPreferences
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Biometric
    implementation("androidx.biometric:biometric:1.1.0")

    // ML Kit Barcode（QR 扫码）
    implementation("com.google.mlkit:barcode-scanning:17.2.0")
    implementation("com.google.mlkit:text-recognition-chinese:16.0.0")
    implementation("com.google.mlkit:translate:17.0.3")

    // CameraX（二维码扫描相机）
    implementation("androidx.camera:camera-camera2:1.3.1")
    implementation("androidx.camera:camera-lifecycle:1.3.1")
    implementation("androidx.camera:camera-view:1.3.1")

    // Fragment（BiometricPrompt 需要 FragmentActivity）
    implementation("androidx.fragment:fragment-ktx:1.6.2")

    // Core
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // Native Markdown renderer (Compose, no WebView)
    implementation("com.mikepenz:multiplatform-markdown-renderer-m3-android:0.39.2")
    implementation("com.mikepenz:multiplatform-markdown-renderer-code-android:0.39.2")
    implementation("org.connectbot:termlib:0.0.18")

    // SSH（mwiede/jsch fork：轻量、纯 Java、支持 Ed25519/ECDSA）
    implementation("com.github.mwiede:jsch:0.2.21")

    // Firebase
    implementation(platform("com.google.firebase:firebase-bom:32.7.0"))
    implementation("com.google.firebase:firebase-messaging")

    testImplementation("junit:junit:4.13.2")

    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}


