const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth");
chromium.use(stealth());

const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const path = require("path");

// 辅助函数：随机等待
const randomWait = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

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
    console.log("🚀 启动浏览器 (Headless New 模式)...");
    browser = await chromium.launch({ 
      headless: true, // 使用新版 headless
      args: [
        '--headless=new', // 关键：使用新版无头模式，特征更少
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080',
        '--lang=en-US'
      ]
    });
    
    const context = await browser.newContext({ 
      locale: 'en-US',
      // 模拟真实的 UserAgent
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    for (const [index, account] of accounts.entries()) {
      const page = await context.newPage();
      page.setDefaultTimeout(60000);

      console.log(`\n[${index + 1}/${accounts.length}] 登录: ${account.email}`);

      try {
        await page.goto("https://app.koyeb.com/auth/signin", { waitUntil: 'domcontentloaded' });
        
        // 1. 邮箱
        console.log("➡️ 输入邮箱...");
        await page.fill(SELECTORS.EmailInput, account.email);
        await page.waitForTimeout(randomWait(500, 1000));
        await page.click(SELECTORS.SubmitButton);

        // 2. 跳转
        console.log("⏳ 等待跳转...");
        await page.waitForLoadState('networkidle').catch(()=>{});
        if (await page.isVisible(SELECTORS.SubmitButton)) {
             await page.click(SELECTORS.SubmitButton);
        }

        // 3. 密码
        console.log("⏳ 等待密码框...");
        await page.waitForSelector(SELECTORS.PasswordInput, { state: 'visible', timeout: 30000 });
        await page.fill(SELECTORS.PasswordInput, account.password);
        await page.waitForTimeout(randomWait(500, 1500));
        await page.click(SELECTORS.SubmitButton);

        // ==========================================
        // 🔥 Cloudflare 高级处理 (模拟真人鼠标)
        // ==========================================
        console.log("🔍 检测 Cloudflare 验证...");
        await page.waitForTimeout(30000);

        try {
            // 寻找 iframe
            const cfFrameElement = await page.waitForSelector('iframe[src*="cloudflare"], iframe[src*="challenge"]', { timeout: 10000 }).catch(() => null);
            
            if (cfFrameElement) {
                console.log("🚨 发现验证框，开始模拟真人操作...");
                const frames = page.frames();
                const cfFrame = frames.find(f => f.url().includes('cloudflare') || f.url().includes('challenge'));

                if (cfFrame) {
                    // 等待 checkbox 出现
                    const checkbox = await cfFrame.waitForSelector('input[type="checkbox"]', { state: 'visible', timeout: 10000 });
                    if (checkbox) {
                        // 🟢 核心修改：模拟鼠标轨迹 🟢
                        const box = await checkbox.boundingBox();
                        if (box) {
                            console.log("👉 移动鼠标到验证框...");
                            // 1. 移动到元素位置附近 (加一点随机偏移)
                            await page.mouse.move(box.x + box.width / 2 + randomWait(-5, 5), box.y + box.height / 2 + randomWait(-5, 5), { steps: 10 });
                            // 2. 悬停一会
                            await page.waitForTimeout(randomWait(200, 600));
                            // 3. 再次微调移动
                            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
                            // 4. 按下鼠标
                            await page.mouse.down();
                            await page.waitForTimeout(randomWait(50, 150));
                            // 5. 抬起鼠标
                            await page.mouse.up();
                            console.log("✅ 已点击，等待结果...");
                        }
                    }
                    await page.waitForTimeout(5000);
                }
            } else {
                console.log("✅ 未检测到验证框 (可能直通)");
            }
        } catch (cfErr) {
            // 如果 detached，说明成功跳走了
            if (cfErr.message.includes('detached') || cfErr.message.includes('Target closed')) {
                console.log("✅ 验证框消失，验证通过");
            } else {
                console.log(`ℹ️ 验证过程日志: ${cfErr.message}`);
            }
        }

        // 4. 结果验证
        console.log("⏳ 检查登录结果...");
        await Promise.race([
          page.waitForURL('**/apps*', { timeout: 40000 }),
          page.waitForURL('**/services*', { timeout: 40000 }),
          page.waitForSelector('text=Overview', { timeout: 40000 }),
          page.waitForSelector('text=概览', { timeout: 40000 })
        ]);

        console.log(`✅ 成功: ${page.url()}`);
        const screenshotPath = path.join(__dirname, `success-${index}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await sendToTelegram(screenshotPath, `✅ Koyeb 登录成功\n账号: ${account.email}`);

      } catch (err) {
        console.error(`❌ [${account.email}] 失败: ${err.message}`);
        try {
            const errorPath = `error-${Date.now()}.png`;
            await page.screenshot({ path: errorPath, fullPage: true });
            await sendToTelegram(errorPath, `❌ 失败截图: ${account.email}\n${err.message}`);
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
