const { chromium } = require("playwright");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const { execSync } = require("child_process");

// 发送图片到 Telegram
async function sendToTelegram(filePath, caption) {
  // 从环境变量中获取 Telegram 配置
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;

  if (!telegramBotToken || !telegramChatId) {
    console.warn("⚠️ Telegram 环境变量未设置 (TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID)。跳过发送。");
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

// 从环境变量中读取账号信息
const accounts = [];
// TODO: 根据需要的账号数量修改
const numberOfAccounts = 2; 

for (let i = 1; i <= numberOfAccounts; i++) {
  accounts.push({
    email: process.env[`EMAIL${i}`], 
    password: process.env[`PASSWORD${i}`],
  });
}

(async () => {
  const SELECTORS = {
    EmailInput: 'input[name="email"]',                                    // 登录1界面邮箱输入框的选择器
    ContinueButton1: 'button[type="submit"]',                             // 登录界面1congtinue按钮的选择器
    ContinueButton2: 'button[type="submit"]',                             // 登录界面2congtinue按钮的选择器
    // 关键修正: 使用 :visible 伪类确保只选择可见的那个输入框，解决被隐藏元素干扰的问题
    VisiblePasswordInput: 'input[placeholder="Password"][name="password"]:visible', 
    LoginButton: 'button[type="submit"]',                                 // 登录界面3登录按钮的选择器
  };

  let browser;
  try {
    try {
      // 启动浏览器，headless 模式
      browser = await chromium.launch({ headless: true });
    } catch (err) {
      console.warn("⚠️ Playwright 浏览器未安装，正在自动安装 Chromium...");
      execSync("npx playwright install --with-deps chromium", { stdio: "inherit" });
      browser = await chromium.launch({ headless: true });
    }

    // 遍历每个账号进行登录
    for (const account of accounts) {
      if (!account.email || !account.password) {
        console.warn("⚠️ 忽略缺失的账号信息...");
        continue;
      }

      const page = await browser.newPage();
      console.log(`\n================================`);
      console.log(`🌐 正在登录 ${account.email}...`);

      // 访问 Koyeb 登录页面
      await page.goto("https://app.koyeb.com/auth/signin");
      console.log("🌐 打开 Koyeb 登录页面...");
    
      // Step 1: 输入邮箱
      console.log("✉️ 输入邮箱");
      await page.fill(SELECTORS.EmailInput, account.email);
      
      console.log("➡️ 点击Continue...");
      await page.click(SELECTORS.ContinueButton1);
      
      // 等待并点击下一个 Continue 按钮
      await page.waitForSelector(SELECTORS.ContinueButton2, { timeout: 15000 });
      console.log("➡️ 点击继续...");
      await page.click(SELECTORS.ContinueButton2);
      
      // Step 2: 输入密码
      console.log("等待密码输入框可见并输入密码...");
      // 使用带 :visible 的选择器，Playwright 会自动等待它出现并变为可交互
      // 移除了 force: true 和手动 waitForLoadState 以使用更健壮的自动等待
      await page.fill(SELECTORS.VisiblePasswordInput, account.password, { timeout: 15000 });
      
      console.log("➡️ 点击登录...");
      // 修正: LogInButton -> LoginButton
      await page.click(SELECTORS.LoginButton);

      // 等待登录完成，导航到新页面
      await page.waitForNavigation({ waitUntil: 'networkidle' });
      console.log("已成功导航到页面: " + page.url());

      // Step 3: 截图登录后的页面
      const safeEmail = account.email.replace(/[^a-z0-9]/gi, '_');
      const loginScreenshot = `login-success-${safeEmail}.png`;
      await page.screenshot({ path: loginScreenshot, fullPage: true });
      await sendToTelegram(loginScreenshot, `✅ Koyeb 登录成功: ${account.email}`);

      console.log(`🎉 ${account.email} 登录成功，截图已发送到 Telegram`);

      // 关闭当前页面以准备下一个账号的登录
      await page.close();
    }
    console.log(`\n✅ 所有账号处理完毕。`);

  } catch (err) {
    console.error("❌ 登录失败:", err);
    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages.length > 0) {
          const page = pages[0];
          const errorPath = "error.png";
          await page.screenshot({ path: errorPath, fullPage: true });
          await sendToTelegram(errorPath, `❌ Koyeb 登录失败截图。账号: ${account?.email || '未知'}`);
          console.log("🚨 失败截图已发送到 Telegram");
        }
      } catch (screenshotErr) {
        console.error("⚠️ 无法截取错误截图:", screenshotErr);
      }
    }
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
