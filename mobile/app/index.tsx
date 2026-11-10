import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Platform,
  Dimensions,
  StatusBar
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Line, Circle, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { io, Socket } from 'socket.io-client';

function resolveBackendUrl(): string {
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const ip = hostUri.split(':')[0];
    if (ip) return `http://${ip}:4000`;
  }
  return 'http://192.168.0.92:4000';
}

const BACKEND_URL = resolveBackendUrl();
const SCREEN_W = Dimensions.get('window').width;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ==================== SISTEMA DE TEMAS: OSCURO Y CLARO INSTITUCIONAL ====================
interface ThemePalette {
  mode: 'dark' | 'light';
  bg: string;
  card: string;
  cardElevated: string;
  cardSubtle: string;
  chartBg: string;
  chartGrid: string;
  border: string;
  text: string;
  textSec: string;
  textMuted: string;
  inputBg: string;
  bull: string;
  bullSoft: string;
  bullBorder: string;
  bear: string;
  bearSoft: string;
  bearBorder: string;
  accent: string;
  accentSoft: string;
  warn: string;
  backdrop: string;
}

const DARK_THEME: ThemePalette = {
  mode: 'dark',
  bg: '#090D14',
  card: '#111722',
  cardElevated: '#172030',
  cardSubtle: '#0D121B',
  chartBg: '#0B1018',
  chartGrid: '#1B2537',
  border: '#222F43',
  text: '#F1F5F9',
  textSec: '#94A3B8',
  textMuted: '#64748B',
  inputBg: '#090D14',
  bull: '#10B981',
  bullSoft: 'rgba(16,185,129,0.14)',
  bullBorder: 'rgba(16,185,129,0.42)',
  bear: '#F43F5E',
  bearSoft: 'rgba(244,63,94,0.14)',
  bearBorder: 'rgba(244,63,94,0.42)',
  accent: '#38BDF8',
  accentSoft: 'rgba(56,189,248,0.14)',
  warn: '#F59E0B',
  backdrop: 'rgba(6, 9, 15, 0.84)'
};

const LIGHT_THEME: ThemePalette = {
  mode: 'light',
  bg: '#F1F5F9',
  card: '#FFFFFF',
  cardElevated: '#E2E8F0',
  cardSubtle: '#F8FAFC',
  chartBg: '#F8FAFC',
  chartGrid: '#E2E8F0',
  border: '#CBD5E1',
  text: '#0F172A',
  textSec: '#475569',
  textMuted: '#64748B',
  inputBg: '#F8FAFC',
  bull: '#059669',
  bullSoft: 'rgba(5,150,105,0.11)',
  bullBorder: 'rgba(5,150,105,0.38)',
  bear: '#E11D48',
  bearSoft: 'rgba(225,29,72,0.10)',
  bearBorder: 'rgba(225,29,72,0.36)',
  accent: '#0284C7',
  accentSoft: 'rgba(2,132,199,0.11)',
  warn: '#D97706',
  backdrop: 'rgba(15, 23, 42, 0.55)'
};

interface UserSession {
  id: number;
  name: string;
  email: string;
}

interface Asset {
  id: string;
  symbol: string;
  name: string;
  exchange?: string;
  category: 'STOCK' | 'CRYPTO';
  seed: number;
}

interface Stat24h {
  open: number;
  high: number;
  low: number;
  rsi: number;
  ema20?: number;
  change24h?: number;
  signal: string;
}

interface Position {
  id: number;
  coinId: string;
  symbol: string;
  name?: string;
  exchange?: string;
  category?: 'STOCK' | 'CRYPTO';
  buyPrice: number;
  price: number;
  quantity: number;
  takeProfit: number;
  stopLoss: number;
  pnl: number;
  pnlPct: number;
  rsi?: number;
  ema20?: number;
  signal?: string;
  sparkline?: number[];
  snoozedUntil?: number;
}

interface Trade {
  id: number;
  symbol: string;
  category?: string;
  buyPrice: number;
  sellPrice: number;
  quantity: number;
  pnl: number;
  source: string;
  closedAt: string;
}

interface AlertEvent {
  positionId: number;
  type: 'TAKE_PROFIT' | 'STOP_LOSS';
  symbol: string;
  price: number;
  pnl: number;
  pnlPct: number;
  timeStr?: string;
}

interface WalletTransaction {
  id: number;
  type: 'DEPOSIT' | 'WITHDRAW' | 'BUY' | 'SELL';
  method: string;
  amount: number;
  reference: string;
  timestamp: string;
}

interface BrokerConfig {
  provider: 'ALPACA' | 'BINANCE';
  environment: 'PAPER' | 'LIVE';
  apiKey: string;
  connected: boolean;
  accountNumber: string;
  bankClabe: string;
}

const DEFAULT_ASSETS: Asset[] = [
  { id: 'nvda', symbol: 'NVDA', name: 'NVIDIA Corp.', exchange: 'NASDAQ', category: 'STOCK', seed: 138.50 },
  { id: 'aapl', symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', category: 'STOCK', seed: 228.40 },
  { id: 'tsla', symbol: 'TSLA', name: 'Tesla Inc.', exchange: 'NASDAQ', category: 'STOCK', seed: 254.20 },
  { id: 'msft', symbol: 'MSFT', name: 'Microsoft Corp.', exchange: 'NASDAQ', category: 'STOCK', seed: 425.10 },
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin Spot', exchange: 'BINANCE', category: 'CRYPTO', seed: 95000.0 },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum Spot', exchange: 'BINANCE', category: 'CRYPTO', seed: 3200.0 },
  { id: 'solana', symbol: 'SOL', name: 'Solana Spot', exchange: 'BINANCE', category: 'CRYPTO', seed: 185.0 }
];

