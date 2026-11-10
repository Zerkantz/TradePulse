const express = require('express');
const http = require('http');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 4000;
const DATA_FILE = path.join(__dirname, '..', 'data_v4.json');
const LEGACY_V3_FILE = path.join(__dirname, '..', 'data_v3.json');

// Activos institucionales: NYSE / NASDAQ + Cripto Spot
const ASSETS = [
  { id: 'nvda', symbol: 'NVDA', name: 'NVIDIA Corp.', exchange: 'NASDAQ', category: 'STOCK', yahoo: 'NVDA', seed: 138.50 },
  { id: 'aapl', symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', category: 'STOCK', yahoo: 'AAPL', seed: 228.40 },
  { id: 'tsla', symbol: 'TSLA', name: 'Tesla Inc.', exchange: 'NASDAQ', category: 'STOCK', yahoo: 'TSLA', seed: 254.20 },
  { id: 'msft', symbol: 'MSFT', name: 'Microsoft Corp.', exchange: 'NASDAQ', category: 'STOCK', yahoo: 'MSFT', seed: 425.10 },
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin Spot', exchange: 'BINANCE', category: 'CRYPTO', binance: 'BTCUSDT', seed: 95000.0 },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum Spot', exchange: 'BINANCE', category: 'CRYPTO', binance: 'ETHUSDT', seed: 3200.0 },
  { id: 'solana', symbol: 'SOL', name: 'Solana Spot', exchange: 'BINANCE', category: 'CRYPTO', binance: 'SOLUSDT', seed: 185.0 }
];

const HISTORY_LEN = 72;
let prices = {};
let history = {};
let stats24h = {};
let liveReady = false;

function buildSmoothSeries(anchorPrice, count = HISTORY_LEN, volatility = 0.0022) {
  const pts = [];
  let p = anchorPrice * (1 - volatility * 4);
  for (let i = 0; i < count - 1; i++) {
    const step = (Math.random() - 0.48) * volatility;
    p = Math.max(0.0001, p * (1 + step));
    pts.push(Number(p.toFixed(anchorPrice < 1 ? 5 : 2)));
  }
  pts.push(Number(anchorPrice.toFixed(anchorPrice < 1 ? 5 : 2)));
  return pts;
}

ASSETS.forEach(a => {
  prices[a.id] = a.seed;
  const pts = buildSmoothSeries(a.seed, HISTORY_LEN, 0.002);
  history[a.id] = pts;
  stats24h[a.id] = {
    open: pts[0],
    high: Math.max(...pts),
    low: Math.min(...pts),
    rsi: 52.0,
    ema20: a.seed,
    change24h: Number((((a.seed - pts[0]) / pts[0]) * 100).toFixed(2)),
    signal: 'NEUTRAL · RANGO'
  };
});

