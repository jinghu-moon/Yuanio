package sy.yuanio.app.ui.component

import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import sy.yuanio.app.data.ArtifactType

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ArtifactWebView(
    content: String,
    type: ArtifactType,
    modifier: Modifier = Modifier
) {
    val html = when (type) {
        ArtifactType.HTML -> wrapHtml(content)
        ArtifactType.SVG -> wrapSvg(content)
        ArtifactType.MERMAID -> wrapMermaid(content)
        else -> wrapHtml("<pre>$content</pre>")
    }

    AndroidView(
        factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = true
                webViewClient = WebViewClient()
                setBackgroundColor(0x00000000)
            }
        },
        update = { webView ->
            webView.loadDataWithBaseURL(
                "https://artifact.local",
                html,
                "text/html",
                "UTF-8",
                null
            )
        },
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 120.dp, max = 400.dp)
    )
}

private fun wrapHtml(body: String): String = """
<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin:8px; font-family:sans-serif; background:transparent; color:#e0e0e0; }
  img { max-width:100%; height:auto; }
</style>
</head><body>$body</body></html>
""".trimIndent()

private fun wrapSvg(svg: String): String = """
<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin:0; display:flex; justify-content:center; align-items:center;
         min-height:100vh; background:transparent; }
  svg { max-width:100%; height:auto; }
</style>
</head><body>$svg</body></html>
""".trimIndent()

private fun wrapMermaid(code: String): String = """
<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>
  body { margin:8px; background:transparent; }
  .mermaid { display:flex; justify-content:center; }
</style>
</head><body>
<div class="mermaid">$code</div>
<script>mermaid.initialize({startOnLoad:true,theme:'dark'});</script>
</body></html>
""".trimIndent()

