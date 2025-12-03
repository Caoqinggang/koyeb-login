const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth");
chromium.use(stealth());

const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const path = require("path");

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
  } catch (error) { console.error(`❌ TG 发送失败: ${error.message}`); }
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
    console.log("🚀 启动浏览器...");
    browser = await chromium.launch({ 
      headless: true, 
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US']
    });
    const context = await browser.newContext({ locale: 'en-US' });

    for (const [index, account] of accounts.entries()) {
      const page = await context.newPage();
      page.setDefaultTimeout(60000);

      console.log(`\n[${index + 1}/${accounts.length}] 正在登录账号: ${account.email}`);

      try {
        await page.goto("https://app.koyeb.com/auth/signin", { waitUntil: 'domcontentloaded' });
        
        // --- 1. 邮箱 ---
        console.log("➡️ [1/3] 输入邮箱...");
        await page.fill(SELECTORS.EmailInput, account.email);
        await page.click(SELECTORS.SubmitButton);

        // --- 2. 跳转 ---
        console.log("⏳ [2/3] 等待跳转...");
        await page.waitForLoadState('networkidle').catch(() => {});
        if (await page.isVisible(SELECTORS.SubmitButton)) {
             console.log("➡️ [2/3] 点击继续...");
             await page.click(SELECTORS.SubmitButton);
        }

        // --- 3. 密码 ---
        console.log("⏳ [3/3] 等待密码框...");
        try {
          await page.waitForSelector(SELECTORS.PasswordInput, { state: 'visible', timeout: 30000 });
        } catch (e) {
          throw new Error("找不到密码输入框 (可能被拦截)");
        }

        console.log("➡️ [3/3] 输入密码...");
        await page.fill(SELECTORS.PasswordInput, account.password);
        console.log("➡️ [3/3] 提交登录...");
        await page.click(SELECTORS.SubmitButton);

        // ==========================================
        // 🔥 修复后的 Cloudflare 处理逻辑
        // ==========================================
        console.log("🔍 提交后检测人机验证...");
        
        // 这里的逻辑是：如果 Cloudflare 出现，尝试处理；如果报错框没了(detached)，说明通过了，直接忽略错误
        try {
            // 短暂等待，看看是否有 frame 出现
            const cfFrameElement = await page.waitForSelector('iframe[src*="cloudflare"], iframe[src*="challenge"]', { timeout: 4000 }).catch(() => null);
            
            if (cfFrameElement) {
                console.log("⚠️ 检测到 Cloudflare 框架...");
                const frames = page.frames();
                const cfFrame = frames.find(f => f.url().includes('cloudflare') || f.url().includes('challenge'));
                
                if (cfFrame) {
                    // 尝试等待 checkbox 出现并且可见
                    const checkbox = await cfFrame.waitForSelector('input[type="checkbox"]', { state: 'visible', timeout: 3000 }).catch(() => null);
                    if (checkbox) {
                        console.log("👉 尝试点击验证框...");
                        await checkbox.click({ force: true });
                        console.log("✅ 点击完成，等待跳转...");
                        await page.waitForTimeout(2000);
                    } else {
                        console.log("ℹ️ 验证框不可见或已自动通过 (隐形验证)");
                    }
                }
            } else {
                console.log("✅ 未检测到验证框，可能已直通");
            }
        } catch (cfErr) {
            // 关键修复：如果错误是 Frame detached，说明页面已经跳走了，这是好事！
            if (cfErr.message.includes('detached') || cfErr.message.includes('Target closed')) {
                console.log("✅ 验证框已消失 (视为验证通过)");
            } else {
                console.log(`⚠️ 验证检查中的非致命错误: ${cfErr.message}`);
            }
        }
        // ==========================================

        // --- 4. 最终验证 ---
        console.log("⏳ 等待进入 Dashboard...");
        await Promise.race([
          page.waitForURL('**/apps*', { timeout: 40000 }),
          page.waitForURL('**/services*', { timeout: 40000 }),
          page.waitForSelector('text=Overview', { timeout: 40000 }), 
          page.waitForSelector('text=概览', { timeout: 40000 })
        ]);

        console.log(`✅ 登录成功: ${page.url()}`);
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
            await sendToTelegram(errorPath, `❌ 出错: ${account.email}\n${err.message}`);
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