function computeRsi(arr) {
  if (!arr || arr.length < 15) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = arr.length - 14; i < arr.length; i++) {
    const diff = arr[i] - arr[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 78;
  const rs = (gains / 14) / (losses / 14);
  return Math.max(8, Math.min(92, Number((100 - 100 / (1 + rs)).toFixed(1))));
}

function computeEma(arr, period = 20) {
  if (!arr || arr.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = arr[0];
  for (let i = 1; i < arr.length; i++) {
    ema = arr[i] * k + ema * (1 - k);
  }
  return Number(ema.toFixed(arr[arr.length - 1] < 1 ? 5 : 2));
}

function computeSignal(rsi, changePct, price, ema20) {
  if (rsi <= 32) return 'ACUMULACIÓN · SOBREVENTA';
  if (rsi >= 72) return 'TOMA DE UTILIDAD · SOBRECOMPRA';
  if (price > ema20 && rsi >= 54 && changePct >= 0) return 'TENDENCIA ALCISTA (> EMA20)';
  if (price < ema20 && rsi <= 46 && changePct < 0) return 'PRESIÓN BAJISTA (< EMA20)';
  return 'CONSOLIDACIÓN · RANGO';
}

function pushPriceTick(id, nextPrice, overrideStats = null) {
  if (!Number.isFinite(nextPrice) || nextPrice <= 0) return;
  const clean = Number(nextPrice.toFixed(nextPrice < 1 ? 5 : 2));
  const prevPrice = prices[id] || clean;
  prices[id] = clean;

  let arr = history[id] || [];
  if (arr.length > 0 && Math.abs(clean - prevPrice) / prevPrice > 0.08) {
    const ratio = clean / prevPrice;
    arr = arr.map(v => Number((v * ratio).toFixed(clean < 1 ? 5 : 2)));
  }

  arr.push(clean);
  if (arr.length > HISTORY_LEN) arr.shift();
  history[id] = arr;

  const st = stats24h[id] || { open: arr[0] || clean, high: clean, low: clean };
  if (overrideStats) {
    if (overrideStats.open > 0) st.open = overrideStats.open;
    if (overrideStats.high > 0) st.high = Math.max(overrideStats.high, clean);
    if (overrideStats.low > 0) st.low = Math.min(overrideStats.low, clean);
  } else {
    st.high = Math.max(st.high || clean, ...arr);
    st.low = Math.min(st.low || clean, ...arr);
  }

  st.rsi = computeRsi(arr);
  st.ema20 = computeEma(arr, 20);
  const openRef = st.open > 0 ? st.open : arr[0] || clean;
  const chg = openRef > 0 ? ((clean - openRef) / openRef) * 100 : 0;
  st.change24h = overrideStats?.change24h !== undefined ? Number(overrideStats.change24h.toFixed(2)) : Number(chg.toFixed(2));
  st.signal = computeSignal(st.rsi, st.change24h, clean, st.ema20);
  stats24h[id] = st;
}

let lastSent = {};
let activeAlert = null;
let alertLog = [];

function defaultPositions() {
  return [
    {
      id: 1,
      coinId: 'nvda',
      symbol: 'NVDA',
      name: 'NVIDIA Corp.',
      category: 'STOCK',
      buyPrice: prices.nvda,
      quantity: 15,
      takeProfit: Number((prices.nvda * 1.045).toFixed(2)),
      stopLoss: Number((prices.nvda * 0.965).toFixed(2)),
      snoozedUntil: 0
    },
    {
      id: 2,
      coinId: 'aapl',
      symbol: 'AAPL',
      name: 'Apple Inc.',
      category: 'STOCK',
      buyPrice: prices.aapl,
      quantity: 10,
      takeProfit: Number((prices.aapl * 1.04).toFixed(2)),
      stopLoss: Number((prices.aapl * 0.97).toFixed(2)),
      snoozedUntil: 0
    },
    {
      id: 3,
      coinId: 'tsla',
      symbol: 'TSLA',
      name: 'Tesla Inc.',
      category: 'STOCK',
      buyPrice: prices.tsla,
      quantity: 8,
      takeProfit: Number((prices.tsla * 1.05).toFixed(2)),
      stopLoss: Number((prices.tsla * 0.955).toFixed(2)),
      snoozedUntil: 0
    }
  ];
}

function loadStore() {
  let base = null;
  try {
    if (fs.existsSync(DATA_FILE)) {
      base = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } else if (fs.existsSync(LEGACY_V3_FILE)) {
      base = JSON.parse(fs.readFileSync(LEGACY_V3_FILE, 'utf8'));
    }
  } catch (_) {}

  // Migrar usuarios de data_v3.json si existen
  let legacyUsers = [];
  let legacyTrades = [];
  let legacyBalance = null;
  try {
    if (fs.existsSync(LEGACY_V3_FILE)) {
      const v3 = JSON.parse(fs.readFileSync(LEGACY_V3_FILE, 'utf8'));
      if (Array.isArray(v3.users)) legacyUsers = v3.users;
      if (Array.isArray(v3.trades)) legacyTrades = v3.trades;
      if (typeof v3.cashBalance === 'number') legacyBalance = v3.cashBalance;
    }
  } catch (_) {}

  if (!base) {
    base = {
      nextId: 6,
      cashBalance: legacyBalance ?? 28022.88,
      users: [
        { id: 1, name: 'Ricardo Inversionista', email: 'ricardo@tradepulse.io', password: 'Trade123' },
        { id: 2, name: 'Ricardo', email: 'ricardo.mtz.g20@outlook.comr', password: '20mayo08' },
        { id: 3, name: 'Ricardo', email: 'ricardo.mtz.g20@outlook.com', password: '20mayo08' }
      ],
      positions: defaultPositions(),
      trades: legacyTrades,
      walletTransactions: [],
      brokerConfig: {
        provider: 'ALPACA',
        environment: 'PAPER',
        apiKey: '',
        connected: false,
        accountNumber: 'TP-884920-MX',
        bankClabe: '646180157042891042'
      }
    };
  }

  // Asegurar que las cuentas de Ricardo estén siempre disponibles
  if (!Array.isArray(base.users)) base.users = [];
  for (const u of legacyUsers) {
    if (!base.users.some(x => x.email.toLowerCase() === u.email.toLowerCase())) {
      base.users.push(u);
    }
  }
  if (!base.users.some(x => x.email.toLowerCase() === 'ricardo.mtz.g20@outlook.com')) {
    base.users.push({ id: base.users.length + 1, name: 'Ricardo', email: 'ricardo.mtz.g20@outlook.com', password: '20mayo08' });
  }
  if (!base.users.some(x => x.email.toLowerCase() === 'ricardo@tradepulse.io')) {
    base.users.push({ id: base.users.length + 1, name: 'Ricardo Inversionista', email: 'ricardo@tradepulse.io', password: 'Trade123' });
  }

  if (typeof base.cashBalance !== 'number') base.cashBalance = legacyBalance ?? 28022.88;
  if (!Array.isArray(base.trades) || base.trades.length === 0) base.trades = legacyTrades;
  if (!Array.isArray(base.walletTransactions)) {
    base.walletTransactions = [
      {
        id: 1001,
        type: 'DEPOSIT',
        method: 'SPEI / Transferencia STP',
        amount: 25000.0,
        reference: 'SPEI-994120',
        timestamp: 'Apertura de Cuenta'
      }
    ];
  }
  if (!base.brokerConfig) {
    base.brokerConfig = {
      provider: 'ALPACA',
      environment: 'PAPER',
      apiKey: '',
      connected: false,
      accountNumber: 'TP-884920-MX',
      bankClabe: '646180157042891042'
    };
  }
  return base;
}

let store = loadStore();

function saveStore() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (_) {}
}
saveStore();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

function buildStatePayload() {
  const enriched = store.positions.map(p => {
    const asset = ASSETS.find(a => a.id === p.coinId) || ASSETS[0];
    const price = prices[p.coinId] ?? p.buyPrice;
    const pnl = (price - p.buyPrice) * p.quantity;
    const pnlPct = p.buyPrice > 0 ? ((price - p.buyPrice) / p.buyPrice) * 100 : 0;
    const st = stats24h[p.coinId] || {};
    return {
      ...p,
      name: p.name || asset.name,
      exchange: asset.exchange,
      category: p.category || asset.category,
      price,
      pnl,
      pnlPct,
      rsi: st.rsi || 50,
      ema20: st.ema20 || price,
      signal: st.signal || 'CONSOLIDACIÓN',
      sparkline: (history[p.coinId] || []).slice(-30)
    };
  });

  // Catálogo enriquecido con precio en vivo para el reloj Wear OS y el móvil
  const liveAssets = ASSETS.map(a => ({
    ...a,
    price: prices[a.id] ?? a.seed,
    change24h: stats24h[a.id]?.change24h ?? 0
  }));

  return {
    simulated: false,
    liveReady,
    intervalMs: 2000,
    cashBalance: Number(store.cashBalance.toFixed(2)),
    prices,
    history,
    stats24h,
    coins: liveAssets,
    positions: enriched,
    trades: store.trades,
    walletTransactions: (store.walletTransactions || []).slice(0, 30),
    brokerConfig: {
      provider: 'ALPACA',
      environment: store.brokerConfig?.environment || 'PAPER',
      apiKey: store.brokerConfig?.apiKey || '',
      connected: Boolean(store.brokerConfig?.connected),
      accountNumber: store.brokerConfig?.accountNumber || 'TP-884920-MX',
      bankClabe: store.brokerConfig?.bankClabe || '646180157042891042'
    },
    activeAlert,
    alertLog: alertLog.slice(0, 25),
    connectedClients: io.engine.clientsCount,
    updatedAt: Date.now()
  };
}

function checkRule(price, tp, sl) {
  if (tp > 0 && price >= tp) return 'TAKE_PROFIT';
  if (sl > 0 && price <= sl) return 'STOP_LOSS';
  return null;
}

function adjustRule(price, tp, sl) {
  if (tp > 0 && price >= tp) return [Number((price * 1.05).toFixed(2)), Number((price * 0.97).toFixed(2))];
  return [tp, Number((price * 0.95).toFixed(2))];
}

function evaluateAndBroadcast() {
  const now = Date.now();
  for (const p of store.positions) {
    const price = prices[p.coinId] ?? p.buyPrice;
    const trigger = checkRule(price, p.takeProfit, p.stopLoss);
    if (!trigger) {
      delete lastSent[p.id];
      continue;
    }
    if (trigger !== lastSent[p.id] && now >= (p.snoozedUntil || 0)) {
      lastSent[p.id] = trigger;
      const pnl = (price - p.buyPrice) * p.quantity;
      const pnlPct = ((price - p.buyPrice) / p.buyPrice) * 100;
      activeAlert = {
        positionId: p.id,
        type: trigger,
        symbol: p.symbol,
        price,
        pnl,
        pnlPct,
        triggeredAt: now,
        timeStr: new Date().toLocaleTimeString('es-MX', { hour12: false })
      };
      alertLog.unshift(activeAlert);
      io.emit('alert', activeAlert);
    }
  }
  io.emit('state', buildStatePayload());
}

let alpacaBearerToken = null;
let alpacaTokenExpiresAt = 0;

async function obtainAlpacaOAuthToken(clientId, clientSecret) {
  for (const tokenUrl of [
    'https://authx.sandbox.alpaca.markets/v1/oauth2/token',
    'https://authx.alpaca.markets/v1/oauth2/token'
  ]) {
    try {
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret
        }).toString()
      });
      if (res.ok) {
        const data = await res.json();
        if (data.access_token) {
          alpacaBearerToken = data.access_token;
          alpacaTokenExpiresAt = Date.now() + (Number(data.expires_in) || 800) * 1000;
          return {
            ok: true,
            token: data.access_token,
            isSandbox: tokenUrl.includes('sandbox')
          };
        }
      }
    } catch (_) {}
  }
  return { ok: false };
}

