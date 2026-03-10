package sy.yuanio.app.ui.component

/**
 * Streaming-only markdown sanitizer.
 * The output is for rendering only; it does not mutate the stored message content.
 */
internal fun sanitizeStreamingMarkdown(text: String): String {
    if (text.isBlank()) return text
    val input = text
    val builder = StringBuilder(input)

    var inFence = false
    var i = 0
    while (i <= input.length - 3) {
        if (input.startsWith("```", i)) {
            inFence = !inFence
            i += 3
            continue
        }
        i += 1
    }
    if (inFence) {
        builder.append("\n```")
        return builder.toString()
    }

    var inInlineCode = false
    var doubleStarCount = 0
    i = 0
    while (i < input.length) {
        if (i <= input.length - 3 && input.startsWith("```", i)) {
            inFence = !inFence
            i += 3
            continue
        }
        if (inFence) {
            i += 1
            continue
        }
        val ch = input[i]
        if (ch == '`') {
            inInlineCode = !inInlineCode
            i += 1
            continue
        }
        if (!inInlineCode && i <= input.length - 2 && input.startsWith("**", i)) {
            doubleStarCount += 1
            i += 2
            continue
        }
        i += 1
    }

    if (inInlineCode) {
        builder.append('`')
    }
    if (doubleStarCount % 2 == 1) {
        builder.append("**")
    }

    return builder.toString()
}

