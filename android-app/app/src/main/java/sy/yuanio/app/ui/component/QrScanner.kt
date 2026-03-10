package sy.yuanio.app.ui.component

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import sy.yuanio.app.R
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.MultiFormatReader
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer

@androidx.camera.core.ExperimentalGetImage
@Composable
fun QrScanner(onResult: (String) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    val isResolved = remember { AtomicBoolean(false) }
    var cameraProvider by remember { mutableStateOf<ProcessCameraProvider?>(null) }
    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
                    == PackageManager.PERMISSION_GRANTED
        )
    }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { hasPermission = it }

    LaunchedEffect(Unit) {
        if (!hasPermission) launcher.launch(Manifest.permission.CAMERA)
    }

    DisposableEffect(Unit) {
        onDispose {
            cameraProvider?.unbindAll()
            executor.shutdown()
        }
    }

    if (!hasPermission) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.qr_permission_required))
        }
        return
    }

    Box(Modifier.fillMaxSize()) {
        AndroidView(
            factory = { ctx ->
                val previewView = PreviewView(ctx)
                val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)

                cameraProviderFuture.addListener({
                    val provider = cameraProviderFuture.get().also { cameraProvider = it }
                    val preview = Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }
                    val analysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()

                    analysis.setAnalyzer(executor, QrAnalyzer(isResolved, onResult))

                    provider.unbindAll()
                    provider.bindToLifecycle(
                        lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA,
                        preview, analysis
                    )
                }, ContextCompat.getMainExecutor(ctx))

                previewView
            },
            modifier = Modifier.fillMaxSize()
        )

        QrScannerOverlay(
            modifier = Modifier.fillMaxSize(),
            frameSize = 260.dp
        )

        // 关闭按钮
        Button(
            onClick = onDismiss,
            modifier = Modifier.align(Alignment.BottomCenter).padding(24.dp)
        ) { Text(stringResource(R.string.common_cancel)) }
    }
}

private class QrAnalyzer(
    private val resolved: AtomicBoolean,
    private val onResult: (String) -> Unit
) : ImageAnalysis.Analyzer {

    private val reader = MultiFormatReader().apply {
        setHints(
            mapOf(
                DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE)
            )
        )
    }

    override fun analyze(image: ImageProxy) {
        if (resolved.get()) {
            image.close()
            return
        }
        val buffer = image.planes.firstOrNull()?.buffer
        if (buffer == null) {
            image.close()
            return
        }
        buffer.rewind()
        val data = ByteArray(buffer.remaining())
        buffer.get(data)

        val source = PlanarYUVLuminanceSource(
            data,
            image.width,
            image.height,
            0,
            0,
            image.width,
            image.height,
            false
        )

        val rotatedSource = rotateSource(source, image.imageInfo.rotationDegrees)
        val bitmap = BinaryBitmap(HybridBinarizer(rotatedSource))

        try {
            val result = reader.decodeWithState(bitmap)
            if (resolved.compareAndSet(false, true)) {
                onResult(result.text.orEmpty())
            }
        } catch (_: NotFoundException) {
            // ignore
        } finally {
            reader.reset()
            image.close()
        }
    }

    private fun rotateSource(
        source: PlanarYUVLuminanceSource,
        rotationDegrees: Int
    ): LuminanceSource {
        return when (rotationDegrees) {
            90 -> source.rotateCounterClockwise()
            180 -> source.rotateCounterClockwise().rotateCounterClockwise()
            270 -> source.rotateCounterClockwise().rotateCounterClockwise().rotateCounterClockwise()
            else -> source
        }
    }
}

@Composable
private fun QrScannerOverlay(modifier: Modifier, frameSize: Dp) {
    Box(modifier) {
        Box(
            modifier = Modifier
                .align(Alignment.Center)
                .size(frameSize)
                .border(2.dp, MaterialTheme.colorScheme.primary, MaterialTheme.shapes.medium)
        )
    }
}