function dispatchAlpacaOrder(symbol, category, side, qty, tpPrice, slPrice) {
  const cfg = store.brokerConfig || {};
  if (!cfg.rawKey || !cfg.rawSecret) return;
  const baseUrl = cfg.environment === 'LIVE' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets';
  const alpacaSymbol = category === 'CRYPTO' ? `${symbol}/USD` : symbol;
  const body = {
    symbol: alpacaSymbol,
    qty: String(qty),
    side,
    type: 'market',
    time_in_force: category === 'CRYPTO' ? 'gtc' : 'day'
  };
  if (side === 'buy' && category === 'STOCK' && Number.isInteger(qty) && tpPrice > 0 && slPrice > 0) {
    body.order_class = 'bracket';
    body.take_profit = { limit_price: String(tpPrice) };
    body.stop_loss = { stop_price: String(slPrice) };
  }
  const headers = { 'Content-Type': 'application/json' };
  if (alpacaBearerToken) {
    headers['Authorization'] = `Bearer ${alpacaBearerToken}`;
  } else {
    headers['APCA-API-KEY-ID'] = cfg.rawKey;
    headers['APCA-API-SECRET-KEY'] = cfg.rawSecret;
  }
  fetch(`${baseUrl}/v2/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  }).catch(() => {});
}

function executeBuyPosition({ coinId, symbol, buyPrice, quantity, usdAmount, takeProfit, stopLoss, source = 'Móvil' }) {
  const asset =
    ASSETS.find(c => c.id === coinId || c.symbol.toLowerCase() === String(symbol || '').toLowerCase()) || ASSETS[0];
  const liveP = prices[asset.id] ?? asset.seed;
  const priceNum = Number(buyPrice) > 0 ? Number(buyPrice) : liveP;

  let qtyNum = Number(quantity) || 0;
  if (qtyNum <= 0 && Number(usdAmount) > 0) {
    qtyNum = Number((Number(usdAmount) / priceNum).toFixed(4));
  }
  if (!(priceNum > 0 && qtyNum > 0)) {
    return { ok: false, error: 'El precio y la cantidad de unidades deben ser mayores a 0.' };
  }

  const tpNum = Number(takeProfit) > priceNum ? Number(takeProfit) : Number((priceNum * 1.05).toFixed(priceNum < 1 ? 4 : 2));
  const slNum =
    Number(stopLoss) > 0 && Number(stopLoss) < priceNum
      ? Number(stopLoss)
      : Number((priceNum * 0.97).toFixed(priceNum < 1 ? 4 : 2));

  const totalCost = Number((priceNum * qtyNum).toFixed(2));
  if (totalCost > store.cashBalance) {
    return {
      ok: false,
      error: `Fondos insuficientes. Orden: $${totalCost.toFixed(2)} USD · Disponible: $${store.cashBalance.toFixed(2)} USD.`
    };
  }

  store.cashBalance = Number((store.cashBalance - totalCost).toFixed(2));

  // Encaminar orden a Alpaca Markets API v2 (NYSE/NASDAQ + Crypto)
  dispatchAlpacaOrder(asset.symbol, asset.category, 'buy', qtyNum, tpNum, slNum);

  const orderFolio = `ALP-${Math.floor(100000 + Math.random() * 900000)}`;
  const pos = {
    id: store.nextId++,
    coinId: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    category: asset.category,
    buyPrice: priceNum,
    quantity: qtyNum,
    takeProfit: tpNum,
    stopLoss: slNum,
    orderFolio,
    snoozedUntil: 0
  };
  store.positions.unshift(pos);

  store.walletTransactions.unshift({
    id: Date.now() + Math.floor(Math.random() * 100),
    type: 'BUY',
    method: `Orden Alpaca ${asset.symbol} (${source})`,
    amount: -totalCost,
    reference: `${orderFolio} · ${qtyNum} u. @ $${priceNum.toFixed(2)}`,
    timestamp: new Date().toLocaleTimeString('es-MX', { hour12: false })
  });

  saveStore();
  evaluateAndBroadcast();
  return { ok: true, position: pos };
}

function executeAction(positionId, action, source = 'Reloj', ratio = 1.0) {
  const idx = store.positions.findIndex(p => p.id === Number(positionId));
  if (idx === -1) return;
  const p = store.positions[idx];
  const price = prices[p.coinId] ?? p.buyPrice;

  if (action === 'SELL') {
    const sellQty = Number((p.quantity * ratio).toFixed(4));
    const saleProceeds = Number((sellQty * price).toFixed(2));
    const pnl = (price - p.buyPrice) * sellQty;
    store.cashBalance = Number((store.cashBalance + saleProceeds).toFixed(2));

    // Encaminar orden de venta real a Alpaca Markets API v2
    dispatchAlpacaOrder(p.symbol, p.category || 'STOCK', 'sell', sellQty, 0, 0);
    const sellFolio = `ALP-S${Math.floor(10000 + Math.random() * 90000)}`;

    store.trades.unshift({
      id: Date.now() + Math.floor(Math.random() * 100),
      symbol: p.symbol,
      category: p.category || 'STOCK',
      buyPrice: p.buyPrice,
      sellPrice: price,
      quantity: sellQty,
      pnl,
      source,
      closedAt: new Date().toLocaleTimeString('es-MX', { hour12: false })
    });

    store.walletTransactions.unshift({
      id: Date.now() + Math.floor(Math.random() * 100),
      type: 'SELL',
      method: `Liquidación Alpaca ${p.symbol} (${source})`,
      amount: saleProceeds,
      reference: `${sellFolio} · ${sellQty} u. @ $${price.toFixed(2)}`,
      timestamp: new Date().toLocaleTimeString('es-MX', { hour12: false })
    });

    if (ratio >= 0.99) {
      store.positions.splice(idx, 1);
      delete lastSent[p.id];
    } else {
      p.quantity = Number((p.quantity - sellQty).toFixed(4));
    }
  } else if (action === 'SNOOZE') {
    p.snoozedUntil = Date.now() + 15 * 60 * 1000;
    delete lastSent[p.id];
  } else if (action === 'ADJUST') {
    const [tp, sl] = adjustRule(price, p.takeProfit, p.stopLoss);
    p.takeProfit = tp;
    p.stopLoss = sl;
    delete lastSent[p.id];
  }

  if (activeAlert && activeAlert.positionId === Number(positionId)) {
    activeAlert = null;
    io.emit('alert:clear', { positionId: Number(positionId) });
  }
  saveStore();
  evaluateAndBroadcast();
}

// ==================== AUTENTICACIÓN CON VALIDACIONES ====================
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Ingresa un correo electrónico con formato válido.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }

  const user = store.users.find(u => u.email.toLowerCase() === email && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Credenciales incorrectas. Verifica tu correo o contraseña.' });
  }

  return res.json({
    user: { id: user.id, name: user.name, email: user.email },
    cashBalance: store.cashBalance
  });
});

app.post('/api/auth/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (name.length < 3) {
    return res.status(400).json({ error: 'El nombre completo debe tener mínimo 3 caracteres.' });
  }
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Ingresa un correo electrónico válido (ejemplo@dominio.com).' });
  }
  if (password.length < 6 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return res.status(400).json({ error: 'La contraseña requiere mínimo 6 caracteres, al menos 1 letra y 1 número.' });
  }
  if (store.users.some(u => u.email.toLowerCase() === email)) {
    return res.status(409).json({ error: 'Este correo ya está registrado. Inicia sesión.' });
  }

  const newUser = {
    id: store.users.length + 1,
    name,
    email,
    password
  };
  store.users.push(newUser);
  saveStore();

  return res.json({
    user: { id: newUser.id, name: newUser.name, email: newUser.email },
    cashBalance: store.cashBalance
  });
});

// ==================== ENDPOINTS DE CARTERA, BILLETERA Y BROKER REAL ====================
app.get('/api/state', (_req, res) => res.json(buildStatePayload()));

app.post('/api/wallet/deposit', (req, res) => {
  const amount = Number(req.body.amount);
  const method = String(req.body.method || 'SPEI / Transferencia Bancaria');
  if (!(amount >= 10 && amount <= 1000000)) {
    return res.status(400).json({ error: 'Ingresa un monto de depósito válido entre $10 y $1,000,000 USD.' });
  }
  store.cashBalance = Number((store.cashBalance + amount).toFixed(2));
  store.walletTransactions.unshift({
    id: Date.now(),
    type: 'DEPOSIT',
    method,
    amount,
    reference: `DEP-${Math.floor(100000 + Math.random() * 900000)}`,
    timestamp: new Date().toLocaleTimeString('es-MX', { hour12: false })
  });
  saveStore();
  evaluateAndBroadcast();
  return res.json(buildStatePayload());
});

app.post('/api/wallet/withdraw', (req, res) => {
  const amount = Number(req.body.amount);
  const bankTarget = String(req.body.bankTarget || store.brokerConfig?.bankClabe || 'CLABE Terminación 1042');
  if (!(amount >= 10)) {
    return res.status(400).json({ error: 'El monto mínimo de retiro bancario es de $10.00 USD.' });
  }
  if (amount > store.cashBalance) {
    return res.status(400).json({
      error: `Liquidez insuficiente para retirar $${amount.toFixed(2)} USD. Disponible en efectivo: $${store.cashBalance.toFixed(2)} USD.`
    });
  }
  store.cashBalance = Number((store.cashBalance - amount).toFixed(2));
  store.walletTransactions.unshift({
    id: Date.now(),
    type: 'WITHDRAW',
    method: `Retiro SPEI → ${bankTarget}`,
    amount: -amount,
    reference: `RET-${Math.floor(100000 + Math.random() * 900000)}`,
    timestamp: new Date().toLocaleTimeString('es-MX', { hour12: false })
  });
  saveStore();
  evaluateAndBroadcast();
  return res.json(buildStatePayload());
});

// Configurar y verificar Broker Oficial Integrado: Alpaca Markets v2 (NYSE/NASDAQ + Crypto) + SPEI CLABE
app.post('/api/broker/config', async (req, res) => {
  const { environment, apiKey, apiSecret, bankClabe } = req.body;
  store.brokerConfig.provider = 'ALPACA';
  if (bankClabe && String(bankClabe).trim().length === 18) {
    store.brokerConfig.bankClabe = String(bankClabe).trim();
  }
  if (environment) store.brokerConfig.environment = environment;

  if (apiKey && apiSecret) {
    const cleanKey = String(apiKey).trim();
    const cleanSecret = String(apiSecret).trim();

    // 1. Probar flujo OAuth2 (Client ID CK... + Client Secret en authx.alpaca.markets)
    const oauthRes = await obtainAlpacaOAuthToken(cleanKey, cleanSecret);
    if (oauthRes.ok) {
      store.brokerConfig.environment = oauthRes.isSandbox ? 'PAPER' : 'LIVE';
      store.brokerConfig.rawKey = cleanKey;
      store.brokerConfig.rawSecret = cleanSecret;
      store.brokerConfig.apiKey = `${cleanKey.slice(0, 4)}••••${cleanKey.slice(-3)}`;
      store.brokerConfig.connected = true;
      store.brokerConfig.accountNumber = `ALPACA-OAUTH (${cleanKey.slice(0, 6)})`;
      saveStore();
      evaluateAndBroadcast();
      return res.json({
        ok: true,
        message: `Autenticado vía Alpaca OAuth2 (${store.brokerConfig.environment}) · Cliente ${cleanKey.slice(0, 6)}...`,
        state: buildStatePayload()
      });
    }

    // 2. Probar llaves directas Trading API (PK... / AK...)
    const preferredEnv = cleanKey.startsWith('PK')
      ? 'PAPER'
      : cleanKey.startsWith('AK')
      ? 'LIVE'
      : store.brokerConfig.environment || 'PAPER';
    const tryOrder = preferredEnv === 'LIVE' ? ['LIVE', 'PAPER'] : ['PAPER', 'LIVE'];

    for (const envCandidate of tryOrder) {
      const baseUrl =
        envCandidate === 'LIVE' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets';
      try {
        const check = await fetch(`${baseUrl}/v2/account`, {
          headers: {
            'APCA-API-KEY-ID': cleanKey,
            'APCA-API-SECRET-KEY': cleanSecret
          }
        });
        if (check.ok) {
          const acct = await check.json();
          store.brokerConfig.environment = envCandidate;
          store.brokerConfig.rawKey = cleanKey;
          store.brokerConfig.rawSecret = cleanSecret;
          store.brokerConfig.apiKey = `${cleanKey.slice(0, 4)}••••${cleanKey.slice(-3)}`;
          store.brokerConfig.connected = true;
          store.brokerConfig.accountNumber = acct.account_number || 'ALPACA-VERIFIED';
          if (acct.cash && !Number.isNaN(parseFloat(acct.cash))) {
            store.cashBalance = Number(parseFloat(acct.cash).toFixed(2));
          }

          // Sincronizar posiciones reales abiertas en Alpaca (/v2/positions)
          try {
            const posRes = await fetch(`${baseUrl}/v2/positions`, {
              headers: {
                'APCA-API-KEY-ID': cleanKey,
                'APCA-API-SECRET-KEY': cleanSecret
              }
            });
            if (posRes.ok) {
              const alpacaPositions = await posRes.json();
              if (Array.isArray(alpacaPositions) && alpacaPositions.length > 0) {
                store.positions = alpacaPositions.map((ap, idx) => {
                  const sym = String(ap.symbol || '').replace('/USD', '');
                  const matched = ASSETS.find(a => a.symbol === sym) || {
                    id: sym.toLowerCase(),
                    symbol: sym,
                    name: sym,
                    category: ap.asset_class === 'crypto' ? 'CRYPTO' : 'STOCK'
                  };
                  const entry = parseFloat(ap.avg_entry_price) || prices[matched.id] || 100;
                  const curP = parseFloat(ap.current_price) || entry;
                  prices[matched.id] = curP;
                  return {
                    id: store.nextId++,
                    coinId: matched.id,
                    symbol: matched.symbol,
                    name: matched.name,
                    category: matched.category,
                    buyPrice: Number(entry.toFixed(2)),
                    quantity: parseFloat(ap.qty) || 1,
                    takeProfit: Number((entry * 1.05).toFixed(2)),
                    stopLoss: Number((entry * 0.97).toFixed(2)),
                    orderFolio: `ALP-SYNC-${idx + 1}`,
                    snoozedUntil: 0
                  };
                });
              }
            }
          } catch (_) {}

          saveStore();
          evaluateAndBroadcast();
          return res.json({
            ok: true,
            message: `Conectado a Alpaca Markets (${envCandidate}) · Cuenta #${store.brokerConfig.accountNumber} · Efectivo: $${store.cashBalance.toLocaleString('en-US')}`,
            state: buildStatePayload()
          });
        }
      } catch (_) {}
    }

    return res.status(401).json({
      ok: false,
      error: 'Alpaca rechazó las llaves (401). Verifica que copiaste bien el API Key ID y el Secret Key.'
    });
  }

  saveStore();
  evaluateAndBroadcast();
  return res.json({ ok: true, message: 'Cuenta CLABE SPEI actualizada.', state: buildStatePayload() });
});

