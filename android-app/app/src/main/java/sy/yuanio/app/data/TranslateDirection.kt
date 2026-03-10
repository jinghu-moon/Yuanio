package sy.yuanio.app.data

enum class TranslateDirection(
    val sourceTag: String,
    val targetTag: String,
) {
    ZH_TO_EN("zh", "en"),
    EN_TO_ZH("en", "zh"),
}
