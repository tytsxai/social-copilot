# Changelog

所有重要的变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增
- 思路卡片推荐与 UI：根据当前消息推荐共情/方案/幽默/中性方向，可选方向会注入提示词
- LLM 输入支持 `thoughtDirection` / `thoughtHint`，DeepSeek/OpenAI/Claude 提示词加入思路引导
- 核心文档补充（README、API、ARCHITECTURE、DEVELOPMENT）

### 计划中
- Discord Web 适配器
- 向量检索功能

## [0.1.0] - 2024-12-09

### 新增
- 🎉 首个版本发布
- 智能回复建议功能（多风格候选）
- 联系人画像自动学习
- 本地数据持久化（IndexedDB）
- 快捷键操作（Alt+S 触发，Esc 关闭）
- 多模型支持（DeepSeek、OpenAI、Claude）
- LLM 自动故障转移机制
- 风格偏好学习（自动记忆用户选择）
- 面板位置记忆（拖拽调整后自动保存）

### 支持平台
- Telegram Web（K 版 & A 版）
- WhatsApp Web
- Slack Web

### 回复风格
- 💗 caring - 关心体贴
- 😄 humorous - 幽默风趣
- 😊 casual - 随意轻松
- 🧠 rational - 理性客观
- 📝 formal - 正式礼貌