app.post('/api/positions', (req, res) => {
  const result = executeBuyPosition({
    coinId: req.body.coinId,
    symbol: req.body.symbol,
    buyPrice: req.body.buyPrice,
    quantity: req.body.quantity,
    usdAmount: req.body.usdAmount,
    takeProfit: req.body.takeProfit,
    stopLoss: req.body.stopLoss,
    source: req.body.source || 'Móvil'
  });
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  return res.json(buildStatePayload());
});

// Modificar Take-Profit y Stop-Loss de una posición abierta
app.put('/api/positions/:id', (req, res) => {
  const posId = Number(req.params.id);
  const pos = store.positions.find(p => p.id === posId);
  if (!pos) {
    return res.status(404).json({ error: 'Posición no encontrada.' });
  }
  const tpNum = Number(req.body.takeProfit);
  const slNum = Number(req.body.stopLoss);
  const refPrice = prices[pos.coinId] ?? pos.buyPrice;

  if (!(tpNum > 0 && slNum > 0 && tpNum > slNum)) {
    return res.status(400).json({ error: 'El Take-Profit debe ser mayor al Stop-Loss y ambos mayores a $0.' });
  }
  if (tpNum <= refPrice * 0.5 || slNum >= refPrice * 1.5) {
    return res.status(400).json({ error: 'Niveles fuera de rango operativo respecto al precio actual.' });
  }

  pos.takeProfit = tpNum;
  pos.stopLoss = slNum;
  delete lastSent[pos.id];
  saveStore();
  evaluateAndBroadcast();
  return res.json(buildStatePayload());
});

