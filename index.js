require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const axios = require("axios");
const personas = require("./persona");

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  },
});

const chatHistory = {};

let ownerLastActive = Date.now();
let ownerStatus = null;
let botReplying = false;
let forceAI = false;
const AI_MODE_THRESHOLD = 5 * 60 * 1000;

function isAIMode() {
  return forceAI || Date.now() - ownerLastActive > AI_MODE_THRESHOLD;
}

function getSenderId(from) {
  return from.replace("@c.us", "").replace("@lid", "").split(":")[0];
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function askAI(persona, message, history = [], statusContext = null) {
  const statusNote = statusContext
    ? `\n\n[CONTEXT: Saat ini kamu sedang ${statusContext}. Kalau partner nanya kamu dimana/lagi apa, sebutkan ini secara natural dalam gaya kamu.]`
    : "";

  const formatNote = `\n\nPenting: pisahkan setiap bubble pesan dengan newline. Maksimal 1 kalimat pendek per baris.`;

  const response = await axios.post(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
    {
      messages: [
        { role: "system", content: persona + statusNote + formatNote },
        ...history,
        { role: "user", content: message },
      ],
      max_tokens: 150,
      temperature: 0.9,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    },
  );
  return response.data.result.response;
}

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("Scan QR pake WA kamu");
});

client.on("ready", () => {
  console.log("Bot aktif!");
});

client.on("message_create", (msg) => {
  if (!msg.fromMe) return;
  if (!msg.body?.startsWith(">>")) {
    if (botReplying) return;
    if (msg.from.includes("@g.us")) return;
    const target = getSenderId(msg.to);
    if (!personas[target]) return;
    ownerLastActive = Date.now();
    console.log("Owner aktif, timer reset");
    return;
  }

  const cmd = msg.body.replace(">>", "").trim();

  if (cmd.startsWith("status ")) {
    ownerStatus = cmd.replace("status ", "").trim();
    console.log(`Status updated: "${ownerStatus}"`);
    client.sendMessage(msg.from, `✅ Status: "${ownerStatus}"`);
    return;
  }
  if (cmd === "clear") {
    ownerStatus = null;
    ownerLastActive = Date.now();
    forceAI = false;
    console.log("Status cleared, mode online");
    client.sendMessage(msg.from, "✅ Online, status dihapus");
    return;
  }
  if (cmd === "mode") {
    const idle = Math.floor((Date.now() - ownerLastActive) / 1000);
    client.sendMessage(
      msg.from,
      `Mode: ${isAIMode() ? "🤖 AI" : "🟢 Online"}\nForce AI: ${forceAI}\nStatus: ${ownerStatus || "-"}\nIdle: ${idle}s`,
    );
    return;
  }
  if (cmd === "ai") {
    forceAI = true;
    console.log("Force AI mode ON");
    client.sendMessage(msg.from, "🤖 AI mode ON");
    return;
  }
  if (cmd === "off") {
    forceAI = false;
    ownerLastActive = Date.now();
    console.log("Force AI mode OFF");
    client.sendMessage(msg.from, "🟢 AI mode OFF");
    return;
  }
});

client.on("message", async (msg) => {
  if (msg.from.includes("@g.us")) return;
  if (msg.from.includes("@newsletter")) return;
  if (msg.from.includes("@broadcast")) return;

  const sender = getSenderId(msg.from);
  const text = msg.body?.trim();
  if (!text) return;

  if (!personas[sender]) {
    console.log(`Nomor ${sender} tidak ada di whitelist`);
    return;
  }

  console.log(`Sender: ${sender}, Pesan: ${text}, AI Mode: ${isAIMode()}`);

  if (!isAIMode()) return;

  if (!chatHistory[sender]) chatHistory[sender] = [];

  try {
    const reply = await askAI(
      personas[sender],
      text,
      chatHistory[sender],
      ownerStatus,
    );

    if (!reply || reply.trim() === "" || reply === "null") return;

    const bubbles = reply.split("\n").filter((b) => b.trim() !== "");

    chatHistory[sender].push({ role: "user", content: text });
    chatHistory[sender].push({ role: "assistant", content: reply });
    if (chatHistory[sender].length > 10) {
      chatHistory[sender] = chatHistory[sender].slice(-10);
    }

    botReplying = true;
    for (let i = 0; i < bubbles.length; i++) {
      if (i === 0) {
        await msg.reply(bubbles[i]);
      } else {
        await delay(randomBetween(800, 2000));
        await client.sendMessage(msg.from, bubbles[i]);
      }
    }
    botReplying = false;
    console.log(`Bales (${bubbles.length} bubble): ${reply}`);
  } catch (err) {
    botReplying = false;
    console.error("Error:", err.response?.data || err.message);
  }
});

client.initialize();
