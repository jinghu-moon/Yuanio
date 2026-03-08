# Android 图标规范

本文记录 Android 端图标资源的来源与处理方式，避免后续引入时再次出现不可见或错位的问题。

## Material Symbols（`ic_ms_*.xml`）

这些图标来自 Material Symbols 导出，使用 **960 视口坐标系**，并且包含 **负 Y 坐标**。  
如果直接使用 `viewportWidth/Height=24`，图标会被裁剪，导致“显示为空”。

处理规则：
1. 统一设置 `viewportWidth="960"` 与 `viewportHeight="960"`  
2. 在根节点下包一层 `<group android:translateY="960">`  

已提供脚本用于批量修复：  
```
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts/fix-material-symbols.ps1"
```

## LobeHub 品牌图标（Claude / OpenAI / Gemini / Anthropic）

图标来源：`refer/lobe-icons/packages/static-svg/icons`  
当前采用 **VectorDrawable（SVG 转换）**：
- 文件命名：`ic_ai_*.xml`
- 使用 `fillColor="#000000"`，由 Compose `Icon` 的 `tint` 统一着色  

接入位置：
1. 顶部栏（ChatScreen）
2. 模型切换（AgentSelector）
3. 会话列表（SessionListScreen）
4. 启动页（PairingScreen）
5. 设置页（SettingsScreen）
6. 终端页（TerminalScreen）
7. 通知卡片（ApprovalCard / ToolCallCard）

新增品牌时建议：
1. 从 `static-svg/icons` 选择 SVG
2. 转成 VectorDrawable 后放入 `res/drawable`
3. 在 `BrandIcons.kt` 中补充 `Brand` / `brandIconRes` / `brandColor`