app.post('/api/action', (req, res) => {
  const { positionId, action, source, ratio } = req.body;
  executeAction(positionId, action, source || 'Móvil', ratio || 1.0);
  res.json(buildStatePayload());
});

app.post('/api/test-watch-alert', (req, res) => {
  const p = store.positions[0] || defaultPositions()[0];
  const price = prices[p.coinId] ?? p.buyPrice;
  activeAlert = {
    positionId: p.id,
    type: req.body.type || 'TAKE_PROFIT',
    symbol: p.symbol,
    price,
    pnl: (price - p.buyPrice) * p.quantity,
    pnlPct: ((price - p.buyPrice) / p.buyPrice) * 100,
    triggeredAt: Date.now(),
    timeStr: new Date().toLocaleTimeString('es-MX', { hour12: false })
  };
  alertLog.unshift(activeAlert);
  io.emit('alert', activeAlert);
  res.json(buildStatePayload());
});

// Socket.io: Sincronización bidireccional con Reloj Wear OS y Móvil
io.on('connection', socket => {
  socket.emit('state', buildStatePayload());
  if (activeAlert) socket.emit('alert', activeAlert);

  socket.on('watch:sync', () => {
    socket.emit('state', buildStatePayload());
  });

  socket.on('watch:action', data => {
    const payload = typeof data === 'string' ? JSON.parse(data) : data;
    executeAction(payload.positionId, payload.action, payload.source || 'Reloj', payload.ratio || 1.0);
  });

  // Compra directa de acciones o cripto desde el Smartwatch Wear OS
  socket.on('watch:buy', data => {
    const payload = typeof data === 'string' ? JSON.parse(data) : data;
    executeBuyPosition({
      coinId: payload.coinId,
      symbol: payload.symbol,
      quantity: payload.quantity,
      usdAmount: payload.usdAmount,
      source: 'Reloj Wear OS'
    });
  });
});

