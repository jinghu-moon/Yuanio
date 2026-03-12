import java.io.FileInputStream
import java.util.Properties
import org.gradle.api.tasks.testing.logging.TestExceptionFormat
import org.gradle.api.tasks.testing.logging.TestLogEvent

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "sy.yuanio.app"
    compileSdk = 36

    val keystoreProperties = Properties()
    val localPropertiesFile = rootProject.file("local.properties")
    val legacyKeystorePropertiesFile = rootProject.file("keystore/keystore.properties")
    val keystorePropertiesFile = sequenceOf(localPropertiesFile, legacyKeystorePropertiesFile)
        .firstOrNull { it.exists() }
    if (keystorePropertiesFile != null) {
        keystoreProperties.load(FileInputStream(keystorePropertiesFile))
    }

    fun signingValue(vararg keys: String): String? {
        return keys.firstNotNullOfOrNull { key ->
            keystoreProperties.getProperty(key)?.takeIf { it.isNotBlank() }
        }
    }

    defaultConfig {
        applicationId = "sy.yuanio.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    lint {
        baseline = file("lint-baseline.xml")
    }

    flavorDimensions += "mlkit"
    productFlavors {
        create("full") {
            dimension = "mlkit"
            buildConfigField("boolean", "FEATURE_TRANSLATION", "true")
            buildConfigField("boolean", "FEATURE_OCR", "true")
        }
        create("lite") {
            dimension = "mlkit"
            buildConfigField("boolean", "FEATURE_TRANSLATION", "false")
            buildConfigField("boolean", "FEATURE_OCR", "false")
            applicationIdSuffix = ".lite"
            versionNameSuffix = "-lite"
        }
    }

    signingConfigs {
        val storeFileValue = signingValue("releaseStoreFile", "storeFile")
        val storePasswordValue = signingValue("releaseStorePassword", "storePassword")
        val keyAliasValue = signingValue("releaseKeyAlias", "keyAlias")
        val keyPasswordValue = signingValue("releaseKeyPassword", "keyPassword")
        if (
            keystorePropertiesFile != null &&
            storeFileValue != null &&
            storePasswordValue != null &&
            keyAliasValue != null &&
            keyPasswordValue != null
        ) {
            create("release") {
                storeFile = rootProject.file(storeFileValue)
                storePassword = storePasswordValue
                keyAlias = keyAliasValue
                keyPassword = keyPasswordValue
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
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    val isBundleBuild = gradle.startParameter.taskNames.any { it.contains("bundle", ignoreCase = true) }
    splits {
        abi {
            // 非 bundle 构建启用 ABI 拆分，产出更小的 release APK
            isEnable = !isBundleBuild
            if (!isBundleBuild) {
                reset()
                include("arm64-v8a", "armeabi-v7a", "x86_64")
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

    add("fullImplementation", "com.google.mlkit:text-recognition-chinese:16.0.0")
    add("fullImplementation", "com.google.mlkit:translate:17.0.3")
    implementation("com.google.zxing:core:3.5.3")

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

    testImplementation("junit:junit:4.13.2")

    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}



