/**
 * Aster Notifier Sidecar (CommonJS) — v1.4.0
 * Posts Discord alerts for:
 *   - order_filled (entry vs reduce via PnL)
 *   - position_closed (SL/TP)
 *
 * Env:
 *   ASTER_WS_URL
 *   DISCORD_WEBHOOK_URL
 *   HEARTBEAT_HOURS           (optional)
 *   SUBSCRIBE_JSON            (optional)
 *   DEBUG                     ("1" to log a few messages)
 *   LIFECYCLE_NOTIFS          ("0" to silence boot/started/stopping pings)
 */

const WebSocket = require("ws");         // npm i ws
const fetchFn = globalThis.fetch;

const VERSION = "1.4.0";

// --- ENV ---
const WS_URL = process.env.ASTER_WS_URL || "ws://localhost:8081/ws";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const HEARTBEAT_HOURS = parseInt(process.env.HEARTBEAT_HOURS || "0", 10);
const SUBSCRIBE_JSON = process.env.SUBSCRIBE_JSON || "";
const DEBUG = process.env.DEBUG === "1";
const LIFECYCLE_NOTIFS = process.env.LIFECYCLE_NOTIFS !== "0";

// --- Utils ---
const COLORS = { GREEN: 0x2ecc71, RED: 0xe74c3c, BLUE: 0x3498db, YELLOW: 0xf1c40f };
const toStr = (v, fb = "-") => String(v ?? fb);
const nowISO = () => new Date().toISOString();
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

// Simple spam guard if webhook is invalid or rate-limited
let disableDiscord = false;
let last429At = 0;

async function sendDiscord(content, embed) {
  if (!DISCORD_WEBHOOK_URL || disableDiscord) {
    if (!DISCORD_WEBHOOK_URL) console.warn("[aster-notifier] DISCORD_WEBHOOK_URL missing; skip");
    return;
  }
  const now = Date.now();
  if (now - last429At < 2000) return; // back off briefly after a 429

  const body = { content };
  if (embed) body.embeds = [embed];

  try {
    const res = await fetchFn(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      const txt = await res.text().catch(() => "");
      console.error("[aster-notifier] Discord 401 Invalid token. Disabling notifier.", txt.slice(0, 200));
      disableDiscord = true; // avoid further spam until restart
      return;
    }
    if (res.status === 429) {
      last429At = now;
      const txt = await res.text().catch(() => "");
      console.warn("[aster-notifier] Discord 429 rate limited:", txt.slice(0, 200));
      return;
    }
    if (!res.ok && res.status !== 204) {
      const txt = await res.text().catch(() => "");
      console.error("[aster-notifier] Discord HTTP", res.status, txt.slice(0, 300));
    } else {
      console.log("[aster-notifier] Discord post OK", res.status);
    }
  } catch (err) {
    console.error("[aster-notifier] Discord webhook error:", err);
  }
}

// --- State ---
let ws = null;
let reconnectTimer = null;
let heartbeatTimer = null;
let announcedStart = false;
let debugCount = 0;

// --- Helpers ---
function scheduleReconnect(ms = 5000) {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, ms);
}

function normalizeMessage(raw) {
  const maybeParse = (x) => {
    if (typeof x === "string") {
      try { return JSON.parse(x); } catch { return x; }
    }
    return x;
  };

  let m = raw;
  let name = m.event || m.type || m.topic || m.action || m.name || m.channel;

  if (!name && m.message && typeof m.message === "object") {
    const inner = m.message;
    name = inner.event || inner.type || inner.topic || inner.action || inner.name || name;
    m = inner;
  }

  let data = m.data ?? m.payload ?? m.body ?? m.content ?? m.msg ?? m.message ?? {};
  data = maybeParse(data);

  if (!name && (raw.orderType || raw.symbol || raw.side)) {
    name = "order_filled";
    data = raw;
  }

  if (typeof name === "string") name = name.trim().toLowerCase();
  return { name, data };
}

function isReduceFill(e) {
  const n = toNum(e?.pnl);
  return Number.isFinite(n);
}

async function handleOrderFilled(e) {
  const reduce = isReduceFill(e);
  const isSL = /STOP/i.test(toStr(e?.orderType));
  const isTP = /TAKE_PROFIT/i.test(toStr(e?.orderType));

  // Calculate PnL % if possible
  let pnl = Number.isFinite(toNum(e?.pnl)) ? toNum(e.pnl) : 0;
  let cost = toNum(e?.cost) || (toNum(e?.executedQty) * toNum(e?.price));
  let pnlPct = cost ? (pnl / cost) * 100 : null;

  if (!reduce) {
    let fields = [
      { name: "Qty", value: toStr(e?.executedQty), inline: true },
      { name: "Price", value: toStr(e?.price), inline: true },
      { name: "Type", value: toStr(e?.orderType), inline: true },
    ];
    // If PnL is present for entry fills, show it
    if (Number.isFinite(pnl) && cost) {
      fields.push({ name: "PnL", value: `$${pnl.toFixed(2)}`, inline: true });
      fields.push({ name: "PnL %", value: `${pnlPct.toFixed(2)}%`, inline: true });
    }
    await sendDiscord(`✅ Entry filled: **${toStr(e?.symbol)}** (${toStr(e?.side)})`, {
      description: "Entry order executed",
      color: COLORS.BLUE,
      fields,
      timestamp: nowISO(),
    });
  } else {
    const label = isSL ? "🛑 Stop Loss" : isTP ? "🎯 Take Profit" : "🔻 Reduce";
    let fields = [
      { name: "Qty", value: toStr(e?.executedQty), inline: true },
      { name: "Price", value: toStr(e?.price), inline: true },
      { name: "PnL", value: `$${pnl.toFixed(2)}`, inline: true },
      { name: "Type", value: toStr(e?.orderType), inline: true },
    ];
    if (pnlPct !== null) {
      fields.splice(3, 0, { name: "PnL %", value: `${pnlPct.toFixed(2)}%`, inline: true });
    }
    await sendDiscord(`${label} filled: **${toStr(e?.symbol)}** (${toStr(e?.side)})`, {
      description: "Reduce/exit order executed",
      color: isSL ? COLORS.RED : isTP ? COLORS.GREEN : COLORS.YELLOW,
      fields,
      timestamp: nowISO(),
    });
  }
}