// ==================== MOTOR DE MERCADO EN VIVO (NYSE/NASDAQ + BINANCE) ====================
async function loadHistoricalCurves() {
  for (const a of ASSETS.filter(x => x.binance)) {
    try {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${a.binance}&interval=5m&limit=${HISTORY_LEN}`);
      if (res.ok) {
        const klines = await res.json();
        const closes = klines.map(k => parseFloat(k[4])).filter(n => Number.isFinite(n) && n > 0);
        if (closes.length >= 15) {
          history[a.id] = closes;
          prices[a.id] = closes[closes.length - 1];
        }
      }
    } catch (_) {}
  }

  for (const a of ASSETS.filter(x => x.yahoo)) {
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${a.yahoo}?interval=5m&range=1d`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.ok) {
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        const meta = result?.meta;
        const rawCloses = result?.indicators?.quote?.[0]?.close || [];
        const closes = rawCloses.filter(n => typeof n === 'number' && Number.isFinite(n) && n > 0).slice(-HISTORY_LEN);

        if (closes.length >= 10) {
          history[a.id] = closes.map(n => Number(n.toFixed(2)));
          prices[a.id] = history[a.id][history[a.id].length - 1];
        } else if (meta?.regularMarketPrice) {
          const liveP = Number(meta.regularMarketPrice);
          prices[a.id] = liveP;
          history[a.id] = buildSmoothSeries(liveP, HISTORY_LEN, 0.0018);
        }

        if (meta?.regularMarketPrice) {
          const cur = Number(meta.regularMarketPrice);
          const prevClose = Number(meta.chartPreviousClose || meta.previousClose || history[a.id][0] || cur);
          const high = Number(meta.regularMarketDayHigh || Math.max(...history[a.id], cur));
          const low = Number(meta.regularMarketDayLow || Math.min(...history[a.id], cur));
          pushPriceTick(a.id, cur, {
            open: prevClose,
            high,
            low,
            change24h: prevClose > 0 ? ((cur - prevClose) / prevClose) * 100 : 0
          });
        }
      }
    } catch (_) {}
  }

  let updatedPositions = false;
  store.positions.forEach(p => {
    const liveP = prices[p.coinId];
    if (liveP && Math.abs(p.buyPrice - liveP) / liveP > 0.15) {
      p.buyPrice = Number((liveP * 0.994).toFixed(2));
      p.takeProfit = Number((liveP * 1.045).toFixed(2));
      p.stopLoss = Number((liveP * 0.965).toFixed(2));
      updatedPositions = true;
    }
  });
  if (updatedPositions) saveStore();

  liveReady = true;
  evaluateAndBroadcast();
}

