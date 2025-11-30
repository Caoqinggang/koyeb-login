const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

const accounts = [
  {
    username: process.env.USERNAME_1,
    password: process.env.PASSWORD_1,
  },
  {
    username: process.env.USERNAME_2,
    password: process.env.PASSWORD_2,
  },
  // 可以根据需要继续添加账号
];

const TELEGRAM_BOT_TOKEN = process.env.TG_TOKEN; // Telegram 机器人令牌
const CHAT_ID = process.env.TG_ID; // Telegram 聊天 ID

async function sendTelegramMessage(message, screenshotPath = null) {
  try {
    const form = {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
    };
    if (screenshotPath) {
      const photo = fs.createReadStream(screenshotPath);
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        chat_id: CHAT_ID,
        caption: message,
        photo: photo,
      });
    } else {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, form);
    }
  } catch (error) {
    console.error('Failed to send message to Telegram:', error);
  }
}

async function login(account) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://app.koyeb.com/auth/signin');
    await page.click('button[data-provider="github"]');
    await page.waitForTimeout(2000);

    await page.fill('input#login_field', account.username);
    await page.fill('input#password', account.password);
    await page.click('input[type="submit"]');

    await page.waitForNavigation();

    const screenshotPath = `screenshot-${account.username}.png`;
    await page.screenshot({ path: screenshotPath });

    await sendTelegramMessage(`Logged in successfully as ${account.username}`, screenshotPath);
  } catch (error) {
    const screenshotPath = `screenshot-${account.username}.png`;
    await page.screenshot({ path: screenshotPath });
    await sendTelegramMessage(`Failed to log in as ${account.username}. Error: ${error.message}`, screenshotPath);
  } finally {
    await browser.close();
  }
}

async function main() {
  for (const account of accounts) {
    await login(account);
  }
}

main().catch(error => {
  console.error('Error during login process:', error);
});