async function handlePositionClosed(e) {
  const color = e?.reason === "Stop Loss" ? COLORS.RED : COLORS.GREEN;
  let pnl = Number.isFinite(toNum(e?.pnl)) ? toNum(e.pnl) : 0;
  let cost = toNum(e?.cost) || (toNum(e?.quantity) * toNum(e?.entryPrice));
  let pnlPct = cost ? (pnl / cost) * 100 : null;
  let fields = [
    { name: "Qty", value: toStr(e?.quantity), inline: true },
    { name: "PnL", value: `$${pnl.toFixed(2)}`, inline: true },
  ];
  if (pnlPct !== null) {
    fields.push({ name: "PnL %", value: `${pnlPct.toFixed(2)}%`, inline: true });
  }
  await sendDiscord(
    `📉 Position closed: **${toStr(e?.symbol)}** (${toStr(e?.side)}) — ${toStr(e?.reason)}`,
    {
      description: "Position fully closed",
      color,
      fields,
      timestamp: nowISO(),
    }
  );
}

// --- Lifecycle ---
function banner() {
  console.log(`[aster-notifier] v${VERSION} | LIFECYCLE=${LIFECYCLE_NOTIFS ? "on" : "off"} | DEBUG=${DEBUG ? "on" : "off"}`);
}

function connect() {
  if (!WS_URL) {
    console.error("[aster-notifier] ASTER_WS_URL missing; cannot connect.");
    return;
  }

  ws = new WebSocket(WS_URL);
  console.log(`[aster-notifier] Connecting to ${WS_URL}...`);

  ws.on("open", async () => {
    console.log("[aster-notifier] Connected");

    if (SUBSCRIBE_JSON) {
      try {
        ws.send(SUBSCRIBE_JSON);
        console.log("[aster-notifier] Sent SUBSCRIBE:", SUBSCRIBE_JSON);
      } catch (e) {
        console.error("[aster-notifier] SUBSCRIBE send error:", e);
      }
    }

    if (!announcedStart && LIFECYCLE_NOTIFS) {
      announcedStart = true;
      await sendDiscord(`✅ **Aster Notifier started** and connected to ${WS_URL}`, {
        description: "Connected to WebSocket",
        color: COLORS.GREEN,
        timestamp: nowISO(),
      });
    }
  });

  ws.on("close", () => {
    console.log("[aster-notifier] Disconnected, retrying in 5s...");
    scheduleReconnect(5000);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
  });

  ws.on("message", async (data) => {
    let parsed;
    try {
      parsed = typeof data === "string" ? JSON.parse(data) : JSON.parse(data.toString("utf8"));
    } catch {
      if (DEBUG && debugCount < 3) {
        console.warn("[aster-notifier] Non-JSON message:", String(data).slice(0, 500));
        debugCount++;
      }
      return;
    }

    const { name, data: payload } = normalizeMessage(parsed);

    if (DEBUG && debugCount < 3) {
      console.log("[aster-notifier] DEBUG message:", {
        name,
        keys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 12) : typeof payload,
        sample: JSON.stringify(payload).slice(0, 300)
      });
      debugCount++;
    }

    if (!name) return;
    const n = String(name).toLowerCase();

    try {
      if (n === "order_filled" || n === "order-filled" || n === "orderfilled") {
        await handleOrderFilled(payload || {});
      } else if (n === "position_closed" || n === "position-closed" || n === "positionclosed") {
        await handlePositionClosed(payload || {});
      }
    } catch (err) {
      console.error("Handler error:", err);
    }
  });
}

// --- Boot ping ---
function bootPing() {
  if (!LIFECYCLE_NOTIFS) return;
  sendDiscord("🚀 **Aster Notifier booting**", {
    description: "Process started",
    color: COLORS.BLUE,
    timestamp: nowISO(),
  });
}

// --- Heartbeat ---
function startHeartbeat() {
  if (!HEARTBEAT_HOURS || HEARTBEAT_HOURS <= 0) return;
  const ms = HEARTBEAT_HOURS * 60 * 60 * 1000;
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    sendDiscord("🫀 Aster Notifier heartbeat (still alive)", {
      description: "Periodic health check",
      color: COLORS.YELLOW,
      timestamp: nowISO(),
    });
  }, ms);
}

// --- Shutdown ---
function shutdown(sig) {
  console.log(`[aster-notifier] Received ${sig}, shutting down...`);
  clearTimeout(reconnectTimer);
  clearInterval(heartbeatTimer);
  try { ws && ws.close(); } catch {}
  const done = LIFECYCLE_NOTIFS
    ? sendDiscord("🛑 **Aster Notifier stopping**", {
        description: "Process exiting",
        color: COLORS.RED,
        timestamp: nowISO(),
      })
    : Promise.resolve();
  done.finally(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// --- Start ---
banner();
bootPing();
startHeartbeat();
connect();