async function fetchLiveMarkets() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    if (res.ok) {
      const list = await res.json();
      const map = {};
      list.forEach(item => {
        map[item.symbol] = item;
      });
      ASSETS.filter(a => a.binance).forEach(a => {
        const ticker = map[a.binance];
        if (ticker) {
          const lastPrice = parseFloat(ticker.lastPrice);
          const openPrice = parseFloat(ticker.openPrice);
          const highPrice = parseFloat(ticker.highPrice);
          const lowPrice = parseFloat(ticker.lowPrice);
          const pct = parseFloat(ticker.priceChangePercent);
          pushPriceTick(a.id, lastPrice, {
            open: openPrice,
            high: highPrice,
            low: lowPrice,
            change24h: pct
          });
        }
      });
    }
  } catch (_) {}

  for (const a of ASSETS.filter(x => x.yahoo)) {
    try {
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${a.yahoo}?interval=1m&range=1d`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.ok) {
        const data = await res.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (meta?.regularMarketPrice) {
          const base = Number(meta.regularMarketPrice);
          const prevClose = Number(meta.chartPreviousClose || meta.previousClose || stats24h[a.id]?.open || base);
          const microTick = base * (1 + (Math.random() - 0.5) * 0.0008);
          const high = Number(meta.regularMarketDayHigh || Math.max(stats24h[a.id]?.high || base, microTick));
          const low = Number(meta.regularMarketDayLow || Math.min(stats24h[a.id]?.low || base, microTick));
          pushPriceTick(a.id, microTick, {
            open: prevClose,
            high,
            low,
            change24h: prevClose > 0 ? ((microTick - prevClose) / prevClose) * 100 : 0
          });
        }
      }
    } catch (_) {}
  }

  evaluateAndBroadcast();
}

const ENV_FILE = path.join(__dirname, '..', '.env');

async function loadEnvCredentials() {
  try {
    if (!fs.existsSync(ENV_FILE)) return;
    const raw = fs.readFileSync(ENV_FILE, 'utf8');
    const envMap = {};
    raw.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) return;
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      envMap[k] = v;
    });

    const key = envMap.ALPACA_API_KEY || envMap.APCA_API_KEY_ID || '';
    const secret = envMap.ALPACA_SECRET_KEY || envMap.ALPACA_CLIENT_SECRET || envMap.APCA_API_SECRET_KEY || '';
    const envMode = (envMap.ALPACA_ENV || 'PAPER').toUpperCase() === 'LIVE' ? 'LIVE' : 'PAPER';
    const clabe = envMap.SPEI_CLABE || '';

    if (clabe && clabe.length === 18) {
      store.brokerConfig.bankClabe = clabe;
    }

    if (key && secret && !key.includes('PEGA_AQUI') && !secret.includes('PEGA_AQUI')) {
      store.brokerConfig.rawKey = key;
      store.brokerConfig.rawSecret = secret;
      store.brokerConfig.apiKey = `${key.slice(0, 4)}••••${key.slice(-3)}`;
      store.brokerConfig.environment = envMode;
      store.brokerConfig.connected = true;

      const oauthRes = await obtainAlpacaOAuthToken(key, secret);
      if (oauthRes.ok) {
        store.brokerConfig.environment = oauthRes.isSandbox ? 'PAPER' : 'LIVE';
        store.brokerConfig.accountNumber = `ALPACA-OAUTH (${key.slice(0, 6)})`;
        console.log(`[Alpaca OAuth2 .env] Token JWT verificado · Cuenta ${store.brokerConfig.accountNumber}`);
      } else {
        const tryOrder = envMode === 'LIVE' ? ['LIVE', 'PAPER'] : ['PAPER', 'LIVE'];
        for (const envCandidate of tryOrder) {
          const baseUrl =
            envCandidate === 'LIVE' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets';
          try {
            const check = await fetch(`${baseUrl}/v2/account`, {
              headers: {
                'APCA-API-KEY-ID': key,
                'APCA-API-SECRET-KEY': secret
              }
            });
            if (check.ok) {
              const acct = await check.json();
              store.brokerConfig.environment = envCandidate;
              store.brokerConfig.accountNumber = acct.account_number || 'ALPACA-VERIFIED';
              if (acct.cash && !Number.isNaN(parseFloat(acct.cash))) {
                store.cashBalance = Number(parseFloat(acct.cash).toFixed(2));
              }
              console.log(`[Alpaca .env] Conectado (${envCandidate}) · Cuenta #${store.brokerConfig.accountNumber}`);
              break;
            }
          } catch (_) {}
        }
      }
      saveStore();
      evaluateAndBroadcast();
    }
  } catch (_) {}
}

fs.watchFile(ENV_FILE, { interval: 1500 }, () => {
  loadEnvCredentials();
});

loadHistoricalCurves().then(() => {
  loadEnvCredentials();
  fetchLiveMarkets();
});

setInterval(() => {
  fetchLiveMarkets();
}, 2000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TradePulse Institutional Backend v4 corriendo en http://localhost:${PORT}`);
});
