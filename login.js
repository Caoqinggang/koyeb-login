const { chromium } = require("playwright");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const { execSync } = require("child_process");
const path = require("path");

// 发送图片到 Telegram
async function sendToTelegram(filePath, caption) {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;

  if (!telegramBotToken || !telegramChatId) {
    console.warn("⚠️ Telegram 环境变量未设置。跳过发送。");
    return;
  }

  const telegramApi = `https://api.telegram.org/bot${telegramBotToken}/sendPhoto`;
  const formData = new FormData();
  formData.append("chat_id", telegramChatId);
  formData.append("caption", caption);
  formData.append("photo", fs.createReadStream(filePath));

  try {
    await axios.post(telegramApi, formData, {
      headers: formData.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
  } catch (error) {
    console.error(`❌ 发送到 Telegram 失败: ${error.message}`);
  }
}

// 账号配置
const accounts = [];
const numberOfAccounts = 2; 

for (let i = 1; i <= numberOfAccounts; i++) {
  const email = process.env[`EMAIL${i}`];
  const password = process.env[`PASSWORD${i}`];
  if (email && password) {
    accounts.push({ email, password });
  }
}

if (accounts.length === 0) {
  console.error("❌ 未找到任何账号信息，请检查环境变量 (EMAIL1, PASSWORD1...)");
  process.exit(1);
}

(async () => {
  const SELECTORS = {
    EmailInput: 'input[name="email"]', 
    // 通用提交按钮（Continue / Login）
    SubmitButton: 'button[type="submit"]',
    // 密码框：使用 type="password" 确保兼容中英文，不依赖 placeholder
    PasswordInput: 'input[type="password"][name="password"]', 
  };

  let browser;
  try {
    console.log("🚀 启动浏览器...");
    // 强制使用英文环境，防止网页语言变动
    browser = await chromium.launch({ 
      headless: true,
      args: ['--lang=en-US'] 
    });
    
    // 创建上下文并再次强制指定英文 locale
    const context = await browser.newContext({ locale: 'en-US' });

    for (const [index, account] of accounts.entries()) {
      const page = await context.newPage();
      // 设置较长的超时时间，应对跳转
      page.setDefaultTimeout(60000);

      console.log(`\n[${index + 1}/${accounts.length}] 正在登录账号: ${account.email}`);

      try {
        // --- 阶段 1: 初始登录页 ---
        await page.goto("https://app.koyeb.com/auth/signin", { waitUntil: 'domcontentloaded' });
        
        console.log("➡️ [页面1] 输入邮箱...");
        await page.fill(SELECTORS.EmailInput, account.email);
        
        console.log("➡️ [页面1] 点击第一次 Continue...");
        // 点击后通常会跳转到 auth.koyeb.com 或 signin.koyeb.com
        await page.click(SELECTORS.SubmitButton);

        // --- 阶段 2: 中间页 (SSO/WorkOS) ---
        // 必须等待页面加载完成，确保出现第二个 Continue 按钮
        console.log("⏳ 等待跳转到第二个页面...");
        await page.waitForLoadState('networkidle'); 
        // 或者是等待URL变化
        // await page.waitForNavigation(); 

        console.log("➡️ [页面2] 点击第二次 Continue...");
        // 这里的按钮通常还是 type="submit"，直接再次点击
        // 为了保险，先等待按钮可见
        await page.waitForSelector(SELECTORS.SubmitButton, { state: 'visible' });
        await page.click(SELECTORS.SubmitButton);

        // --- 阶段 3: 密码输入页 ---
        console.log("⏳ [页面3] 等待密码框出现...");
        try {
          // 等待密码框出现
          await page.waitForSelector(SELECTORS.PasswordInput, { state: 'visible', timeout: 30000 });
        } catch (e) {
          console.warn("⚠️ 密码框未及时出现，截取当前页面状态...");
          await page.screenshot({ path: `debug-password-${index}.png` });
          throw new Error("找不到密码输入框，请检查 debug 截图");
        }

        console.log("➡️ [页面3] 输入密码...");
        await page.fill(SELECTORS.PasswordInput, account.password);
        
        console.log("➡️ [页面3] 点击登录...");
        await page.click(SELECTORS.SubmitButton);

        // --- 阶段 4: 验证登录成功 ---
        console.log("⏳ 等待跳转到控制台...");
        await Promise.race([
          page.waitForURL('**/apps*', { timeout: 40000 }),
          page.waitForURL('**/services*', { timeout: 40000 }),
          // 兼容中英文的 Overview 检查
          page.waitForSelector('text=Overview', { timeout: 40000 }),
          page.waitForSelector('text=概览', { timeout: 40000 })
        ]);

        console.log(`✅ 登录成功: ${page.url()}`);

        // 成功截图
        const safeEmail = account.email.replace(/[^a-z0-9]/gi, '_');
        const screenshotPath = path.join(__dirname, `success-${safeEmail}.png`);
        
        await page.waitForTimeout(3000); // 稍微多等几秒让 Dashboard 加载好看点
        await page.screenshot({ path: screenshotPath, fullPage: true });
        
        await sendToTelegram(screenshotPath, `✅ Koyeb 登录成功\n账号: ${account.email}`);

      } catch (err) {
        console.error(`❌ [${account.email}] 登录失败: ${err.message}`);
        // 错误截图
        try {
            const errorPath = `error-${Date.now()}.png`;
            await page.screenshot({ path: errorPath, fullPage: true });
            await sendToTelegram(errorPath, `❌ 登录出错: ${account.email}\n${err.message}`);
        } catch (e) { 
            console.error("无法发送错误截图"); 
        }
      } finally {
        await page.close();
      }
    }
  } catch (err) {
    console.error("❌ 全局错误:", err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
