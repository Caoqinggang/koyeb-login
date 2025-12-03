// 使用 playwright-extra 配合 stealth 插件，这是绕过 Cloudflare 的基础
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth");
chromium.use(stealth());

const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const path = require("path");

// 发送图片到 Telegram
async function sendToTelegram(filePath, caption) {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;

  if (!telegramBotToken || !telegramChatId) {
    console.warn("⚠️ Telegram 环境变量未设置，跳过发送。");
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
    console.error(`❌ TG 发送失败: ${error.message}`);
  }
}

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
  console.error("❌ 未读取到账号信息，请检查 Secrets 配置。");
  process.exit(1);
}

(async () => {
  const SELECTORS = {
    EmailInput: 'input[name="email"]', 
    SubmitButton: 'button[type="submit"]',
    // 兼容中英文的稳健密码框选择器
    PasswordInput: 'input[type="password"][name="password"]', 
  };

  let browser;
  try {
    console.log("🚀 启动浏览器...");
    
    browser = await chromium.launch({ 
      headless: true, 
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--lang=en-US' // 强制英文
      ]
    });

    const context = await browser.newContext({ locale: 'en-US' });

    for (const [index, account] of accounts.entries()) {
      const page = await context.newPage();
      page.setDefaultTimeout(60000); // 60秒超时

      console.log(`\n[${index + 1}/${accounts.length}] 正在登录账号: ${account.email}`);

      try {
        // --- 步骤 1: 打开页面 ---
        await page.goto("https://app.koyeb.com/auth/signin", { waitUntil: 'domcontentloaded' });
        
        // --- 步骤 2: 输入邮箱 ---
        console.log("➡️ [1/3] 输入邮箱...");
        await page.fill(SELECTORS.EmailInput, account.email);
        await page.click(SELECTORS.SubmitButton);

        // --- 步骤 3: 等待中间跳转 ---
        console.log("⏳ [2/3] 等待跳转...");
        // 等待页面跳转完成（网络空闲）
        await page.waitForLoadState('networkidle').catch(() => {});
        
        // 如果再次出现提交按钮（确认页面），点击它
        if (await page.isVisible(SELECTORS.SubmitButton)) {
             console.log("➡️ [2/3] 点击继续...");
             await page.click(SELECTORS.SubmitButton);
        }

        // --- 步骤 4: 输入密码 ---
        console.log("⏳ [3/3] 等待密码框...");
        try {
          await page.waitForSelector(SELECTORS.PasswordInput, { state: 'visible', timeout: 30000 });
        } catch (e) {
          console.warn("⚠️ 密码框未出现，尝试截图...");
          await page.screenshot({ path: `debug-no-password-${index}.png` });
          throw new Error("找不到密码输入框");
        }

        console.log("➡️ [3/3] 输入密码...");
        await page.fill(SELECTORS.PasswordInput, account.password);
        
        console.log("➡️ [3/3] 提交登录...");
        await page.click(SELECTORS.SubmitButton);

        // ==========================================
        // 🔥 这里是你要的：在提交密码后检查 Cloudflare
        // ==========================================
        console.log("🔍 提交后检查 Cloudflare 验证...");
        // 稍微等待一下，给 Cloudflare 弹出的时间
        await page.waitForTimeout(50000);

        // 检查是否存在 Cloudflare 的 iframe
        const frames = page.frames();
        const cfFrame = frames.find(f => f.url().includes('cloudflare') || f.url().includes('challenge'));
        
        if (cfFrame) {
            console.log("🚨 检测到 Cloudflare 拦截，尝试自动处理...");
            try {
                // 1. 尝试点击 checkbox
                const checkbox = await cfFrame.$('input[type="checkbox"]');
                if (checkbox) {
                    await checkbox.click();
                    console.log("👉 已点击 Cloudflare 复选框");
                } else {
                    // 2. 如果没有 checkbox，尝试点击 body（有些是透明层）
                    await cfFrame.click('body', { timeout: 30000 });
                    console.log("👉 已点击 Cloudflare 页面主体");
                }
                // 点击后等待一会儿让验证通过
                await page.waitForTimeout(50000);
            } catch (cfErr) {
                console.log(`⚠️ Cloudflare 处理尝试失败: ${cfErr.message} (可能已自动通过)`);
            }
        } else {
            console.log("✅ 未检测到明显的 Cloudflare 阻断。");
        }
        // ==========================================

        // --- 步骤 5: 验证最终登录状态 ---
        console.log("⏳ 等待进入控制台...");
        await Promise.race([
          page.waitForURL('**/apps*', { timeout: 80000 }),
          page.waitForURL('**/services*', { timeout: 80000 }),
          page.waitForSelector('text=Overview', { timeout: 80000 }), 
          page.waitForSelector('text=概览', { timeout: 80000 })
        ]);

        console.log(`✅ 登录成功，当前 URL: ${page.url()}`);

        // 截图
        const safeEmail = account.email.replace(/[^a-z0-9]/gi, '_');
        const screenshotPath = path.join(__dirname, `success-${safeEmail}.png`);
        await page.waitForTimeout(2000); 
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await sendToTelegram(screenshotPath, `✅ Koyeb 登录成功\n账号: ${account.email}`);

      } catch (err) {
        console.error(`❌ [${account.email}] 失败: ${err.message}`);
        try {
            const errorPath = `error-${Date.now()}.png`;
            await page.screenshot({ path: errorPath, fullPage: true });
            await sendToTelegram(errorPath, `❌ 登录出错: ${account.email}\n${err.message}`);
        } catch (e) {}
      } finally {
        await page.close();
      }
    }
  } catch (err) {
    console.error("❌ 全局致命错误:", err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
