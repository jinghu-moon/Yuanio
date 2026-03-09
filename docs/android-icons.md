# Android 图标规范

本文记录 `android-app/app/src/main/res/drawable` 中图标资源的当前约束，避免再次引入不可见、错位或风格失配的问题。

## 当前规范

### UI 操作图标：`ic_tb_*.xml`

- UI glyph 统一使用 **Tabler outline** 风格的 `VectorDrawable`
- 文件命名统一为 `ic_tb_<name>.xml`
- 默认使用 `24 x 24` 视口，保持与 Compose `Icon` 用法一致
- 着色由 Compose `Icon(..., tint = ...)` 或主题层控制

常见示例：
- `ic_tb_message_circle.xml`
- `ic_tb_terminal_2.xml`
- `ic_tb_folder.xml`
- `ic_tb_alert_triangle.xml`
- `ic_tb_circle_check.xml`
- `ic_tb_player_stop.xml`
- `ic_tb_volume.xml`

### 品牌图标：`ic_ai_*.xml`

- 品牌图标仅用于 Claude / OpenAI / Gemini / Anthropic 等 agent 标识
- 文件命名统一为 `ic_ai_<brand>.xml`
- **严禁**把品牌图标当作单色 UI glyph 使用
- 默认应保留资源内建颜色；不要无条件强制统一 tint

代码接入点：
- `android-app/app/src/main/java/com/yuanio/app/ui/component/BrandIcons.kt`
- `android-app/app/src/main/java/com/yuanio/app/ui/chat/MessageBubble.kt`
- `android-app/app/src/main/java/com/yuanio/app/ui/component/ToolCallCard.kt`

## 历史说明

- 旧的 Material 图标资源已在 `2026-03-09` 清理出仓库有效引用路径
- 如需追溯历史迁移，可查看：
  - `refer/yuanio-mobile-comprehensive-blueprint.md`
  - `refer/yuanio-mobile-decision-matrix.md`
  - `.ai/analysis/ai.report.json`

## 新增图标规则

1. 优先使用 Tabler 官方图标语义，不要为了贴近旧命名继续沿用 `ic_ms_*`
2. 资源落点固定为 `android-app/app/src/main/res/drawable`
3. 新增后优先检查是否需要同步到：
   - `android-app/app/src/main/java/com/yuanio/app/ui/component/BrandIcons.kt`
   - `tools/check_tabler_icons.py`（仅当它属于被校验的基准子集时）
4. 如果只是品牌视觉，不要混入 `ic_tb_*`
