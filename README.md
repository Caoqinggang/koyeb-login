# 🎭 Koyeb Web Login Keep-Alive (Playwright Version)

这是一个基于 GitHub Actions 和 Playwright 的自动化脚本，用于定期模拟真人浏览器登录 Koyeb 控制台。

与普通的 API 保活不同，本脚本通过模拟**真实网页登录**操作（输入账号、密码、处理验证），有效防止账号因长期未登录 Web 端而被判定为不活跃。

![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/你的用户名/你的仓库名/koyeb-login.yml?label=Web-Login)

## ✨ 核心特性

*   **🛡️ 强力绕过检测**: 集成 `puppeteer-extra-plugin-stealth` 和 `playwright-extra`，隐藏自动化特征。
*   **🖱️ 模拟真人操作**: 针对 Cloudflare 验证盾，脚本内置了**拟人化鼠标轨迹算法**（随机抖动、悬停、微调移动），大幅提高通过率。
*   **📸 截图通知**: 无论登录成功还是失败，都会自动截取当前页面并通过 Telegram Bot 发送图片，状态一目了然。
*   **🔄 多账号支持**: 默认配置支持 2 个账号轮询登录（可按需扩展）。
*   **⏰ 定时运行**: 配置为每 10 天自动运行一次，由 GitHub Actions 托管，无需本地服务器。

## ⚙️ 配置指南

### 1. 获取 Telegram 通知配置 (可选)
为了接收登录截图，你需要：
1.  在 Telegram 找 [@BotFather](https://t.me/BotFather) 创建机器人，获取 **Token**。
2.  在 Telegram 找 [@userinfobot](https://t.me/userinfobot) 获取你的 **Chat ID**。

### 2. 设置 GitHub Secrets
在你的 GitHub 仓库中，依次点击 **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**，添加以下变量：

| Secret 名称 | 必填 | 说明 |
| :--- | :---: | :--- |
| `EMAIL1` | ✅ | 第 1 个 Koyeb 账号邮箱 |
| `PASSWORD1` | ✅ | 第 1 个 Koyeb 账号密码 |
| `EMAIL2` | ❌ | 第 2 个 Koyeb 账号邮箱 (如无则不填) |
| `PASSWORD2` | ❌ | 第 2 个 Koyeb 账号密码 (如无则不填) |
| `TG_TOKEN` | ✅ | Telegram Bot Token (用于发送截图) |
| `TG_ID` | ✅ | Telegram Chat ID (接收通知的 ID) |

> **注意**: 如果你有更多账号，请修改 `login.js` 中的 `numberOfAccounts` 变量，并在 workflow 文件中添加对应的环境变量映射。

## 📂 文件结构说明

*   **`.github/workflows/koyeb-login.yml`**: GitHub Actions 配置文件。
    *   定义了运行环境 (Node.js 18)。
    *   安装依赖 (`playwright`, `stealth` 插件等)。
    *   定时任务: `0 0 */10 * *` (每 10 天运行一次)。
*   **`login.js`**: 核心逻辑脚本。
    *   启动隐匿模式的 Chromium。
    *   执行登录流程。
    *   **Cloudflare 处理**: 自动检测 iframe，计算 Checkbox 坐标，模拟鼠标滑入并点击。
    *   发送 Telegram 消息和图片。

## 🔧 本地测试 (可选)

如果你想在本地电脑上测试脚本：

1.  克隆仓库并安装依赖：
    ```bash
    npm init -y
    npm install playwright axios form-data playwright-extra puppeteer-extra-plugin-stealth
    npx playwright install --with-deps chromium
    ```
2.  设置环境变量（Linux/Mac）：
    ```bash
    export EMAIL1="your_email"
    export PASSWORD1="your_password"
    export TG_TOKEN="your_bot_token"
    export TG_ID="your_chat_id"
    ```
3.  运行脚本：
    ```bash
    node login.js
    ```

## ⚠️ 免责声明

*   本工具仅供学习和研究使用，旨在辅助用户保持账号活跃。
*   脚本中包含的 Cloudflare 绕过逻辑仅模拟了基本的人类行为，不保证长期有效。
*   请勿用于任何非法用途或大规模滥用 Koyeb 资源。
*   作者不对账号被封禁或任何数据丢失负责。

---
**License**: MIT
