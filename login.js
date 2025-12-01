const { chromium } = require("playwright");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const { execSync } = require("child_process");

// 发送图片到 Telegram
async function sendToTelegram(filePath, caption) {
  const telegramApi = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const formData = new FormData();
  formData.append("chat_id", process.env.TELEGRAM_CHAT_ID);
  formData.append("caption", caption);
  formData.append("photo", fs.createReadStream(filePath));

  await axios.post(telegramApi, formData, {
    headers: formData.getHeaders(),
  });
}

// 从环境变量中读取账号信息
const accounts = [];
const numberOfAccounts = 2; // 根据需要的账号数量修改

for (let i = 1; i <= numberOfAccounts; i++) {
  accounts.push({
    email: process.env[`GITHUB_USERNAME_${i}`], // 注意：使用用户名而不是邮箱
    token: process.env[`GITHUB_TOKEN_${i}`], // 使用 token 作为密码
  });
}

(async () => {
  const SELECTORS = {
    githubLoginButton: 'button:has-text("使用 GitHub 继续")', // 请确认使用的文本
    githubEmailInput: 'input[type="text"]', // 登录时用户名输入框的选择器
    githubPasswordInput: 'input[type="password"]', // 登录时密码输入框的选择器
    githubSignInButton: 'input[type="submit"]', // 登录按钮的选择器
    showOptionsButton: 'button:has-text("Show other options")', // 请替换为实际的选择器
  };

  let browser;
  try {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (err) {
      console.warn("⚠️ Playwright 浏览器未安装，正在自动安装 Chromium...");
      execSync("npx playwright install --with-deps chromium", { stdio: "inherit" });
      browser = await chromium.launch({ headless: true });
    }

    // 遍历每个账号进行登录
    for (const account of accounts) {
      if (!account.email || !account.token) {
        console.warn("⚠️ 忽略缺失的账号信息...");
        continue;
      }

      const page = await browser.newPage();
      console.log(`🌐 正在登录 ${account.email}...`);

      // 访问 Koyeb 登录页面
      await page.goto("https://app.koyeb.com/auth/signin");

      // 检查是否有“Show other options”按钮
      const hasOtherOptions = await page.$(SELECTORS.showOptionsButton) !== null;

      if (hasOtherOptions) {
          console.log("👉 检测到 'Show other options'按钮，正在点击...");
          await page.click(SELECTORS.showOptionsButton);

          // 等待“使用 GitHub 继续”按钮出现
          await page.waitForSelector(SELECTORS.githubLoginButton, { timeout: 15000 });

          console.log("👉 点击 '使用 GitHub 继续' 按钮...");
          await page.click(SELECTORS.githubLoginButton);
      } else {
          // 如果没有“Show other options”，直接点击 GitHub 登录按钮
          await page.waitForSelector(SELECTORS.githubLoginButton, { timeout: 15000 });
          console.log("👉 点击 'Sign in with GitHub' 按钮...");
          await page.click(SELECTORS.githubLoginButton);
      }

      // Step 2: 输入 GitHub 账户信息
      await page.waitForSelector(SELECTORS.githubEmailInput, { timeout: 15000 });
      console.log("✉️ 输入 GitHub 用户名...");
      await page.fill(SELECTORS.githubEmailInput, account.email);
      console.log("🔑 输入 GitHub Personal Access Token...");
      await page.fill(SELECTORS.githubPasswordInput, account.token);
      console.log("➡️ 点击登录...");
      await page.click(SELECTORS.githubSignInButton);

      // 等待登录完成
      await page.waitForNavigation({ waitUntil: 'networkidle' });
      console.log("已成功导航到页面: " + page.url());

      // Step 3: 截图登录后的页面
      const loginScreenshot = `login-success-${account.email.replace(/[^a-z0-9]/gi, '_')}.png`;
      await page.screenshot({ path: loginScreenshot, fullPage: true });
      await sendToTelegram(loginScreenshot, `✅ Koyeb 登录成功: ${account.email}`);

      console.log(`🎉 ${account.email} 登录成功，截图已发送到 Telegram`);

      // 关闭当前页面以准备下一个账号的登录
      await page.close();
    }

  } catch (err) {
    console.error("❌ 登录失败:", err);
    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages.length > 0) {
          const page = pages[0];
          const errorPath = "error.png";
          await page.screenshot({ path: errorPath, fullPage: true });
          await sendToTelegram(errorPath, "❌ Koyeb 登录失败截图");
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