const fmtPrice = (v: number) => {
  const n = Number(v) || 0;
  return n < 1
    ? '$' + n.toFixed(4)
    : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtMoney = (v: number) => {
  const n = Number(v) || 0;
  return (n >= 0 ? '+' : '-') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtPct = (v: number) => {
  const n = Number(v) || 0;
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
};

function computeEmaSeries(arr: number[], period = 14): number[] {
  if (!arr || arr.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    out.push(arr[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

/**
 * Gráfica Financiera Institucional sin límites fijos ni aplastamiento de escala.
 * - Auto-escala dinámica centrada en la serie de precios real con 18% de margen superior/inferior.
 * - Cuando la acción cae fuerte, el eje Y acompaña la caída sin pegarse al borde inferior.
 * - Soporta modo de escala AUTO (centrado en precio) o RANGO TP/SL (vista completa de objetivos),
 *   media móvil EMA, e inspección táctil punto por punto (crosshair).
 */
function InstitutionalPriceChart({
  points,
  takeProfit,
  stopLoss,
  buyPrice,
  theme,
  scaleMode,
  showEma,
  selectedIdx,
  onSelectIdx
}: {
  points: number[];
  takeProfit?: number;
  stopLoss?: number;
  buyPrice?: number;
  theme: ThemePalette;
  scaleMode: 'AUTO' | 'FULL';
  showEma: boolean;
  selectedIdx: number | null;
  onSelectIdx: (idx: number | null) => void;
}) {
  const w = Math.min(SCREEN_W - 58, 520);
  const h = 196;
  const padTop = 22;
  const padBottom = 22;
  const plotH = h - padTop - padBottom;

  const chartData = useMemo(() => {
    const clean = (points || []).filter(v => typeof v === 'number' && Number.isFinite(v) && v > 0);
    const arr = clean.length >= 2 ? clean : [100, 100.2, 100.1, 100.4];
    const emaArr = computeEmaSeries(arr, 12);

    // En modo AUTO escalamos estrictamente sobre la curva de precio + EMA para que las caídas nunca aplasten la línea
    const scaleValues = [...arr, ...(showEma ? emaArr : [])];
    if (scaleMode === 'FULL') {
      if (takeProfit && takeProfit > 0) scaleValues.push(takeProfit);
      if (stopLoss && stopLoss > 0) scaleValues.push(stopLoss);
      if (buyPrice && buyPrice > 0) scaleValues.push(buyPrice);
    }

    const rawMin = Math.min(...scaleValues);
    const rawMax = Math.max(...scaleValues);
    const basePrice = arr[arr.length - 1] || 1;
    // Garantizar un span mínimo razonable (0.12% del precio) y un colchón de 18% arriba y abajo
    const minSpan = basePrice * 0.0012;
    const rawSpan = Math.max(minSpan, rawMax - rawMin);
    const padPrice = rawSpan * 0.18;

    const yMin = rawMin - padPrice;
    const yMax = rawMax + padPrice;
    const ySpan = Math.max(0.00001, yMax - yMin);

    const toY = (val: number) => {
      const ratio = (val - yMin) / ySpan;
      const clamped = Math.max(0, Math.min(1, ratio));
      return padTop + (1 - clamped) * plotH;
    };
    const toX = (idx: number) => (idx / Math.max(1, arr.length - 1)) * (w - 8) + 4;

    let dLine = '';
    let dEma = '';
    const coords: { x: number; y: number; val: number; ema: number }[] = [];

    arr.forEach((v, i) => {
      const x = toX(i);
      const y = toY(v);
      const ey = toY(emaArr[i]);
      coords.push({ x, y, val: v, ema: emaArr[i] });
      dLine += i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
      dEma += i === 0 ? `M ${x.toFixed(1)} ${ey.toFixed(1)}` : ` L ${x.toFixed(1)} ${ey.toFixed(1)}`;
    });

    const firstX = coords[0].x.toFixed(1);
    const lastCoord = coords[coords.length - 1];
    const dArea = `${dLine} L ${lastCoord.x.toFixed(1)} ${(h - 4).toFixed(1)} L ${firstX} ${(h - 4).toFixed(1)} Z`;

    const isCurveBull = arr[arr.length - 1] >= arr[0];

    const inBounds = (v?: number) => typeof v === 'number' && v >= yMin && v <= yMax;

    return {
      arr,
      coords,
      dLine,
      dEma,
      dArea,
      rawMin,
      rawMax,
      yMin,
      yMax,
      lastCoord,
      isCurveBull,
      tpY: inBounds(takeProfit) ? toY(takeProfit!) : null,
      slY: inBounds(stopLoss) ? toY(stopLoss!) : null,
      buyY: inBounds(buyPrice) ? toY(buyPrice!) : null,
      tpOutTop: takeProfit && takeProfit > yMax,
      slOutBottom: stopLoss && stopLoss < yMin
    };
  }, [points, takeProfit, stopLoss, buyPrice, scaleMode, showEma, w]);

  const strokeColor = chartData.isCurveBull ? theme.bull : theme.bear;
  const activePoint =
    selectedIdx !== null && chartData.coords[selectedIdx]
      ? chartData.coords[selectedIdx]
      : chartData.lastCoord;
  const openVal = chartData.arr[0] || activePoint.val;
  const activeDeltaPct = openVal > 0 ? ((activePoint.val - openVal) / openVal) * 100 : 0;

  // Dividir la gráfica en 18 columnas táctiles para inspección rápida sin bloquear el scroll
  const touchCols = 18;

  return (
    <View style={[styles.chartBox, { backgroundColor: theme.chartBg, borderColor: theme.border }]}>
      {/* Barra superior de lectura de vela/punto e indicadores fuera de escala */}
      <View style={styles.chartInspectorBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 10, color: theme.textMuted, fontWeight: '700' }}>
            {selectedIdx !== null ? `PUNTO #${selectedIdx + 1}` : 'ÚLTIMO TICK'}:
          </Text>
          <Text style={{ fontSize: 11, color: theme.text, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
            {fmtPrice(activePoint.val)}
          </Text>
          <Text
            style={{
              fontSize: 10,
              fontWeight: '700',
              color: activeDeltaPct >= 0 ? theme.bull : theme.bear,
              fontVariant: ['tabular-nums']
            }}
          >
            ({fmtPct(activeDeltaPct)})
          </Text>
          {showEma && (
            <Text style={{ fontSize: 10, color: theme.accent, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
              EMA12: {fmtPrice(activePoint.ema)}
            </Text>
          )}
        </View>

        {selectedIdx !== null && (
          <TouchableOpacity onPress={() => onSelectIdx(null)}>
            <Text style={{ fontSize: 10, color: theme.accent, fontWeight: '700' }}>Ver actual</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Etiquetas de precio en eje Y derecho */}
      <View style={styles.chartScaleCol} pointerEvents="none">
        <Text style={[styles.chartAxisText, { color: theme.textMuted, backgroundColor: theme.chartBg }]}>
          {fmtPrice(chartData.rawMax)}
        </Text>
        <Text style={[styles.chartAxisText, { color: theme.textMuted, backgroundColor: theme.chartBg }]}>
          {fmtPrice((chartData.rawMax + chartData.rawMin) / 2)}
        </Text>
        <Text style={[styles.chartAxisText, { color: theme.textMuted, backgroundColor: theme.chartBg }]}>
          {fmtPrice(chartData.rawMin)}
        </Text>
      </View>

      <View style={{ position: 'relative', width: w, height: h }}>
        <Svg width={w} height={h}>
          <Defs>
            <LinearGradient id="priceAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={strokeColor} stopOpacity={theme.mode === 'dark' ? '0.30' : '0.22'} />
              <Stop offset="85%" stopColor={strokeColor} stopOpacity="0.02" />
              <Stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
            </LinearGradient>
          </Defs>

          {/* Cuadrícula horizontal y vertical */}
          <Line x1="0" y1={padTop} x2={w} y2={padTop} stroke={theme.chartGrid} strokeWidth="1" />
          <Line x1="0" y1={padTop + plotH * 0.5} x2={w} y2={padTop + plotH * 0.5} stroke={theme.chartGrid} strokeWidth="1" />
          <Line x1="0" y1={padTop + plotH} x2={w} y2={padTop + plotH} stroke={theme.chartGrid} strokeWidth="1" />

          <Line x1={w * 0.25} y1={padTop} x2={w * 0.25} y2={h - padBottom} stroke={theme.chartGrid} strokeWidth="0.7" strokeDasharray="2,4" />
          <Line x1={w * 0.5} y1={padTop} x2={w * 0.5} y2={h - padBottom} stroke={theme.chartGrid} strokeWidth="0.7" strokeDasharray="2,4" />
          <Line x1={w * 0.75} y1={padTop} x2={w * 0.75} y2={h - padBottom} stroke={theme.chartGrid} strokeWidth="0.7" strokeDasharray="2,4" />

          {/* Niveles de posición si caen dentro de la ventana visual */}
          {chartData.tpY !== null && (
            <Line x1="0" y1={chartData.tpY} x2={w} y2={chartData.tpY} stroke={theme.bull} strokeWidth="1.3" strokeDasharray="5,4" />
          )}
          {chartData.buyY !== null && (
            <Line x1="0" y1={chartData.buyY} x2={w} y2={chartData.buyY} stroke={theme.textSec} strokeWidth="1.1" strokeDasharray="3,3" />
          )}
          {chartData.slY !== null && (
            <Line x1="0" y1={chartData.slY} x2={w} y2={chartData.slY} stroke={theme.bear} strokeWidth="1.3" strokeDasharray="5,4" />
          )}

          {/* Área sombreada y curva principal */}
          <Path d={chartData.dArea} fill="url(#priceAreaGrad)" />
          {showEma && (
            <Path d={chartData.dEma} fill="none" stroke={theme.accent} strokeWidth="1.5" strokeDasharray="4,3" />
          )}
          <Path d={chartData.dLine} fill="none" stroke={strokeColor} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />

          {/* Línea Crosshair si el usuario inspecciona un punto */}
          {selectedIdx !== null && (
            <Line
              x1={activePoint.x}
              y1={padTop - 6}
              x2={activePoint.x}
              y2={h - padBottom + 6}
              stroke={theme.textSec}
              strokeWidth="1"
              strokeDasharray="3,3"
            />
          )}

          {/* Punto activo con halo */}
          <Circle cx={activePoint.x} cy={activePoint.y} r="6.5" fill={strokeColor} opacity="0.22" />
          <Circle cx={activePoint.x} cy={activePoint.y} r="4" fill={strokeColor} />
          <Circle cx={activePoint.x} cy={activePoint.y} r="1.8" fill={theme.card} />
        </Svg>

        {/* Columnas táctiles invisibles para seleccionar cualquier punto de la curva */}
        <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
          {Array.from({ length: touchCols }).map((_, colIdx) => {
            const targetIdx = Math.min(
              chartData.coords.length - 1,
              Math.round((colIdx / (touchCols - 1)) * (chartData.coords.length - 1))
            );
            return (
              <TouchableOpacity
                key={colIdx}
                style={{ flex: 1, height: '100%' }}
                activeOpacity={1}
                onPress={() => onSelectIdx(targetIdx === chartData.coords.length - 1 ? null : targetIdx)}
              />
            );
          })}
        </View>
      </View>

      {/* Indicadores de niveles TP/SL cuando están fuera del zoom actual */}
      {(chartData.tpOutTop || chartData.slOutBottom) && scaleMode === 'AUTO' && (
        <View style={[styles.offScaleRow, { borderTopColor: theme.border }]}>
          {chartData.tpOutTop && takeProfit ? (
            <Text style={{ fontSize: 10, color: theme.bull, fontWeight: '700' }}>
              ▲ Objetivo TP: {fmtPrice(takeProfit)}
            </Text>
          ) : <View />}
          {chartData.slOutBottom && stopLoss ? (
            <Text style={{ fontSize: 10, color: theme.bear, fontWeight: '700' }}>
              ▼ Protección SL: {fmtPrice(stopLoss)}
            </Text>
          ) : <View />}
        </View>
      )}
    </View>
  );
}

/** Mini-gráfica auto-escalada con margen de seguridad para nunca recortarse */
function MiniSparkline({ data, isBull, theme }: { data: number[]; isBull: boolean; theme: ThemePalette }) {
  const w = 76;
  const h = 28;
  const pad = 4;
  const clean = (data || []).filter(v => typeof v === 'number' && Number.isFinite(v) && v > 0).slice(-24);
  const arr = clean.length >= 2 ? clean : [1, 1.01, 1.02];
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const span = Math.max(min * 0.0008, max - min);
  let d = '';
  arr.forEach((v, i) => {
    const x = ((i / (arr.length - 1)) * (w - pad * 2) + pad).toFixed(1);
    const y = (pad + (1 - (v - min) / span) * (h - pad * 2)).toFixed(1);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  });
  const stroke = isBull ? theme.bull : theme.bear;
  return (
    <Svg width={w} height={h}>
      <Path d={d} fill="none" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export default function TradePulseMobile() {
  const insets = useSafeAreaInsets();

  // ==================== TEMA CLARO / OSCURO ====================
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('dark');
  const t = themeMode === 'dark' ? DARK_THEME : LIGHT_THEME;

  // ==================== ESTADO DE SESIÓN Y AUTENTICACIÓN ====================
  const [user, setUser] = useState<UserSession | null>(null);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirm, setAuthConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authTouched, setAuthTouched] = useState(false);
  const [authServerError, setAuthServerError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // ==================== ESTADO DEL TERMINAL Y MERCADO EN VIVO ====================
  const [connected, setConnected] = useState(false);
  const [intervalMs, setIntervalMs] = useState(2000);
  const [cashBalance, setCashBalance] = useState(25000.0);
  const [assets, setAssets] = useState<Asset[]>(DEFAULT_ASSETS);
  const [selectedAssetId, setSelectedAssetId] = useState<string>('nvda');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'STOCK' | 'CRYPTO'>('ALL');
  const [timeframe, setTimeframe] = useState<'15M' | '1H' | '4H' | '1D'>('1D');
  const [scaleMode, setScaleMode] = useState<'AUTO' | 'FULL'>('AUTO');
  const [showEma, setShowEma] = useState(true);
  const [inspectedIdx, setInspectedIdx] = useState<number | null>(null);

  const [prices, setPrices] = useState<Record<string, number>>({
    nvda: 138.5, aapl: 228.4, tsla: 254.2, msft: 425.1, bitcoin: 95000, ethereum: 3200, solana: 185
  });
  const [history, setHistory] = useState<Record<string, number[]>>({});
  const [stats24h, setStats24h] = useState<Record<string, Stat24h>>({});
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [activeAlert, setActiveAlert] = useState<AlertEvent | null>(null);
  const [alertLog, setAlertLog] = useState<AlertEvent[]>([]);
  const [connectedClients, setConnectedClients] = useState(1);
  const [tab, setTab] = useState<0 | 1 | 2 | 3>(0);

  // ==================== ESTADO DE COMPRA DE ACCIONES ====================
  const [modalOpen, setModalOpen] = useState(false);
  const [modalCoin, setModalCoin] = useState<Asset>(DEFAULT_ASSETS[0]);
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [inputMode, setInputMode] = useState<'SHARES' | 'USD'>('SHARES');
  const [qtyInput, setQtyInput] = useState('10');
  const [usdInput, setUsdInput] = useState('1385');
  const [limitPriceInput, setLimitPriceInput] = useState('138.50');
  const [tpPct, setTpPct] = useState('5');
  const [slPct, setSlPct] = useState('3');
  const [buyOrderError, setBuyOrderError] = useState('');

  // ==================== MODAL DE EDICIÓN DE TP / SL DE POSICIÓN ABIERTA ====================
  const [editPos, setEditPos] = useState<Position | null>(null);
  const [editTpInput, setEditTpInput] = useState('');
  const [editSlInput, setEditSlInput] = useState('');
  const [editPosError, setEditPosError] = useState('');

  // ==================== MODAL DE DEPÓSITO, RETIRO Y BROKER REAL ====================
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState('10000');
  const [depositError, setDepositError] = useState('');

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('2500');
  const [withdrawError, setWithdrawError] = useState('');

  const [walletTransactions, setWalletTransactions] = useState<WalletTransaction[]>([]);
  const [brokerConfig, setBrokerConfig] = useState<BrokerConfig>({
    provider: 'ALPACA',
    environment: 'PAPER',
    apiKey: '',
    connected: false,
    accountNumber: 'TP-884920-MX',
    bankClabe: '646180157042891042'
  });
  const [brokerApiKeyInput, setBrokerApiKeyInput] = useState('');
  const [brokerApiSecretInput, setBrokerApiSecretInput] = useState('');
  const [brokerClabeInput, setBrokerClabeInput] = useState('646180157042891042');
  const [brokerStatusMsg, setBrokerStatusMsg] = useState('');

  const socketRef = useRef<Socket | null>(null);

  const hapticTap = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  };

  useEffect(() => {
    AsyncStorage.getItem('tradepulse_user')
      .then(raw => {
        if (raw) setUser(JSON.parse(raw));
      })
      .catch(() => {});
    AsyncStorage.getItem('tradepulse_theme')
      .then(saved => {
        if (saved === 'light' || saved === 'dark') setThemeMode(saved);
      })
      .catch(() => {});
  }, []);

  const toggleTheme = async () => {
    hapticTap();
    const next = themeMode === 'dark' ? 'light' : 'dark';
    setThemeMode(next);
    try {
      await AsyncStorage.setItem('tradepulse_theme', next);
    } catch (_) {}
  };

  useEffect(() => {
    const s = io(BACKEND_URL, { reconnectionDelay: 1000, transports: ['websocket', 'polling'] });
    socketRef.current = s;

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));

    s.on('state', payload => {
      if (payload.intervalMs) setIntervalMs(payload.intervalMs);
      if (typeof payload.cashBalance === 'number') setCashBalance(payload.cashBalance);
      if (payload.coins) setAssets(payload.coins);
      if (payload.prices) setPrices(payload.prices);
      if (payload.history) setHistory(payload.history);
      if (payload.stats24h) setStats24h(payload.stats24h);
      if (payload.positions) setPositions(payload.positions);
      if (payload.trades) setTrades(payload.trades);
      if (payload.walletTransactions) setWalletTransactions(payload.walletTransactions);
      if (payload.brokerConfig) setBrokerConfig(payload.brokerConfig);
      if (payload.activeAlert !== undefined) setActiveAlert(payload.activeAlert);
      if (payload.alertLog) setAlertLog(payload.alertLog);
      if (payload.connectedClients) setConnectedClients(payload.connectedClients);
    });

    s.on('alert', (al: AlertEvent) => {
      setActiveAlert(al);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }
    });

    s.on('alert:clear', () => setActiveAlert(null));

    return () => {
      s.disconnect();
    };
  }, []);

  // ==================== VALIDACIONES DE LOGIN / REGISTRO ====================
  const nameError = useMemo(() => {
    if (!isRegisterMode) return '';
    if (authName.trim().length < 3) return 'El nombre del titular requiere mínimo 3 caracteres.';
    return '';
  }, [isRegisterMode, authName]);

  const emailError = useMemo(() => {
    if (!authEmail.trim()) return 'El correo electrónico institucional o personal es obligatorio.';
    if (!EMAIL_REGEX.test(authEmail.trim())) return 'Formato de correo inválido (ejemplo@dominio.com).';
    return '';
  }, [authEmail]);

  const passwordError = useMemo(() => {
    if (!authPassword) return 'La contraseña es obligatoria.';
    if (authPassword.length < 6) return 'Mínimo 6 caracteres.';
    if (isRegisterMode && (!/[A-Za-z]/.test(authPassword) || !/[0-9]/.test(authPassword))) {
      return 'Debe incluir al menos 1 letra y 1 número.';
    }
    return '';
  }, [authPassword, isRegisterMode]);

  const confirmError = useMemo(() => {
    if (!isRegisterMode) return '';
    if (!authConfirm) return 'Confirma tu contraseña.';
    if (authConfirm !== authPassword) return 'Las contraseñas no coinciden.';
    return '';
  }, [isRegisterMode, authConfirm, authPassword]);

  const passwordStrength = useMemo(() => {
    let s = 0;
    if (authPassword.length >= 6) s++;
    if (/[A-Z]/.test(authPassword) && /[a-z]/.test(authPassword)) s++;
    if (/[0-9]/.test(authPassword)) s++;
    if (/[^A-Za-z0-9]/.test(authPassword) || authPassword.length >= 10) s++;
    return s;
  }, [authPassword]);

  const submitAuth = async () => {
    hapticTap();
    setAuthTouched(true);
    setAuthServerError('');

    if (nameError || emailError || passwordError || confirmError) return;

    setAuthLoading(true);
    try {
      const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: authName.trim(),
          email: authEmail.trim().toLowerCase(),
          password: authPassword
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthServerError(data.error || 'Error de autenticación.');
        setAuthLoading(false);
        return;
      }
      setUser(data.user);
      if (typeof data.cashBalance === 'number') setCashBalance(data.cashBalance);
      await AsyncStorage.setItem('tradepulse_user', JSON.stringify(data.user));
    } catch (_) {
      setAuthServerError('No se pudo conectar al servidor financiero. Verifica tu red local.');
    }
    setAuthLoading(false);
  };

  const fillSavedAccount = () => {
    hapticTap();
    setIsRegisterMode(false);
    setAuthEmail('ricardo@tradepulse.io');
    setAuthPassword('Trade123');
    setAuthServerError('');
    setAuthTouched(false);
  };

  const handleLogout = async () => {
    hapticTap();
    setUser(null);
    await AsyncStorage.removeItem('tradepulse_user');
  };

  // ==================== OPERACIONES DE MERCADO Y GESTIÓN DE RIESGO ====================
  const apiCall = async (endpoint: string, body: Record<string, unknown>, method: 'POST' | 'PUT' = 'POST') => {
    hapticTap();
    try {
      await fetch(`${BACKEND_URL}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (_) {}
  };

  const openBuyModal = (a: Asset) => {
    hapticTap();
    setModalCoin(a);
    const cur = prices[a.id] ?? a.seed;
    const defaultShares = a.category === 'STOCK' ? 10 : a.id === 'bitcoin' ? 0.05 : 2;
    setOrderType('MARKET');
    setInputMode('SHARES');
    setQtyInput(String(defaultShares));
    setUsdInput((cur * defaultShares).toFixed(2));
    setLimitPriceInput(cur < 1 ? cur.toFixed(4) : cur.toFixed(2));
    setTpPct('5');
    setSlPct('3');
    setBuyOrderError('');
    setModalOpen(true);
  };

  const openEditRulesModal = (p: Position) => {
    hapticTap();
    setEditPos(p);
    setEditTpInput(String(p.takeProfit));
    setEditSlInput(String(p.stopLoss));
    setEditPosError('');
  };

  const savePositionRules = async () => {
    if (!editPos) return;
    hapticTap();
    const tpNum = parseFloat(editTpInput) || 0;
    const slNum = parseFloat(editSlInput) || 0;
    const cur = editPos.price ?? editPos.buyPrice;

    if (tpNum <= cur) {
      setEditPosError(`El Take-Profit debe ser superior al precio actual de mercado (${fmtPrice(cur)}).`);
      return;
    }
    if (slNum <= 0 || slNum >= cur) {
      setEditPosError(`El Stop-Loss debe ser inferior al precio actual de mercado (${fmtPrice(cur)}).`);
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/positions/${editPos.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ takeProfit: tpNum, stopLoss: slNum })
      });
      const data = await res.json();
      if (!res.ok) {
        setEditPosError(data.error || 'No se pudieron actualizar los niveles.');
        return;
      }
      setEditPos(null);
    } catch (_) {
      setEditPosError('Error de red al guardar los niveles.');
    }
  };

  const liveModalPrice = prices[modalCoin.id] ?? modalCoin.seed;
  const executionPrice = orderType === 'MARKET' ? liveModalPrice : parseFloat(limitPriceInput) || 0;
  const computedQty =
    inputMode === 'SHARES'
      ? parseFloat(qtyInput) || 0
      : executionPrice > 0
      ? Number(((parseFloat(usdInput) || 0) / executionPrice).toFixed(4))
      : 0;
  const computedTotalCost = Number((computedQty * executionPrice).toFixed(2));
  const tpPctNum = parseFloat(tpPct) || 0;
  const slPctNum = parseFloat(slPct) || 0;
  const computedTpPrice = Number((executionPrice * (1 + tpPctNum / 100)).toFixed(4));
  const computedSlPrice = Number((executionPrice * (1 - slPctNum / 100)).toFixed(4));

  const buyValidationMessage = useMemo(() => {
    if (executionPrice <= 0) return 'El precio de ejecución debe ser mayor a $0.00.';
    if (computedQty <= 0) return 'La cantidad de acciones/unidades a comprar debe ser mayor a 0.';
    if (computedTotalCost > cashBalance) {
      const missing = (computedTotalCost - cashBalance).toFixed(2);
      return `Fondos insuficientes: la orden requiere ${fmtPrice(computedTotalCost)} y tu liquidez disponible es ${fmtPrice(cashBalance)} (faltan $${missing} USD).`;
    }
    if (tpPctNum <= 0.2 || tpPctNum > 500) {
      return 'El Take-Profit (+%) debe estar entre 0.2% y 500%.';
    }
    if (slPctNum <= 0.2 || slPctNum >= 95) {
      return 'El Stop-Loss (-%) debe estar entre 0.2% y 95%.';
    }
    return '';
  }, [executionPrice, computedQty, computedTotalCost, cashBalance, tpPctNum, slPctNum]);

  const executeBuyOrder = async () => {
    hapticTap();
    setBuyOrderError('');
    if (buyValidationMessage) {
      setBuyOrderError(buyValidationMessage);
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/api/positions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coinId: modalCoin.id,
          buyPrice: executionPrice,
          quantity: computedQty,
          takeProfit: computedTpPrice,
          stopLoss: computedSlPrice
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setBuyOrderError(data.error || 'Error al ejecutar la orden.');
        return;
      }
      setModalOpen(false);
    } catch (_) {
      setBuyOrderError('Error de conexión con el motor de órdenes.');
    }
  };

  const handleDeposit = async () => {
    hapticTap();
    const amt = parseFloat(depositAmount);
    if (!(amt >= 10 && amt <= 1000000)) {
      setDepositError('Ingresa un importe válido entre $10 y $1,000,000 USD.');
      return;
    }
    setDepositError('');
    await apiCall('/api/wallet/deposit', { amount: amt, method: 'SPEI / Transferencia Bancaria' });
    setDepositOpen(false);
  };

  const handleWithdraw = async () => {
    hapticTap();
    const amt = parseFloat(withdrawAmount);
    if (!(amt >= 10)) {
      setWithdrawError('El monto mínimo de retiro bancario es de $10.00 USD.');
      return;
    }
    if (amt > cashBalance) {
      setWithdrawError(`Liquidez insuficiente. Disponible para retiro: ${fmtPrice(cashBalance)}.`);
      return;
    }
    setWithdrawError('');
    try {
      const res = await fetch(`${BACKEND_URL}/api/wallet/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, bankTarget: `CLABE ${brokerClabeInput.slice(-4)}` })
      });
      const data = await res.json();
      if (!res.ok) {
        setWithdrawError(data.error || 'Error al procesar el retiro.');
        return;
      }
      setWithdrawOpen(false);
    } catch (_) {
      setWithdrawError('Error de red al procesar el retiro.');
    }
  };

  const saveBrokerSettings = async (provider: 'ALPACA' | 'BINANCE', environment: 'PAPER' | 'LIVE') => {
    hapticTap();
    setBrokerStatusMsg('Verificando credenciales con Alpaca Markets API v2...');
    try {
      const res = await fetch(`${BACKEND_URL}/api/broker/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          environment,
          apiKey: brokerApiKeyInput.trim(),
          apiSecret: brokerApiSecretInput.trim(),
          bankClabe: brokerClabeInput.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setBrokerStatusMsg(`❌ ${data.error || 'Llaves inválidas.'}`);
        return;
      }
      setBrokerStatusMsg(`✅ ${data.message || 'Cuenta Alpaca vinculada.'}`);
      setBrokerApiKeyInput('');
      setBrokerApiSecretInput('');
    } catch (_) {
      setBrokerStatusMsg('❌ No se pudo conectar con la pasarela de corretaje.');
    }
  };

  // ==================== PANTALLA DE AUTENTICACIÓN INSTITUCIONAL ====================
  if (!user) {
    return (
      <View
        style={[
          styles.root,
          { backgroundColor: t.bg, paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 16) }
        ]}
      >
        <StatusBar barStyle={t.mode === 'dark' ? 'light-content' : 'dark-content'} />
        <ScrollView contentContainerStyle={styles.authContainer} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.authBrand, { color: t.text }]}>TradePulse</Text>
              <View style={[styles.proBadge, { backgroundColor: t.bullSoft, borderColor: t.bullBorder }]}>
                <Text style={[styles.proBadgeText, { color: t.bull }]}>INSTITUTIONAL</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.themeBtn, { backgroundColor: t.card, borderColor: t.border }]}
              onPress={toggleTheme}
            >
              <Text style={{ fontSize: 11, fontWeight: '700', color: t.text }}>
                {t.mode === 'dark' ? '☀️ Claro' : '🌙 Oscuro'}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.authSubtitle, { color: t.textSec }]}>
            Terminal de ejecución bursátil (NYSE / NASDAQ) y criptoactivos en tiempo real con telemetría háptica sincronizada a Wear OS.
          </Text>

          <View style={[styles.authCard, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={[styles.tabsBox, { backgroundColor: t.cardSubtle, borderColor: t.border }]}>
              <TouchableOpacity
                style={[styles.tabBtn, !isRegisterMode && { backgroundColor: t.card }]}
                onPress={() => {
                  setIsRegisterMode(false);
                  setAuthTouched(false);
                  setAuthServerError('');
                }}
              >
                <Text style={[styles.tabText, { color: !isRegisterMode ? t.text : t.textSec, fontWeight: !isRegisterMode ? '700' : '500' }]}>
                  Iniciar Sesión
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, isRegisterMode && { backgroundColor: t.card }]}
                onPress={() => {
                  setIsRegisterMode(true);
                  setAuthTouched(false);
                  setAuthServerError('');
                }}
              >
                <Text style={[styles.tabText, { color: isRegisterMode ? t.text : t.textSec, fontWeight: isRegisterMode ? '700' : '500' }]}>
                  Apertura de Cuenta
                </Text>
              </TouchableOpacity>
            </View>

            {isRegisterMode && (
              <View style={{ gap: 4 }}>
                <Text style={[styles.inputLabel, { color: t.textSec }]}>Nombre del titular</Text>
                <TextInput
                  style={[
                    styles.input,
                    { backgroundColor: t.inputBg, borderColor: t.border, color: t.text },
                    authTouched && !!nameError && { borderColor: t.bear }
                  ]}
                  placeholder="Ej. Ricardo Inversionista"
                  placeholderTextColor={t.textMuted}
                  value={authName}
                  onChangeText={setAuthName}
                />
                {authTouched && !!nameError && <Text style={[styles.fieldErrorText, { color: t.bear }]}>{nameError}</Text>}
              </View>
            )}

            <View style={{ gap: 4 }}>
              <Text style={[styles.inputLabel, { color: t.textSec }]}>Correo electrónico</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: t.inputBg, borderColor: t.border, color: t.text },
                  authTouched && !!emailError && { borderColor: t.bear }
                ]}
                placeholder="inversionista@dominio.com"
                placeholderTextColor={t.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                value={authEmail}
                onChangeText={setAuthEmail}
              />
              {authTouched && !!emailError && <Text style={[styles.fieldErrorText, { color: t.bear }]}>{emailError}</Text>}
            </View>

            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[styles.inputLabel, { color: t.textSec }]}>Contraseña de acceso</Text>
                <TouchableOpacity onPress={() => setShowPassword(v => !v)}>
                  <Text style={{ fontSize: 11, color: t.bull, fontWeight: '700' }}>
                    {showPassword ? 'Ocultar' : 'Mostrar'}
                  </Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: t.inputBg, borderColor: t.border, color: t.text },
                  authTouched && !!passwordError && { borderColor: t.bear }
                ]}
                placeholder={isRegisterMode ? 'Mín. 6 caracteres, 1 letra y 1 número' : 'Contraseña'}
                placeholderTextColor={t.textMuted}
                secureTextEntry={!showPassword}
                value={authPassword}
                onChangeText={setAuthPassword}
              />
              {authTouched && !!passwordError && <Text style={[styles.fieldErrorText, { color: t.bear }]}>{passwordError}</Text>}

              {isRegisterMode && authPassword.length > 0 && (
                <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                  {[1, 2, 3, 4].map(step => (
                    <View
                      key={step}
                      style={{
                        flex: 1,
                        height: 4,
                        borderRadius: 2,
                        backgroundColor:
                          passwordStrength >= step
                            ? passwordStrength <= 1
                              ? t.bear
                              : passwordStrength <= 2
                              ? t.warn
                              : t.bull
                            : t.cardElevated
                      }}
                    />
                  ))}
                </View>
              )}
            </View>

            {isRegisterMode && (
              <View style={{ gap: 4 }}>
                <Text style={[styles.inputLabel, { color: t.textSec }]}>Confirmar contraseña</Text>
                <TextInput
                  style={[
                    styles.input,
                    { backgroundColor: t.inputBg, borderColor: t.border, color: t.text },
                    authTouched && !!confirmError && { borderColor: t.bear }
                  ]}
                  placeholder="Repite tu contraseña"
                  placeholderTextColor={t.textMuted}
                  secureTextEntry={!showPassword}
                  value={authConfirm}
                  onChangeText={setAuthConfirm}
                />
                {authTouched && !!confirmError && <Text style={[styles.fieldErrorText, { color: t.bear }]}>{confirmError}</Text>}
              </View>
            )}

            {!!authServerError && (
              <View style={[styles.serverErrorBanner, { backgroundColor: t.bearSoft, borderColor: t.bearBorder }]}>
                <Text style={{ fontSize: 12, color: t.bear, fontWeight: '600' }}>{authServerError}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.btnPrimary, { backgroundColor: t.bull, paddingVertical: 12, alignItems: 'center', marginTop: 4 }]}
              onPress={submitAuth}
            >
              <Text style={styles.btnPrimaryText}>
                {authLoading ? 'Autenticando...' : isRegisterMode ? 'Abrir Cuenta de Inversión' : 'Acceder a la Terminal'}
              </Text>
            </TouchableOpacity>

            <View style={[styles.divider, { backgroundColor: t.border }]} />

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 11, color: t.textSec }}>Credencial del titular:</Text>
              <TouchableOpacity
                style={[styles.btnOutline, { borderColor: t.border, paddingVertical: 6 }]}
                onPress={fillSavedAccount}
              >
                <Text style={{ fontSize: 11, color: t.bull, fontWeight: '700' }}>Cargar Cuenta Titular</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ==================== DATOS REACTIVOS DEL ACTIVO SELECCIONADO ====================
  const selectedAsset = assets.find(a => a.id === selectedAssetId) || assets[0];
  const selectedPrice = prices[selectedAsset.id] ?? selectedAsset.seed;
  const fullSeries = history[selectedAsset.id] || [selectedAsset.seed, selectedPrice];
  const timeframePointsCount = timeframe === '15M' ? 18 : timeframe === '1H' ? 36 : timeframe === '4H' ? 54 : 72;
  const visibleHistory = fullSeries.slice(-timeframePointsCount);

  const selectedStat = stats24h[selectedAsset.id] || {
    open: visibleHistory[0] || selectedAsset.seed,
    high: Math.max(...visibleHistory, selectedPrice),
    low: Math.min(...visibleHistory, selectedPrice),
    rsi: 52,
    ema20: selectedPrice,
    change24h: 0,
    signal: 'CONSOLIDACIÓN'
  };
  const selectedPos = positions.find(p => p.coinId === selectedAsset.id);
  const selectedIsBull = (selectedStat.change24h ?? 0) >= 0;

  // Spread institucional estimado para libro de órdenes
  const spreadBps = selectedAsset.category === 'STOCK' ? 0.0003 : 0.0005;
  const bidPrice = selectedPrice * (1 - spreadBps);
  const askPrice = selectedPrice * (1 + spreadBps);

  const filteredAssets = assets.filter(a => categoryFilter === 'ALL' || a.category === categoryFilter);

  const totalInvested = positions.reduce((s, p) => s + p.buyPrice * p.quantity, 0);
  const totalValue = positions.reduce((s, p) => s + (p.price ?? p.buyPrice) * p.quantity, 0);
  const totalPnl = totalValue - totalInvested;
  const totalPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
  const totalEquity = cashBalance + totalValue;
  const realizedPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const watchTrades = trades.filter(t => t.source === 'Reloj').length;

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: t.bg, paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 6) }
      ]}
    >
      <StatusBar barStyle={t.mode === 'dark' ? 'light-content' : 'dark-content'} />

      {/* ENCABEZADO INSTITUCIONAL CON SELECTOR DE TEMA CLARO / OSCURO */}
      <View style={[styles.header, { borderBottomColor: t.border, backgroundColor: t.card }]}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.brandTitle, { color: t.text }]}>TradePulse</Text>
            <View style={[styles.proBadge, { backgroundColor: t.bullSoft, borderColor: t.bullBorder }]}>
              <Text style={[styles.proBadgeText, { color: t.bull }]}>{user.name.split(' ')[0].toUpperCase()}</Text>
            </View>
          </View>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: connected ? t.bull : t.warn }]} />
            <Text style={[styles.statusText, { color: connected ? t.bull : t.warn }]}>
              {connected
                ? `NYSE / NASDAQ + Binance En Vivo · Sync ${intervalMs / 1000}s`
                : 'Sincronizando flujo de mercado...'}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            style={[styles.themeBtn, { backgroundColor: t.cardSubtle, borderColor: t.border }]}
            onPress={toggleTheme}
          >
            <Text style={{ fontSize: 11, fontWeight: '700', color: t.text }}>
              {t.mode === 'dark' ? '☀️ Claro' : '🌙 Oscuro'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.themeBtn, { backgroundColor: t.bearSoft, borderColor: t.bearBorder }]}
            onPress={handleLogout}
          >
            <Text style={{ fontSize: 11, color: t.bear, fontWeight: '700' }}>Salir</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* BANNER DE ALERTA ACTIVA EN EL RELOJ */}
      {activeAlert && (
        <View
          style={[
            styles.liveAlertBanner,
            {
              backgroundColor: t.card,
              borderColor: activeAlert.type === 'TAKE_PROFIT' ? t.bull : t.bear
            }
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '800',
                color: activeAlert.type === 'TAKE_PROFIT' ? t.bull : t.bear
              }}
            >
              {activeAlert.type === 'TAKE_PROFIT'
                ? `OBJETIVO ALCANZADO EN RELOJ: ${activeAlert.symbol} (TAKE-PROFIT)`
                : `PROTECCIÓN ACTIVADA EN RELOJ: ${activeAlert.symbol} (STOP-LOSS)`}
            </Text>
            <Text style={{ fontSize: 12, color: t.text, marginTop: 2, fontWeight: '600' }}>
              Cotización: {fmtPrice(activeAlert.price)} · P&L: {fmtMoney(activeAlert.pnl)} ({fmtPct(activeAlert.pnlPct)})
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.alertQuickBtn,
              { backgroundColor: activeAlert.type === 'TAKE_PROFIT' ? t.bull : t.bear }
            ]}
            onPress={() => apiCall('/api/action', { positionId: activeAlert.positionId, action: 'SELL', source: 'Móvil' })}
          >
            <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFFFFF' }}>Liquidar</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* RESUMEN DE PATRIMONIO NETO Y LIQUIDEZ (BUYING POWER) */}
        <View style={[styles.summaryCard, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={styles.summaryTop}>
            <View>
              <Text style={[styles.labelMuted, { color: t.textSec }]}>Rendimiento Abierto (No Realizado)</Text>
              <View style={styles.pnlRow}>
                <Text style={[styles.heroPnl, { color: totalPnl >= 0 ? t.bull : t.bear }]}>{fmtMoney(totalPnl)}</Text>
                <Text style={[styles.heroPct, { color: totalPnl >= 0 ? t.bull : t.bear }]}>{fmtPct(totalPct)}</Text>
              </View>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.labelMuted, { color: t.textSec }]}>Valor Neto de Cuenta</Text>
              <Text style={[styles.portfolioVal, { color: t.text }]}>{fmtPrice(totalEquity)}</Text>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: t.border }]} />

          <View style={styles.summaryMetricsRow}>
            <View>
              <Text style={[styles.metricLabel, { color: t.textSec }]}>Poder de Compra (Cash)</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <Text style={[styles.metricValue, { color: t.bull }]}>{fmtPrice(cashBalance)}</Text>
                <TouchableOpacity
                  style={[styles.depositMiniBtn, { backgroundColor: t.bullSoft, borderColor: t.bullBorder }]}
                  onPress={() => {
                    setDepositError('');
                    setDepositOpen(true);
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: '800', color: t.bull }}>+ Fondos</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View>
              <Text style={[styles.metricLabel, { color: t.textSec }]}>Capital en Activos</Text>
              <Text style={[styles.metricValue, { color: t.text }]}>{fmtPrice(totalValue)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.metricLabel, { color: t.textSec }]}>P&L Realizado</Text>
              <Text style={[styles.metricValue, { color: realizedPnl >= 0 ? t.bull : t.bear }]}>
                {fmtMoney(realizedPnl)}
              </Text>
            </View>
          </View>
        </View>

        {/* PESTAÑA 0: TERMINAL DE MERCADO Y GRÁFICA AVANZADA */}
        {tab === 0 && (
          <>
            <View style={styles.filterRow}>
              {(['ALL', 'STOCK', 'CRYPTO'] as const).map(f => {
                const active = categoryFilter === f;
                return (
                  <TouchableOpacity
                    key={f}
                    style={[
                      styles.filterPill,
                      {
                        backgroundColor: active ? t.bullSoft : t.card,
                        borderColor: active ? t.bull : t.border
                      }
                    ]}
                    onPress={() => setCategoryFilter(f)}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        color: active ? t.bull : t.textSec,
                        fontWeight: active ? '800' : '600'
                      }}
                    >
                      {f === 'ALL' ? 'Todos los Mercados (7)' : f === 'STOCK' ? 'NYSE / NASDAQ (4)' : 'Spot Cripto (3)'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Cinta de Cotizaciones en Tiempo Real */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tickerStrip}>
              {filteredAssets.map(a => {
                const p = prices[a.id] ?? a.seed;
                const chg = stats24h[a.id]?.change24h ?? 0;
                const active = a.id === selectedAsset.id;
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[
                      styles.tickerPill,
                      {
                        backgroundColor: active ? t.bullSoft : t.card,
                        borderColor: active ? t.bull : t.border
                      }
                    ]}
                    onPress={() => {
                      hapticTap();
                      setSelectedAssetId(a.id);
                      setInspectedIdx(null);
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <Text style={[styles.tickerSym, { color: t.text }]}>{a.symbol}</Text>
                      <Text
                        style={[
                          styles.catMiniTag,
                          { backgroundColor: t.cardSubtle, color: t.textMuted }
                        ]}
                      >
                        {a.exchange || (a.category === 'STOCK' ? 'NASDAQ' : 'SPOT')}
                      </Text>
                    </View>
                    <Text style={[styles.tickerVal, { color: t.text }]}>{fmtPrice(p)}</Text>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: chg >= 0 ? t.bull : t.bear }}>
                      {fmtPct(chg)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Tarjeta Principal de Gráfica Institucional */}
            <View style={[styles.chartCard, { backgroundColor: t.card, borderColor: t.border }]}>
              <View style={styles.chartHeader}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[styles.chartSym, { color: t.text }]}>{selectedAsset.symbol}</Text>
                    <Text style={[styles.chartName, { color: t.textSec }]}>{selectedAsset.name}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                    <Text style={[styles.chartPrice, { color: t.text }]}>{fmtPrice(selectedPrice)}</Text>
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: '800',
                        color: selectedIsBull ? t.bull : t.bear
                      }}
                    >
                      {fmtPct(selectedStat.change24h ?? 0)}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.btnPrimary, { backgroundColor: t.bull }]}
                  onPress={() => openBuyModal(selectedAsset)}
                >
                  <Text style={styles.btnPrimaryText}>Comprar {selectedAsset.symbol}</Text>
                </TouchableOpacity>
              </View>

              {/* Controles de Ventana Temporal, Escala Automática y Media Móvil EMA */}
              <View style={styles.chartControlsRow}>
                <View style={[styles.timeframeGroup, { backgroundColor: t.cardSubtle, borderColor: t.border }]}>
                  {(['15M', '1H', '4H', '1D'] as const).map(tf => {
                    const active = timeframe === tf;
                    return (
                      <TouchableOpacity
                        key={tf}
                        style={[styles.tfBtn, active && { backgroundColor: t.card }]}
                        onPress={() => {
                          hapticTap();
                          setTimeframe(tf);
                          setInspectedIdx(null);
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 10,
                            fontWeight: active ? '800' : '600',
                            color: active ? t.text : t.textMuted
                          }}
                        >
                          {tf}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity
                    style={[
                      styles.chartOptionBtn,
                      {
                        backgroundColor: showEma ? t.accentSoft : t.cardSubtle,
                        borderColor: showEma ? t.accent : t.border
                      }
                    ]}
                    onPress={() => setShowEma(v => !v)}
                  >
                    <Text style={{ fontSize: 10, fontWeight: '700', color: showEma ? t.accent : t.textSec }}>
                      EMA-12
                    </Text>
                  </TouchableOpacity>

                  {selectedPos && (
                    <TouchableOpacity
                      style={[
                        styles.chartOptionBtn,
                        {
                          backgroundColor: scaleMode === 'FULL' ? t.bullSoft : t.cardSubtle,
                          borderColor: scaleMode === 'FULL' ? t.bull : t.border
                        }
                      ]}
                      onPress={() => setScaleMode(m => (m === 'AUTO' ? 'FULL' : 'AUTO'))}
                    >
                      <Text style={{ fontSize: 10, fontWeight: '700', color: scaleMode === 'FULL' ? t.bull : t.textSec }}>
                        {scaleMode === 'AUTO' ? 'Escala: Precio' : 'Escala: TP/SL'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {selectedPos && (
                <View style={[styles.chartLegendRow, { backgroundColor: t.cardSubtle }]}>
                  <Text style={{ fontSize: 10, color: t.bull, fontWeight: '700' }}>
                    TP: {fmtPrice(selectedPos.takeProfit)}
                  </Text>
                  <Text style={{ fontSize: 10, color: t.textSec, fontWeight: '600' }}>
                    Entrada: {fmtPrice(selectedPos.buyPrice)} ({selectedPos.quantity} u.)
                  </Text>
                  <Text style={{ fontSize: 10, color: t.bear, fontWeight: '700' }}>
                    SL: {fmtPrice(selectedPos.stopLoss)}
                  </Text>
                </View>
              )}

              <InstitutionalPriceChart
                points={visibleHistory}
                takeProfit={selectedPos?.takeProfit}
                stopLoss={selectedPos?.stopLoss}
                buyPrice={selectedPos?.buyPrice}
                theme={t}
                scaleMode={scaleMode}
                showEma={showEma}
                selectedIdx={inspectedIdx}
                onSelectIdx={setInspectedIdx}
              />

              {/* Microestructura y Diagnóstico Cuantitativo */}
              <View style={[styles.techGrid, { backgroundColor: t.cardSubtle, borderColor: t.border }]}>
                <View style={styles.techCell}>
                  <Text style={[styles.techLabel, { color: t.textMuted }]}>Postura Bid / Ask</Text>
                  <Text style={[styles.techVal, { color: t.text }]}>
                    {fmtPrice(bidPrice)} / {fmtPrice(askPrice)}
                  </Text>
                </View>
                <View style={styles.techCell}>
                  <Text style={[styles.techLabel, { color: t.textMuted }]}>Rango Sesión (L / H)</Text>
                  <Text style={[styles.techVal, { color: t.text }]}>
                    {fmtPrice(selectedStat.low)} – {fmtPrice(selectedStat.high)}
                  </Text>
                </View>
              </View>

              <View style={[styles.techGrid, { backgroundColor: t.cardSubtle, borderColor: t.border }]}>
                <View style={{ flex: 0.6 }}>
                  <Text style={[styles.techLabel, { color: t.textMuted }]}>RSI (14)</Text>
                  <Text
                    style={[
                      styles.techVal,
                      {
                        color:
                          selectedStat.rsi >= 70
                            ? t.bear
                            : selectedStat.rsi <= 32
                            ? t.bull
                            : t.text
                      }
                    ]}
                  >
                    {selectedStat.rsi}
                  </Text>
                </View>
                <View style={{ flex: 0.8 }}>
                  <Text style={[styles.techLabel, { color: t.textMuted }]}>Media EMA (20)</Text>
                  <Text style={[styles.techVal, { color: t.accent }]}>
                    {fmtPrice(selectedStat.ema20 || selectedPrice)}
                  </Text>
                </View>
                <View style={{ flex: 1.4 }}>
                  <Text style={[styles.techLabel, { color: t.textMuted }]}>Diagnóstico Algorítmico</Text>
                  <Text
                    style={[
                      styles.techVal,
                      {
                        color:
                          selectedStat.signal.includes('ALCISTA') || selectedStat.signal.includes('ACUMULACIÓN')
                            ? t.bull
                            : selectedStat.signal.includes('BAJISTA') || selectedStat.signal.includes('UTILIDAD')
                            ? t.warn
                            : t.textSec
                      }
                    ]}
                    numberOfLines={1}
                  >
                    {selectedStat.signal}
                  </Text>
                </View>
              </View>
            </View>
          </>
        )}

        {/* PESTAÑA 1: BILLETERA PATRIMONIAL, DISTRIBUCIÓN DE ACTIVOS Y BROKER DE DINERO REAL */}
        {tab === 1 && (
          <View style={{ gap: 12 }}>
            {/* Tarjeta de Billetera y Transferencias Bancarias */}
            <View style={[styles.posCard, { backgroundColor: t.card, borderColor: t.border }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text style={[styles.sectionHeader, { color: t.text }]}>Billetera & Custodia Fiat (USD / MXN)</Text>
                  <Text style={{ fontSize: 11, color: t.textSec, marginTop: 2 }}>
                    Cuenta #{brokerConfig.accountNumber} · CLABE {brokerConfig.bankClabe}
                  </Text>
                </View>
                <View style={[styles.proBadge, { backgroundColor: t.bullSoft, borderColor: t.bullBorder }]}>
                  <Text style={[styles.proBadgeText, { color: t.bull }]}>
                    {brokerConfig.connected ? `${brokerConfig.provider} ACTIVO` : 'CUSTODIA LOCAL'}
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <TouchableOpacity
                  style={[styles.btnPrimary, { flex: 1, alignItems: 'center', backgroundColor: t.bull, paddingVertical: 10 }]}
                  onPress={() => {
                    setDepositError('');
                    setDepositOpen(true);
                  }}
                >
                  <Text style={styles.btnPrimaryText}>+ Depositar (SPEI / Tarjeta)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.btnOutline,
                    { flex: 1, alignItems: 'center', borderColor: t.border, backgroundColor: t.cardSubtle, paddingVertical: 10 }
                  ]}
                  onPress={() => {
                    setWithdrawError('');
                    setWithdrawOpen(true);
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '800', color: t.text }}>↑ Retirar a Banco</Text>
                </TouchableOpacity>
              </View>

              {/* Barra visual de distribución patrimonial */}
              {(() => {
                const stockVal = positions
                  .filter(p => (p.category || 'STOCK') === 'STOCK')
                  .reduce((s, p) => s + (p.price ?? p.buyPrice) * p.quantity, 0);
                const cryptoVal = positions
                  .filter(p => p.category === 'CRYPTO')
                  .reduce((s, p) => s + (p.price ?? p.buyPrice) * p.quantity, 0);
                const eq = Math.max(1, cashBalance + stockVal + cryptoVal);
                const cashPct = Math.round((cashBalance / eq) * 100);
                const stockPct = Math.round((stockVal / eq) * 100);
                const cryptoPct = Math.max(0, 100 - cashPct - stockPct);

                return (
                  <View style={{ gap: 6, marginTop: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: t.textSec }}>
                      Distribución Patrimonial ({fmtPrice(totalEquity)})
                    </Text>
                    <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: t.cardSubtle }}>
                      <View style={{ flex: Math.max(1, cashPct), backgroundColor: t.bull }} />
                      {stockPct > 0 && <View style={{ flex: stockPct, backgroundColor: t.accent }} />}
                      {cryptoPct > 0 && <View style={{ flex: cryptoPct, backgroundColor: t.warn }} />}
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 10, color: t.bull, fontWeight: '700' }}>
                        ● Efectivo: {cashPct}% ({fmtPrice(cashBalance)})
                      </Text>
                      <Text style={{ fontSize: 10, color: t.accent, fontWeight: '700' }}>
                        ● Bolsa: {stockPct}% ({fmtPrice(stockVal)})
                      </Text>
                      <Text style={{ fontSize: 10, color: t.warn, fontWeight: '700' }}>
                        ● Cripto: {cryptoPct}%
                      </Text>
                    </View>
                  </View>
                );
              })()}
            </View>
          </View>
        )}

        {/* POSICIONES EN CARTERA CON BARRA DE RANGO AUTO-ADAPTATIVA Y EDICIÓN DE TP/SL */}
        {(tab === 0 || tab === 1) && (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[styles.sectionHeader, { color: t.text }]}>
                Posiciones Abiertas en Cartera ({positions.length})
              </Text>
              <Text style={{ fontSize: 11, color: t.textSec, fontWeight: '600' }}>
                Monitoreo activo en Wear OS
              </Text>
            </View>

            {positions.length === 0 ? (
              <View style={[styles.posCard, { backgroundColor: t.card, borderColor: t.border }]}>
                <Text style={[styles.emptyTitle, { color: t.text }]}>Sin posiciones abiertas</Text>
                <Text style={[styles.emptyBody, { color: t.textSec }]}>
                  Selecciona cualquier activo del mercado y pulsa Comprar para abrir una posición con reglas de salida sincronizadas a tu reloj.
                </Text>
              </View>
            ) : (
              positions.map(p => {
                const now = p.price ?? p.buyPrice;
                const pnl = p.pnl ?? (now - p.buyPrice) * p.quantity;
                const pct = p.pnlPct ?? ((now - p.buyPrice) / p.buyPrice) * 100;

                // Rango dinámico que se expande si el precio cae por debajo del Stop-Loss o supera el Take-Profit
                const domainMin = Math.min(p.stopLoss, now, p.buyPrice) * 0.996;
                const domainMax = Math.max(p.takeProfit, now, p.buyPrice) * 1.004;
                const domainSpan = Math.max(0.0001, domainMax - domainMin);

                const toPct = (val: number) => Math.min(98, Math.max(2, ((val - domainMin) / domainSpan) * 100));
                const curPosPct = toPct(now);
                const buyPosPct = toPct(p.buyPrice);
                const slPosPct = toPct(p.stopLoss);
                const tpPosPct = toPct(p.takeProfit);

                const left = Math.min(buyPosPct, curPosPct);
                const width = Math.max(2, Math.abs(curPosPct - buyPosPct));
                const isBull = now >= p.buyPrice;
                const color = isBull ? t.bull : t.bear;
                const tpHit = now >= p.takeProfit;
                const slHit = now <= p.stopLoss;

                return (
                  <TouchableOpacity
                    key={p.id}
                    activeOpacity={0.92}
                    onPress={() => {
                      setSelectedAssetId(p.coinId);
                      setInspectedIdx(null);
                      if (tab !== 0) setTab(0);
                    }}
                    style={[
                      styles.posCard,
                      { backgroundColor: t.card, borderColor: t.border },
                      tpHit && { borderColor: t.bull, borderWidth: 1.5 },
                      slHit && { borderColor: t.bear, borderWidth: 1.5 }
                    ]}
                  >
                    <View style={styles.posHead}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[styles.posSym, { color: t.text }]}>{p.symbol}</Text>
                          <Text style={[styles.catMiniTag, { backgroundColor: t.cardSubtle, color: t.textMuted }]}>
                            {p.exchange || p.category || 'NASDAQ'}
                          </Text>
                          <Text style={[styles.posMeta, { color: t.textSec }]}>
                            {p.quantity} u. @ {fmtPrice(p.buyPrice)}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 11, color: t.textSec, marginTop: 2 }}>
                          Valor Mercado: {fmtPrice(now * p.quantity)} · RSI {p.rsi ?? 50}
                        </Text>
                      </View>

                      <MiniSparkline data={p.sparkline || history[p.coinId] || []} isBull={isBull} theme={t} />

                      <View style={{ alignItems: 'flex-end', minWidth: 94 }}>
                        <Text style={[styles.posPrice, { color: t.text }]}>{fmtPrice(now)}</Text>
                        <Text style={[styles.posPnl, { color: pnl >= 0 ? t.bull : t.bear }]}>
                          {fmtMoney(pnl)} ({fmtPct(pct)})
                        </Text>
                      </View>
                    </View>

                    {/* Barra de Rango Operativo sin desbordamiento */}
                    <View style={{ gap: 4 }}>
                      <View style={styles.gaugeLabels}>
                        <Text style={[styles.gaugeLbl, { color: t.bear }]}>SL {fmtPrice(p.stopLoss)}</Text>
                        <Text style={[styles.gaugeLbl, { color: t.textSec }]}>Compra {fmtPrice(p.buyPrice)}</Text>
                        <Text style={[styles.gaugeLbl, { color: t.bull }]}>TP {fmtPrice(p.takeProfit)}</Text>
                      </View>
                      <View style={[styles.gaugeTrack, { backgroundColor: t.cardSubtle }]}>
                        <View
                          style={[
                            styles.gaugeFill,
                            { left: `${left}%`, width: `${width}%`, backgroundColor: color, opacity: 0.5 }
                          ]}
                        />
                        {/* Marcadores de SL, Compra y TP */}
                        <View style={[styles.gaugeMarker, { left: `${slPosPct}%`, backgroundColor: t.bear }]} />
                        <View style={[styles.gaugeEntry, { left: `${buyPosPct}%`, backgroundColor: t.textSec }]} />
                        <View style={[styles.gaugeMarker, { left: `${tpPosPct}%`, backgroundColor: t.bull }]} />
                        {/* Punto actual */}
                        <View style={[styles.gaugeDot, { left: `${curPosPct}%`, backgroundColor: color }]} />
                      </View>
                    </View>

                    {/* Acciones Profesionales de Gestión de Posición */}
                    <View style={styles.posActions}>
                      <TouchableOpacity
                        style={[styles.btnManageRule, { backgroundColor: t.cardSubtle, borderColor: t.border }]}
                        onPress={() => openEditRulesModal(p)}
                      >
                        <Text style={{ fontSize: 11, fontWeight: '700', color: t.accent }}>
                          Ajustar TP / SL
                        </Text>
                      </TouchableOpacity>

                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <TouchableOpacity
                          style={[styles.btnPartial, { backgroundColor: t.cardSubtle, borderColor: t.border }]}
                          onPress={() =>
                            apiCall('/api/action', { positionId: p.id, action: 'SELL', source: 'Móvil', ratio: 0.5 })
                          }
                        >
                          <Text style={{ fontSize: 11, fontWeight: '600', color: t.text }}>Vender 50%</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.btnClosePos, { borderColor: t.bearBorder, backgroundColor: t.bearSoft }]}
                          onPress={() =>
                            apiCall('/api/action', { positionId: p.id, action: 'SELL', source: 'Móvil', ratio: 1.0 })
                          }
                        >
                          <Text style={{ fontSize: 11, fontWeight: '700', color: t.bear }}>Liquidar 100%</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}

        {/* SECCIÓN DE BROKER DE DINERO REAL Y MOVIMIENTOS DE BILLETERA EN PESTAÑA CARTERA */}
        {tab === 1 && (
          <View style={{ gap: 12 }}>
            {/* Motor Integrado Seleccionado: Alpaca Markets v2 (NYSE/NASDAQ + Crypto) + Riel SPEI */}
            <View style={[styles.posCard, { backgroundColor: t.card, borderColor: t.border }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[styles.sectionHeader, { color: t.text }]}>
                  Motor Integrado: Alpaca Markets v2 + SPEI
                </Text>
                <View style={[styles.proBadge, { backgroundColor: t.bullSoft, borderColor: t.bullBorder }]}>
                  <Text style={[styles.proBadgeText, { color: t.bull }]}>SEC / FINRA + STP</Text>
                </View>
              </View>
              <Text style={[styles.emptyBody, { color: t.textSec }]}>
                Arquitectura unificada seleccionada: Alpaca Markets API v2 ejecuta tanto acciones fraccionadas de EE. UU. (NYSE/NASDAQ) como Cripto Spot (BTC/ETH/SOL) bajo una misma cuenta en USD, mientras el riel SPEI/STP liquida depósitos y retiros hacia tu CLABE bancaria.
              </Text>

              <View style={[styles.tabsBox, { backgroundColor: t.cardSubtle, borderColor: t.border }]}>
                {(['PAPER', 'LIVE'] as const).map(env => {
                  const active = brokerConfig.environment === env;
                  return (
                    <TouchableOpacity
                      key={env}
                      style={[styles.tabBtn, active && { backgroundColor: t.card }]}
                      onPress={() => setBrokerConfig(prev => ({ ...prev, environment: env }))}
                    >
                      <Text
                        style={{
                          fontSize: 10,
                          fontWeight: active ? '800' : '600',
                          color: active ? (env === 'LIVE' ? t.bull : t.warn) : t.textSec
                        }}
                      >
                        {env === 'LIVE' ? '● Producción Dinero Real (api.alpaca.markets)' : '● Custodia / Sandbox (paper-api.alpaca.markets)'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={{ gap: 4 }}>
                <Text style={[styles.inputLabel, { color: t.textSec }]}>
                  APCA-API-KEY-ID ({brokerConfig.apiKey || 'Custodia Local Activa'})
                </Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }]}
                  placeholder="PKXX... (Paper) o AKXX... (Live Dinero Real)"
                  placeholderTextColor={t.textMuted}
                  autoCapitalize="none"
                  value={brokerApiKeyInput}
                  onChangeText={setBrokerApiKeyInput}
                />
              </View>

              <View style={{ gap: 4 }}>
                <Text style={[styles.inputLabel, { color: t.textSec }]}>APCA-API-SECRET-KEY</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }]}
                  placeholder="Secret Key de Alpaca Markets"
                  placeholderTextColor={t.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  value={brokerApiSecretInput}
                  onChangeText={setBrokerApiSecretInput}
                />
              </View>

              <View style={{ gap: 4 }}>
                <Text style={[styles.inputLabel, { color: t.textSec }]}>CLABE Interbancaria STP / SPEI (18 dígitos)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }]}
                  keyboardType="number-pad"
                  maxLength={18}
                  value={brokerClabeInput}
                  onChangeText={setBrokerClabeInput}
                />
              </View>

              {!!brokerStatusMsg && (
                <Text style={{ fontSize: 11, color: t.bull, fontWeight: '700' }}>{brokerStatusMsg}</Text>
              )}

              <TouchableOpacity
                style={[styles.btnPrimary, { backgroundColor: t.bull, alignItems: 'center', paddingVertical: 10 }]}
                onPress={() => saveBrokerSettings('ALPACA', brokerConfig.environment)}
              >
                <Text style={styles.btnPrimaryText}>Sincronizar Cuenta Alpaca Markets + CLABE</Text>
              </TouchableOpacity>
            </View>

            {/* Libro Contable de Movimientos de Billetera */}
            <Text style={[styles.sectionHeader, { color: t.text }]}>
              Movimientos de Billetera y Liquidaciones ({walletTransactions.length})
            </Text>
            {walletTransactions.map(tx => (
              <View
                key={tx.id}
                style={[
                  styles.posCard,
                  {
                    backgroundColor: t.card,
                    borderColor: t.border,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: t.text }}>{tx.method}</Text>
                  <Text style={{ fontSize: 10, color: t.textSec, marginTop: 2 }}>
                    {tx.reference} · {tx.timestamp}
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '800',
                    color: tx.amount >= 0 ? t.bull : t.bear,
                    fontVariant: ['tabular-nums']
                  }}
                >
                  {fmtMoney(tx.amount)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* PESTAÑA 2: TELEMETRÍA Y SINCRONIZACIÓN CON SMARTWATCH WEAR OS */}
        {tab === 2 && (
          <View style={{ gap: 12 }}>
            <View style={[styles.posCard, { backgroundColor: t.card, borderColor: t.border }]}>
              <Text style={[styles.sectionHeader, { color: t.text }]}>
                Enlace de Telemetría con Smartwatch Wear OS
              </Text>
              <Text style={[styles.emptyBody, { color: t.textSec }]}>
                El servidor evalúa las cotizaciones de NYSE/NASDAQ y Binance cada 2 segundos contra tus niveles de Take-Profit y Stop-Loss. Cuando ocurre un cruce, envía una alerta inmediata por WebSocket a tu reloj para ejecutar el cierre en 1 toque.
              </Text>
              <View style={styles.summaryMetricsRow}>
                <View>
                  <Text style={[styles.metricLabel, { color: t.textSec }]}>Nodos Conectados</Text>
                  <Text style={[styles.metricValue, { color: t.bull }]}>{connectedClients} dispositivos</Text>
                </View>
                <View>
                  <Text style={[styles.metricLabel, { color: t.textSec }]}>Latencia de Flujo</Text>
                  <Text style={[styles.metricValue, { color: t.text }]}>{intervalMs / 1000}s (Tiempo Real)</Text>
                </View>
                <View>
                  <Text style={[styles.metricLabel, { color: t.textSec }]}>Cierres desde Reloj</Text>
                  <Text style={[styles.metricValue, { color: t.text }]}>{watchTrades} órdenes</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                <TouchableOpacity
                  style={[styles.btnPrimary, { flex: 1, alignItems: 'center', backgroundColor: t.bull }]}
                  onPress={() => apiCall('/api/test-watch-alert', { type: 'TAKE_PROFIT' })}
                >
                  <Text style={styles.btnPrimaryText}>Verificar Vibración TP en Reloj</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.btnClosePos,
                    { flex: 1, alignItems: 'center', justifyContent: 'center', borderColor: t.bearBorder, backgroundColor: t.bearSoft }
                  ]}
                  onPress={() => apiCall('/api/test-watch-alert', { type: 'STOP_LOSS' })}
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: t.bear }}>Verificar Vibración SL</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={[styles.sectionHeader, { color: t.text }]}>
              Registro de Eventos de Alerta ({alertLog.length})
            </Text>
            {alertLog.length === 0 ? (
              <View style={[styles.posCard, { backgroundColor: t.card, borderColor: t.border }]}>
                <Text style={[styles.emptyBody, { color: t.textSec }]}>
                  No se han disparado alertas en la sesión actual.
                </Text>
              </View>
            ) : (
              alertLog.map((al, i) => (
                <View key={i} style={[styles.posCard, { backgroundColor: t.card, borderColor: t.border }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: '800',
                        color: al.type === 'TAKE_PROFIT' ? t.bull : t.bear
                      }}
                    >
                      {al.symbol} · {al.type === 'TAKE_PROFIT' ? 'TAKE-PROFIT' : 'STOP-LOSS'}
                    </Text>
                    <Text style={{ fontSize: 11, color: t.textSec }}>{al.timeStr || 'Reciente'}</Text>
                  </View>
                  <Text style={{ fontSize: 13, color: t.text, fontWeight: '600' }}>
                    Precio de cruce: {fmtPrice(al.price)} · P&L: {fmtMoney(al.pnl)} ({fmtPct(al.pnlPct)})
                  </Text>
                </View>
              ))
            )}
          </View>
        )}

        {/* PESTAÑA 3: HISTORIAL DE EJECUCIONES Y AUDITORÍA */}
        {tab === 3 && (
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionHeader, { color: t.text }]}>
              Historial de Órdenes Liquidadas ({trades.length})
            </Text>
            {trades.length === 0 ? (
              <View style={[styles.posCard, { backgroundColor: t.card, borderColor: t.border }]}>
                <Text style={[styles.emptyTitle, { color: t.text }]}>Sin liquidaciones registradas</Text>
                <Text style={[styles.emptyBody, { color: t.textSec }]}>
                  Las ventas parciales o totales ejecutadas desde el Smartwatch Wear OS o desde la terminal móvil quedarán asentadas aquí con su rendimiento neto.
                </Text>
              </View>
            ) : (
              trades.map(tItem => (
                <View
                  key={tItem.id}
                  style={[
                    styles.posCard,
                    {
                      backgroundColor: t.card,
                      borderColor: t.border,
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }
                  ]}
                >
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[styles.posSym, { color: t.text }]}>{tItem.symbol}</Text>
                      <View style={[styles.sourceBadge, { backgroundColor: t.cardSubtle, borderColor: t.border }]}>
                        <Text
                          style={{
                            fontSize: 10,
                            fontWeight: '700',
                            color: tItem.source === 'Reloj' ? t.bull : t.textSec
                          }}
                        >
                          Vía {tItem.source}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.posMeta, { color: t.textSec, marginTop: 3 }]}>
                      {tItem.quantity} u. · {fmtPrice(tItem.buyPrice)} → {fmtPrice(tItem.sellPrice)} · {tItem.closedAt}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.posPrice,
                      { color: tItem.pnl >= 0 ? t.bull : t.bear, fontWeight: '800' }
                    ]}
                  >
                    {fmtMoney(tItem.pnl)}
                  </Text>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* BARRA INFERIOR DE NAVEGACIÓN */}
      <View style={[styles.bottomBar, { backgroundColor: t.card, borderTopColor: t.border }]}>
        <View style={[styles.tabsBox, { flex: 1, backgroundColor: t.cardSubtle, borderColor: t.border }]}>
          {(
            [
              [0, 'Mercado'],
              [1, `Cartera (${positions.length})`],
              [2, 'Wear OS'],
              [3, `Auditoría (${trades.length})`]
            ] as const
          ).map(([idx, label]) => {
            const active = tab === idx;
            return (
              <TouchableOpacity
                key={idx}
                style={[styles.tabBtn, active && { backgroundColor: t.card }]}
                onPress={() => {
                  hapticTap();
                  setTab(idx);
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    color: active ? t.text : t.textSec,
                    fontWeight: active ? '800' : '500'
                  }}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          style={[styles.btnPrimary, { backgroundColor: t.bull }]}
          onPress={() => openBuyModal(selectedAsset)}
        >
          <Text style={styles.btnPrimaryText}>Nueva Orden</Text>
        </TouchableOpacity>
      </View>

      {/* ==================== MODAL DE COMPRA DE ACCIONES CON VALIDACIONES ==================== */}
      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={[styles.modalBackdrop, { backgroundColor: t.backdrop }]}>
          <View style={[styles.modalCard, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[styles.modalTitle, { color: t.text }]}>Boleta de Compra</Text>
              <Text style={{ fontSize: 11, color: t.bull, fontWeight: '700' }}>
                Liquidez: {fmtPrice(cashBalance)}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {assets.map(a => {
                const selected = a.id === modalCoin.id;
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[
                      styles.coinChip,
                      {
                        backgroundColor: selected ? t.bullSoft : t.cardSubtle,
                        borderColor: selected ? t.bull : t.border
                      }
                    ]}
                    onPress={() => {
                      setModalCoin(a);
                      const cur = prices[a.id] ?? a.seed;
                      setLimitPriceInput(cur < 1 ? cur.toFixed(4) : cur.toFixed(2));
                      setBuyOrderError('');
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '700', color: selected ? t.bull : t.textSec }}>
                      {a.symbol}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={[styles.tabsBox, { backgroundColor: t.cardSubtle, borderColor: t.border }]}>
              <TouchableOpacity
                style={[styles.tabBtn, orderType === 'MARKET' && { backgroundColor: t.card }]}
                onPress={() => setOrderType('MARKET')}
              >
                <Text style={{ fontSize: 10, color: orderType === 'MARKET' ? t.text : t.textSec, fontWeight: '700' }}>
                  A Mercado ({fmtPrice(liveModalPrice)})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, orderType === 'LIMIT' && { backgroundColor: t.card }]}
                onPress={() => setOrderType('LIMIT')}
              >
                <Text style={{ fontSize: 10, color: orderType === 'LIMIT' ? t.text : t.textSec, fontWeight: '700' }}>
                  Precio Límite
                </Text>
              </TouchableOpacity>
            </View>

            {orderType === 'LIMIT' && (
              <View>
                <Text style={[styles.inputLabel, { color: t.textSec }]}>Precio límite de ejecución (USD)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }]}
                  keyboardType="decimal-pad"
                  value={limitPriceInput}
                  onChangeText={setLimitPriceInput}
                />
              </View>
            )}

            <View style={[styles.tabsBox, { backgroundColor: t.cardSubtle, borderColor: t.border }]}>
              <TouchableOpacity
                style={[styles.tabBtn, inputMode === 'SHARES' && { backgroundColor: t.card }]}
                onPress={() => setInputMode('SHARES')}
              >
                <Text style={{ fontSize: 10, color: inputMode === 'SHARES' ? t.text : t.textSec, fontWeight: '700' }}>
                  Por N.º de Unidades
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, inputMode === 'USD' && { backgroundColor: t.card }]}
                onPress={() => setInputMode('USD')}
              >
                <Text style={{ fontSize: 10, color: inputMode === 'USD' ? t.text : t.textSec, fontWeight: '700' }}>
                  Por Monto en USD
                </Text>
              </TouchableOpacity>
            </View>

            {inputMode === 'SHARES' ? (
              <View>
                <Text style={[styles.inputLabel, { color: t.textSec }]}>Unidades / Acciones ({modalCoin.symbol})</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }]}
                  keyboardType="decimal-pad"
                  value={qtyInput}
                  onChangeText={setQtyInput}
                />
              </View>
            ) : (
              <View>
                <Text style={[styles.inputLabel, { color: t.textSec }]}>Importe total a invertir (USD)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }]}
                  keyboardType="decimal-pad"
                  value={usdInput}
                  onChangeText={setUsdInput}
                />
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.inputLabel, { color: t.textSec }]}>Take-Profit (+%)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }]}
                  keyboardType="decimal-pad"
                  value={tpPct}
                  onChangeText={setTpPct}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.inputLabel, { color: t.textSec }]}>Stop-Loss (-%)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }]}
                  keyboardType="decimal-pad"
                  value={slPct}
                  onChangeText={setSlPct}
                />
              </View>
            </View>

            <View style={[styles.previewBox, { backgroundColor: t.cardSubtle, borderColor: t.border }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 11, color: t.textSec }}>Asignación estimada:</Text>
                <Text style={{ fontSize: 11, color: t.text, fontWeight: '700' }}>
                  {computedQty} {modalCoin.symbol} @ {fmtPrice(executionPrice)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 11, color: t.textSec }}>Valor total de la orden:</Text>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '800',
                    color: computedTotalCost > cashBalance ? t.bear : t.text
                  }}
                >
                  {fmtPrice(computedTotalCost)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                <Text style={{ fontSize: 11, color: t.bull, fontWeight: '600' }}>
                  TP Reloj: {fmtPrice(computedTpPrice)}
                </Text>
                <Text style={{ fontSize: 11, color: t.bear, fontWeight: '600' }}>
                  SL Reloj: {fmtPrice(computedSlPrice)}
                </Text>
              </View>
            </View>

            {!!(buyValidationMessage || buyOrderError) && (
              <View style={[styles.serverErrorBanner, { backgroundColor: t.bearSoft, borderColor: t.bearBorder }]}>
                <Text style={{ fontSize: 11, color: t.bear, fontWeight: '600' }}>
                  {buyOrderError || buyValidationMessage}
                </Text>
                {computedTotalCost > cashBalance && (
                  <TouchableOpacity
                    style={{ marginTop: 6 }}
                    onPress={() => apiCall('/api/wallet/deposit', { amount: 10000 })}
                  >
                    <Text style={{ fontSize: 11, color: t.bull, fontWeight: '800' }}>
                      + Transferir $10,000 USD a Poder de Compra
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <TouchableOpacity
                style={[styles.btnOutline, { borderColor: t.border }]}
                onPress={() => setModalOpen(false)}
              >
                <Text style={[styles.btnOutlineText, { color: t.text }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimary, { backgroundColor: t.bull }, !!buyValidationMessage && { opacity: 0.45 }]}
                onPress={executeBuyOrder}
              >
                <Text style={styles.btnPrimaryText}>Ejecutar Compra ({fmtPrice(computedTotalCost)})</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL DE EDICIÓN DE TP / SL DE POSICIÓN ABIERTA ==================== */}
      <Modal visible={!!editPos} transparent animationType="fade" onRequestClose={() => setEditPos(null)}>
        <View style={[styles.modalBackdrop, { backgroundColor: t.backdrop }]}>
          <View style={[styles.modalCard, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[styles.modalTitle, { color: t.text }]}>
              Ajustar Parámetros de Riesgo ({editPos?.symbol})
            </Text>
            {editPos && (
              <Text style={{ fontSize: 11, color: t.textSec }}>
                Entrada: {fmtPrice(editPos.buyPrice)} · Cotización actual: {fmtPrice(editPos.price ?? editPos.buyPrice)}
              </Text>
            )}

            <View style={{ gap: 4 }}>
              <Text style={[styles.inputLabel, { color: t.bull }]}>Precio Objetivo Take-Profit (USD)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }]}
                keyboardType="decimal-pad"
                value={editTpInput}
                onChangeText={setEditTpInput}
              />
            </View>

            <View style={{ gap: 4 }}>
              <Text style={[styles.inputLabel, { color: t.bear }]}>Precio de Protección Stop-Loss (USD)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }]}
                keyboardType="decimal-pad"
                value={editSlInput}
                onChangeText={setEditSlInput}
              />
            </View>

            {!!editPosError && (
              <Text style={[styles.fieldErrorText, { color: t.bear }]}>{editPosError}</Text>
            )}

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <TouchableOpacity
                style={[styles.btnOutline, { borderColor: t.border }]}
                onPress={() => setEditPos(null)}
              >
                <Text style={[styles.btnOutlineText, { color: t.text }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimary, { backgroundColor: t.bull }]}
                onPress={savePositionRules}
              >
                <Text style={styles.btnPrimaryText}>Guardar y Sincronizar Reloj</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL DE DEPÓSITO DE LIQUIDEZ ==================== */}
      <Modal visible={depositOpen} transparent animationType="fade" onRequestClose={() => setDepositOpen(false)}>
        <View style={[styles.modalBackdrop, { backgroundColor: t.backdrop }]}>
          <View style={[styles.modalCard, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[styles.modalTitle, { color: t.text }]}>Inyección de Liquidez (Buying Power)</Text>
            <Text style={[styles.inputLabel, { color: t.textSec }]}>Importe a transferir a la cuenta (USD)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }]}
              keyboardType="decimal-pad"
              value={depositAmount}
              onChangeText={setDepositAmount}
            />
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
              {['5000', '10000', '25000', '50000'].map(preset => (
                <TouchableOpacity
                  key={preset}
                  style={[styles.coinChip, { backgroundColor: t.cardSubtle, borderColor: t.border }]}
                  onPress={() => setDepositAmount(preset)}
                >
                  <Text style={{ fontSize: 10, fontWeight: '700', color: t.textSec }}>
                    +${Number(preset).toLocaleString('en-US')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {!!depositError && <Text style={[styles.fieldErrorText, { color: t.bear }]}>{depositError}</Text>}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <TouchableOpacity
                style={[styles.btnOutline, { borderColor: t.border }]}
                onPress={() => setDepositOpen(false)}
              >
                <Text style={[styles.btnOutlineText, { color: t.text }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimary, { backgroundColor: t.bull }]}
                onPress={handleDeposit}
              >
                <Text style={styles.btnPrimaryText}>Acreditar Fondos</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ==================== MODAL DE RETIRO BANCARIO (SPEI / CLABE) ==================== */}
      <Modal visible={withdrawOpen} transparent animationType="fade" onRequestClose={() => setWithdrawOpen(false)}>
        <View style={[styles.modalBackdrop, { backgroundColor: t.backdrop }]}>
          <View style={[styles.modalCard, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[styles.modalTitle, { color: t.text }]}>Retiro Bancario SPEI</Text>
            <Text style={{ fontSize: 11, color: t.textSec }}>
              Liquidez disponible para retiro: <Text style={{ color: t.bull, fontWeight: '800' }}>{fmtPrice(cashBalance)}</Text>
            </Text>
            <Text style={[styles.inputLabel, { color: t.textSec }]}>
              Cuenta destino: CLABE {brokerClabeInput}
            </Text>
            <Text style={[styles.inputLabel, { color: t.textSec }]}>Monto a retirar (USD)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: t.inputBg, borderColor: t.border, color: t.text }]}
              keyboardType="decimal-pad"
              value={withdrawAmount}
              onChangeText={setWithdrawAmount}
            />
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
              {['500', '1000', '5000', String(Math.floor(cashBalance))].map((preset, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.coinChip, { backgroundColor: t.cardSubtle, borderColor: t.border }]}
                  onPress={() => setWithdrawAmount(preset)}
                >
                  <Text style={{ fontSize: 10, fontWeight: '700', color: t.textSec }}>
                    {i === 3 ? '100% Disp.' : `$${Number(preset).toLocaleString('en-US')}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {!!withdrawError && <Text style={[styles.fieldErrorText, { color: t.bear }]}>{withdrawError}</Text>}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <TouchableOpacity
                style={[styles.btnOutline, { borderColor: t.border }]}
                onPress={() => setWithdrawOpen(false)}
              >
                <Text style={[styles.btnOutlineText, { color: t.text }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimary, { backgroundColor: t.bull }]}
                onPress={handleWithdraw}
              >
                <Text style={styles.btnPrimaryText}>Transferir a mi Banco</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  authContainer: { padding: 20, justifyContent: 'center', minHeight: '100%', gap: 16 },
  authBrand: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  authSubtitle: { fontSize: 13, lineHeight: 19 },
  authCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    gap: 12
  },
  fieldErrorText: { fontSize: 11, fontWeight: '600' },
  serverErrorBanner: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1
  },
  brandTitle: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4 },
  proBadge: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  proBadgeText: { fontSize: 9, fontWeight: '800' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: '600' },
  themeBtn: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8
  },
  liveAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    marginHorizontal: 14,
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    gap: 10
  },
  alertQuickBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
  scroll: { flex: 1 },
  scrollContent: { padding: 14, gap: 12, paddingBottom: 24 },
  summaryCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 10
  },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  labelMuted: { fontSize: 11 },
  pnlRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 },
  heroPnl: { fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  heroPct: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  portfolioVal: { fontSize: 18, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  divider: { height: 1 },
  summaryMetricsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metricLabel: { fontSize: 10 },
  metricValue: { fontSize: 12, fontWeight: '700', marginTop: 1, fontVariant: ['tabular-nums'] },
  depositMiniBtn: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterPill: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6
  },
  tickerStrip: { gap: 8, paddingVertical: 2 },
  tickerPill: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 104,
    gap: 2
  },
  tickerSym: { fontSize: 13, fontWeight: '800' },
  catMiniTag: {
    fontSize: 8,
    fontWeight: '700',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3
  },
  tickerVal: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  chartCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10
  },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  chartSym: { fontSize: 18, fontWeight: '800' },
  chartName: { fontSize: 12 },
  chartPrice: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  chartControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8
  },
  timeframeGroup: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 6,
    padding: 2,
    gap: 2
  },
  tfBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4
  },
  chartOptionBtn: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6
  },
  chartLegendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6
  },
  chartBox: {
    position: 'relative',
    borderWidth: 1,
    borderRadius: 8,
    paddingTop: 6,
    paddingBottom: 4,
    overflow: 'hidden',
    alignItems: 'center'
  },
  chartInspectorBar: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 4
  },
  chartScaleCol: {
    position: 'absolute',
    right: 6,
    top: 28,
    bottom: 24,
    justifyContent: 'space-between',
    zIndex: 2,
    alignItems: 'flex-end'
  },
  chartAxisText: {
    fontSize: 9,
    fontWeight: '600',
    paddingHorizontal: 3,
    borderRadius: 2,
    fontVariant: ['tabular-nums']
  },
  offScaleRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 4,
    borderTopWidth: 1
  },
  techGrid: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    gap: 8
  },
  techCell: { flex: 1 },
  techLabel: { fontSize: 9, fontWeight: '600' },
  techVal: { fontSize: 11, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  sectionHeader: { fontSize: 14, fontWeight: '800' },
  posCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 13,
    gap: 10
  },
  posHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  posSym: { fontSize: 16, fontWeight: '800' },
  posMeta: { fontSize: 11, fontVariant: ['tabular-nums'] },
  posPrice: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  posPnl: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  gaugeLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  gaugeLbl: { fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
  gaugeTrack: { height: 6, borderRadius: 4, marginVertical: 4, position: 'relative' },
  gaugeFill: { position: 'absolute', top: 0, height: 6, borderRadius: 4 },
  gaugeEntry: { position: 'absolute', top: -3, width: 2, height: 12 },
  gaugeMarker: { position: 'absolute', top: -2, width: 2, height: 10 },
  gaugeDot: { position: 'absolute', top: -2, width: 10, height: 10, borderRadius: 5, marginLeft: -5 },
  posActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  btnManageRule: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6
  },
  btnPartial: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6
  },
  btnClosePos: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1
  },
  tabsBox: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 8,
    padding: 2
  },
  tabBtn: { flex: 1, paddingVertical: 7, borderRadius: 6, alignItems: 'center', paddingHorizontal: 4 },
  tabText: { fontSize: 11 },
  btnPrimary: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8
  },
  btnPrimaryText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  btnOutline: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8
  },
  btnOutlineText: { fontSize: 12, fontWeight: '600' },
  emptyTitle: { fontSize: 15, fontWeight: '700' },
  emptyBody: { fontSize: 12, lineHeight: 18 },
  sourceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 18
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 8
  },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  coinChip: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6
  },
  inputLabel: { fontSize: 11, marginTop: 2, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13
  },
  previewBox: {
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    gap: 4,
    marginTop: 2
  }
});
