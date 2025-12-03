// 1. 引入 playwright-extra 而不是普通的 playwright
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth");

// 2. 加载隐身插件
chromium.use(stealth());

const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const { execSync } = require("child_process");
const path = require("path");

// ... (sendToTelegram 函数保持不变) ...
async function sendToTelegram(filePath, caption) {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  if (!telegramBotToken || !telegramChatId) return;
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
  } catch (error) { console.error(`❌ TG发送失败: ${error.message}`); }
}

const accounts = [];
const numberOfAccounts = 2; 
for (let i = 1; i <= numberOfAccounts; i++) {
  const email = process.env[`EMAIL${i}`];
  const password = process.env[`PASSWORD${i}`];
  if (email && password) accounts.push({ email, password });
}
if (accounts.length === 0) process.exit(1);

(async () => {
  const SELECTORS = {
    EmailInput: 'input[name="email"]', 
    SubmitButton: 'button[type="submit"]',
    PasswordInput: 'input[type="password"][name="password"]', 
  };

  let browser;
  try {
    console.log("🚀 启动隐身浏览器...");
    
    // 3. 启动配置优化
    browser = await chromium.launch({ 
      headless: true, // 如果服务器允许，改为 false 成功率更高
      args: [
        '--disable-blink-features=AutomationControlled', // 禁用自动化特性
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080',
        '--lang=en-US'
      ]
    });
    
    // 创建上下文并设置 User-Agent (模拟真实 Chrome)
    const context = await browser.newContext({ 
      locale: 'en-US',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    for (const [index, account] of accounts.entries()) {
      const page = await context.newPage();
      page.setDefaultTimeout(60000);

      console.log(`\n[${index + 1}/${accounts.length}] 正在登录: ${account.email}`);

      try {
        await page.goto("https://app.koyeb.com/auth/signin", { waitUntil: 'domcontentloaded' });
        
        // --- Cloudflare 处理逻辑 ---
        console.log("🔍 检查 Cloudflare 验证...");
        // 等待一会，让 Cloudflare 的挑战加载
        await page.waitForTimeout(3000);
        
        // 尝试检测是否有 Cloudflare 的 iframe
        const frames = page.frames();
        const cloudflareFrame = frames.find(f => f.url().includes('cloudflare') || f.url().includes('challenge'));
        
        if (cloudflareFrame) {
            console.log("⚠️ 检测到 Cloudflare，尝试自动点击...");
            try {
                // 尝试点击复选框 (通常是 body 或 input)
                await cloudflareFrame.click('body', { timeout: 5000 }).catch(() => {});
                await cloudflareFrame.click('input[type="checkbox"]', { timeout: 5000 }).catch(() => {});
                await page.waitForTimeout(5000); // 点击后等待验证通过
            } catch (cfErr) {
                console.log("⚠️ 自动点击 Cloudflare 失败，可能需要手动干预或已自动通过");
            }
        }
        // -------------------------

        console.log("➡️ [1/3] 输入邮箱...");
        await page.fill(SELECTORS.EmailInput, account.email);
        await page.click(SELECTORS.SubmitButton);

        // [2/3] 等待 WorkOS 跳转
        console.log("⏳ [2/3] 等待跳转...");
        await page.waitForLoadState('networkidle'); 
        
        // 再次检查 Cloudflare (有时候跳转后会再出一次)
        const frameAfterNav = page.frames().find(f => f.url().includes('cloudflare'));
        if (frameAfterNav) {
             console.log("⚠️ 跳转后再次检测到 Cloudflare...");
             await page.waitForTimeout(3000); // 通常 Stealth 插件会自动通过，这里只需等待
        }

        console.log("➡️ [2/3] 点击继续...");
        // 确保按钮存在再点
        if (await page.isVisible(SELECTORS.SubmitButton)) {
             await page.click(SELECTORS.SubmitButton);
        }

        // [3/3] 密码
        console.log("⏳ [3/3] 等待密码框...");
        await page.waitForSelector(SELECTORS.PasswordInput, { state: 'visible', timeout: 30000 });
        
        console.log("➡️ [3/3] 输入密码...");
        await page.fill(SELECTORS.PasswordInput, account.password);
        await page.click(SELECTORS.SubmitButton);

        console.log("⏳ 等待登录成功...");
        await Promise.race([
          page.waitForURL('**/apps*', { timeout: 40000 }),
          page.waitForURL('**/services*', { timeout: 40000 }),
          page.waitForSelector('text=Overview', { timeout: 40000 }),
          page.waitForSelector('text=概览', { timeout: 40000 })
        ]);

        console.log(`✅ 成功: ${page.url()}`);
        
        // 截图
        const safeEmail = account.email.replace(/[^a-z0-9]/gi, '_');
        const screenshotPath = path.join(__dirname, `success-${safeEmail}.png`);
        await page.waitForTimeout(3000);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await sendToTelegram(screenshotPath, `✅ Koyeb 登录成功\n账号: ${account.email}`);

      } catch (err) {
        console.error(`❌ 失败: ${err.message}`);
        try {
            const errorPath = `error-${Date.now()}.png`;
            await page.screenshot({ path: errorPath, fullPage: true });
            await sendToTelegram(errorPath, `❌ 出错: ${account.email}\n可能卡在Cloudflare或布局变更`);
        } catch (e) {}
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
