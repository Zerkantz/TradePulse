package com.tradepulse.wear

import android.Manifest
import android.content.Context
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONObject
import java.util.Locale

// Tokens de diseño OLED circular: negro puro, esmeralda/carmesí y cifras tabulares (tnum)
private val Bullish = Color(0xFF10B981)
private val Bearish = Color(0xFFF43F5E)
private val Amber = Color(0xFFF59E0B)
private val SurfaceChip = Color(0xFF161D29)
private val TextMuted = Color(0xFF94A3B8)

private val TabularWatch = TextStyle(
    fontFamily = FontFamily.SansSerif,
    fontFeatureSettings = "tnum",
)

private fun pnlColor(v: Double) = if (v >= 0) Bullish else Bearish

object Fmt {
    fun price(v: Double): String = if (v < 1) String.format(Locale.US, "$%.4f", v) else String.format(Locale.US, "$%,.2f", v)
    fun money(v: Double): String = (if (v >= 0) "+" else "-") + String.format(Locale.US, "$%,.2f", kotlin.math.abs(v))
    fun pct(v: Double): String = String.format(Locale.US, "%+.2f%%", v)
}

enum class AlertType { TAKE_PROFIT, STOP_LOSS }

data class MarketCoin(
    val id: String,
    val symbol: String,
    val name: String,
    val category: String,
    val price: Double,
    val change24h: Double,
)

data class PositionSnapshot(
    val id: Long,
    val coinId: String,
    val symbol: String,
    val price: Double,
    val buyPrice: Double,
    val quantity: Double,
    val takeProfit: Double,
    val stopLoss: Double,
) {
    val pnl: Double get() = (price - buyPrice) * quantity
    val pnlPct: Double get() = if (buyPrice == 0.0) 0.0 else (price - buyPrice) / buyPrice * 100
}

data class PortfolioState(
    val positions: List<PositionSnapshot>,
    val marketCoins: List<MarketCoin>,
    val cashBalance: Double,
    val connected: Boolean,
) {
    val totalPnl: Double get() = positions.sumOf { it.pnl }
    val investedValue: Double get() = positions.sumOf { it.price * it.quantity }
    val totalEquity: Double get() = cashBalance + investedValue
}

data class AlertMessage(
    val positionId: Long,
    val type: AlertType,
    val symbol: String,
    val price: Double,
    val pnl: Double,
    val pnlPct: Double,
)

/** Estado reactivo del reloj sincronizado por Socket.io con el backend y la terminal móvil. */
object WatchClient {
    // 10.0.2.2 apunta al localhost de tu PC desde el emulador Android Wear OS
    private const val BACKEND_URL = "http://10.0.2.2:4000"
    private var socket: Socket? = null

    private val defaultMarket = listOf(
        MarketCoin("nvda", "NVDA", "NVIDIA Corp.", "STOCK", 138.50, 1.25),
        MarketCoin("aapl", "AAPL", "Apple Inc.", "STOCK", 228.40, 0.84),
        MarketCoin("tsla", "TSLA", "Tesla Inc.", "STOCK", 254.20, 1.90),
        MarketCoin("msft", "MSFT", "Microsoft", "STOCK", 425.10, 0.65),
        MarketCoin("bitcoin", "BTC", "Bitcoin Spot", "CRYPTO", 95000.0, 2.10),
        MarketCoin("ethereum", "ETH", "Ethereum Spot", "CRYPTO", 3200.0, 1.40),
        MarketCoin("solana", "SOL", "Solana Spot", "CRYPTO", 185.0, 3.15),
    )

    val state = MutableStateFlow(
        PortfolioState(
            positions = listOf(
                PositionSnapshot(1, "nvda", "NVDA", 138.50, 137.40, 15.0, 145.40, 132.90),
                PositionSnapshot(2, "aapl", "AAPL", 228.40, 226.90, 10.0, 237.50, 221.50),
            ),
            marketCoins = defaultMarket,
            cashBalance = 28022.88,
            connected = false,
        )
    )
    val alert = MutableStateFlow<AlertMessage?>(null)

    fun connect(ctx: Context) {
        if (socket?.connected() == true) return
        runCatching {
            val opts = IO.Options().apply {
                reconnection = true
                reconnectionDelay = 1500
                timeout = 5000
            }
            val s = IO.socket(BACKEND_URL, opts)
            s.on(Socket.EVENT_CONNECT) {
                state.value = state.value.copy(connected = true)
                s.emit("watch:sync")
            }
            s.on(Socket.EVENT_DISCONNECT) {
                state.value = state.value.copy(connected = false)
            }
            s.on("state") { args ->
                val obj = args.firstOrNull() as? JSONObject ?: return@on
                val arr = obj.optJSONArray("positions") ?: return@on
                val list = (0 until arr.length()).map { i ->
                    val p = arr.getJSONObject(i)
                    PositionSnapshot(
                        id = p.getLong("id"),
                        coinId = p.optString("coinId", p.getString("symbol").lowercase()),
                        symbol = p.getString("symbol"),
                        price = p.getDouble("price"),
                        buyPrice = p.getDouble("buyPrice"),
                        quantity = p.getDouble("quantity"),
                        takeProfit = p.getDouble("takeProfit"),
                        stopLoss = p.getDouble("stopLoss"),
                    )
                }

                val coinsArr = obj.optJSONArray("coins")
                val pricesObj = obj.optJSONObject("prices")
                val statsObj = obj.optJSONObject("stats24h")
                val parsedCoins = if (coinsArr != null) {
                    (0 until coinsArr.length()).map { i ->
                        val c = coinsArr.getJSONObject(i)
                        val cid = c.getString("id")
                        val liveP = pricesObj?.optDouble(cid, c.optDouble("seed", 100.0)) ?: c.optDouble("price", 100.0)
                        val chg = statsObj?.optJSONObject(cid)?.optDouble("change24h", 0.0) ?: c.optDouble("change24h", 0.0)
                        MarketCoin(
                            id = cid,
                            symbol = c.getString("symbol"),
                            name = c.optString("name", c.getString("symbol")),
                            category = c.optString("category", "STOCK"),
                            price = liveP,
                            change24h = chg,
                        )
                    }
                } else state.value.marketCoins

                state.value = PortfolioState(
                    positions = list,
                    marketCoins = parsedCoins,
                    cashBalance = obj.optDouble("cashBalance", state.value.cashBalance),
                    connected = true,
                )
            }
            s.on("alert") { args ->
                val o = args.firstOrNull() as? JSONObject ?: return@on
                val a = AlertMessage(
                    positionId = o.getLong("positionId"),
                    type = AlertType.valueOf(o.getString("type")),
                    symbol = o.getString("symbol"),
                    price = o.getDouble("price"),
                    pnl = o.getDouble("pnl"),
                    pnlPct = o.getDouble("pnlPct"),
                )
                alert.value = a
                Haptics.alert(ctx.applicationContext, a.type)
            }
            s.on("alert:clear") {
                alert.value = null
            }
            s.connect()
            socket = s
        }
    }

    /** Comprar acciones o cripto directamente desde el Smartwatch Wear OS */
    fun buyAsset(ctx: Context, coin: MarketCoin, quantity: Double? = null, usdAmount: Double? = null) {
        Haptics.tick(ctx)
        val qty = quantity ?: if (coin.price > 0 && usdAmount != null) (usdAmount / coin.price) else 1.0
        val cleanQty = kotlin.math.round(qty * 10000.0) / 10000.0
        val totalCost = cleanQty * coin.price

        if (totalCost > state.value.cashBalance || cleanQty <= 0) return

        val payload = JSONObject()
            .put("coinId", coin.id)
            .put("symbol", coin.symbol)
            .put("quantity", cleanQty)

        if (socket?.connected() == true) {
            socket?.emit("watch:buy", payload)
        } else {
            // Ejecución autónoma local si el reloj opera sin conexión
            val nextPos = PositionSnapshot(
                id = System.currentTimeMillis(),
                coinId = coin.id,
                symbol = coin.symbol,
                price = coin.price,
                buyPrice = coin.price,
                quantity = cleanQty,
                takeProfit = coin.price * 1.05,
                stopLoss = coin.price * 0.97,
            )
            state.value = state.value.copy(
                cashBalance = state.value.cashBalance - totalCost,
                positions = listOf(nextPos) + state.value.positions,
            )
        }
    }

    fun sendAction(ctx: Context, positionId: Long, action: String, ratio: Double = 1.0) {
        Haptics.tick(ctx)
        val payload = JSONObject()
            .put("positionId", positionId)
            .put("action", action)
            .put("ratio", ratio)
        if (socket?.connected() == true) {
            socket?.emit("watch:action", payload)
        } else {
            val cur = state.value.positions.toMutableList()
            val idx = cur.indexOfFirst { it.id == positionId }
            if (idx != -1) {
                val p = cur[idx]
                when (action) {
                    "SELL" -> {
                        val sellQty = p.quantity * ratio
                        val proceeds = sellQty * p.price
                        if (ratio >= 0.99) cur.removeAt(idx)
                        else cur[idx] = p.copy(quantity = p.quantity - sellQty)
                        state.value = state.value.copy(
                            cashBalance = state.value.cashBalance + proceeds,
                            positions = cur,
                        )
                    }
                    "ADJUST" -> {
                        val gain = p.price >= p.takeProfit
                        cur[idx] = if (gain) p.copy(takeProfit = p.price * 1.05, stopLoss = p.price * 0.97)
                        else p.copy(stopLoss = p.price * 0.95)
                        state.value = state.value.copy(positions = cur)
                    }
                }
            }
        }
        alert.value = null
    }
}

object Haptics {
    private val TAKE_PROFIT = longArrayOf(0, 120, 80, 120)
    private val STOP_LOSS = longArrayOf(0, 500, 150, 500, 150, 500)

    fun alert(ctx: Context, type: AlertType) {
        val v = ctx.getSystemService(Vibrator::class.java) ?: return
        val pattern = if (type == AlertType.TAKE_PROFIT) TAKE_PROFIT else STOP_LOSS
        v.vibrate(VibrationEffect.createWaveform(pattern, -1))
    }

    fun tick(ctx: Context) {
        ctx.getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK))
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0)
        WatchClient.connect(this)
        setContent { MaterialTheme { WatchApp() } }
    }
}

@Composable
private fun WatchApp() {
    val state by WatchClient.state.collectAsStateWithLifecycle()
    val alert by WatchClient.alert.collectAsStateWithLifecycle()
    var selectedPosId by remember { mutableStateOf<Long?>(null) }
    var buyingCatalogOpen by remember { mutableStateOf(false) }
    var buyingCoinId by remember { mutableStateOf<String?>(null) }

    val selectedPos = state.positions.firstOrNull { it.id == selectedPosId }
    val selectedBuyCoin = state.marketCoins.firstOrNull { it.id == buyingCoinId }

    when {
        alert != null -> AlertScreen(alert!!)
        selectedBuyCoin != null -> {
            BackHandler { buyingCoinId = null }
            BuyOrderScreen(
                coin = selectedBuyCoin,
                cashBalance = state.cashBalance,
                onBought = {
                    buyingCoinId = null
                    buyingCatalogOpen = false
                },
                onBack = { buyingCoinId = null },
            )
        }
        buyingCatalogOpen -> {
            BackHandler { buyingCatalogOpen = false }
            BuyCatalogScreen(
                coins = state.marketCoins,
                cashBalance = state.cashBalance,
                onSelectCoin = { buyingCoinId = it.id },
                onBack = { buyingCatalogOpen = false },
            )
        }
        selectedPos != null -> {
            BackHandler { selectedPosId = null }
            DetailScreen(
                p = selectedPos,
                marketCoin = state.marketCoins.firstOrNull { it.id == selectedPos.coinId },
                onBack = { selectedPosId = null },
            )
        }
        else -> TickerScreen(
            state = state,
            onOpenBuyCatalog = { buyingCatalogOpen = true },
            onSelectPos = { selectedPosId = it },
        )
    }
}

@Composable
private fun TickerScreen(
    state: PortfolioState,
    onOpenBuyCatalog: () -> Unit,
    onSelectPos: (Long) -> Unit,
) {
    val list = rememberScalingLazyListState()
    Scaffold(timeText = { TimeText() }, positionIndicator = { PositionIndicator(list) }) {
        ScalingLazyColumn(state = list, modifier = Modifier.fillMaxSize()) {
            item {
                ListHeader {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(
                            Modifier
                                .size(6.dp)
                                .clip(CircleShape)
                                .background(if (state.connected) Bullish else Amber)
                        )
                        Text(
                            text = if (state.connected) "TradePulse · SYNC" else "TradePulse · LOCAL",
                            fontSize = 11.sp,
                            color = TextMuted,
                        )
                    }
                }
            }
            item {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = Fmt.money(state.totalPnl),
                        style = TabularWatch,
                        color = pnlColor(state.totalPnl),
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = "Liquidez: ${Fmt.price(state.cashBalance)}",
                        style = TabularWatch,
                        fontSize = 10.sp,
                        color = TextMuted,
                    )
                }
            }
            item {
                ActionChip("+ Comprar Activo", Bullish, onOpenBuyCatalog)
            }
            if (state.positions.isEmpty()) {
                item {
                    Column(
                        Modifier.fillMaxWidth().padding(8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            "Sin posiciones abiertas.\nPulsa + Comprar Activo.",
                            textAlign = TextAlign.Center,
                            fontSize = 11.sp,
                            color = TextMuted,
                        )
                    }
                }
            } else {
                items(state.positions, key = { it.id }) { p ->
                    PositionChip(p) { onSelectPos(p.id) }
                }
            }
        }
    }
}

/** Catálogo en el reloj para elegir qué acción (NYSE/NASDAQ) o cripto comprar */
@Composable
private fun BuyCatalogScreen(
    coins: List<MarketCoin>,
    cashBalance: Double,
    onSelectCoin: (MarketCoin) -> Unit,
    onBack: () -> Unit,
) {
    val list = rememberScalingLazyListState()
    Scaffold(timeText = { TimeText() }, positionIndicator = { PositionIndicator(list) }) {
        ScalingLazyColumn(state = list, modifier = Modifier.fillMaxSize()) {
            item {
                ListHeader {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Comprar Activo", fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        Text("Disp: ${Fmt.price(cashBalance)}", style = TabularWatch, fontSize = 10.sp, color = Bullish)
                    }
                }
            }
            items(coins, key = { it.id }) { coin ->
                Chip(
                    onClick = { onSelectCoin(coin) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ChipDefaults.chipColors(backgroundColor = SurfaceChip),
                    label = {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(coin.symbol, fontWeight = FontWeight.Bold, maxLines = 1)
                            Text(Fmt.price(coin.price), style = TabularWatch, maxLines = 1)
                        }
                    },
                    secondaryLabel = {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(if (coin.category == "STOCK") "NASDAQ" else "SPOT", fontSize = 10.sp, color = TextMuted)
                            Text(
                                Fmt.pct(coin.change24h),
                                style = TabularWatch,
                                color = pnlColor(coin.change24h),
                                fontSize = 10.sp,
                            )
                        }
                    },
                )
            }
            item { ActionChip("Volver", null, onBack) }
        }
    }
}

/** Boleta de compra rápida desde la muñeca con validación de liquidez y reglas TP (+5%) / SL (-3%) */
@Composable
private fun BuyOrderScreen(
    coin: MarketCoin,
    cashBalance: Double,
    onBought: () -> Unit,
    onBack: () -> Unit,
) {
    val ctx = LocalContext.current
    val list = rememberScalingLazyListState()
    Scaffold(timeText = { TimeText() }, positionIndicator = { PositionIndicator(list) }) {
        ScalingLazyColumn(state = list, modifier = Modifier.fillMaxSize()) {
            item {
                ListHeader {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Comprar ${coin.symbol}", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        Text(Fmt.price(coin.price), style = TabularWatch, fontSize = 15.sp, color = Bullish, fontWeight = FontWeight.Bold)
                    }
                }
            }
            item {
                Text(
                    text = "TP +5% · SL -3% auto\nLiquidez: ${Fmt.price(cashBalance)}",
                    style = TabularWatch,
                    fontSize = 10.sp,
                    color = TextMuted,
                    textAlign = TextAlign.Center,
                )
            }
            if (coin.price <= cashBalance) {
                item {
                    ActionChip("Comprar 1 u. (${Fmt.price(coin.price)})", Bullish) {
                        WatchClient.buyAsset(ctx, coin, quantity = 1.0)
                        onBought()
                    }
                }
            }
            if (coin.price * 5 <= cashBalance && coin.category == "STOCK") {
                item {
                    ActionChip("Comprar 5 acc. (${Fmt.price(coin.price * 5)})", Bullish) {
                        WatchClient.buyAsset(ctx, coin, quantity = 5.0)
                        onBought()
                    }
                }
            }
            listOf(250.0, 500.0, 1000.0, 2500.0).filter { it <= cashBalance }.forEach { usd ->
                item {
                    ActionChip("Invertir ${Fmt.price(usd)}", null) {
                        WatchClient.buyAsset(ctx, coin, usdAmount = usd)
                        onBought()
                    }
                }
            }
            item { ActionChip("Cancelar", null, onBack) }
        }
    }
}

@Composable
private fun PositionChip(p: PositionSnapshot, onClick: () -> Unit) = Chip(
    onClick = onClick,
    modifier = Modifier.fillMaxWidth(),
    colors = ChipDefaults.chipColors(backgroundColor = SurfaceChip),
    label = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("${p.symbol} (${p.quantity})", fontWeight = FontWeight.Bold, maxLines = 1, fontSize = 12.sp)
            Text(Fmt.price(p.price), style = TabularWatch, maxLines = 1, fontSize = 12.sp)
        }
    },
    secondaryLabel = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(Fmt.money(p.pnl), style = TabularWatch, color = pnlColor(p.pnl), fontSize = 11.sp)
            Text(Fmt.pct(p.pnlPct), style = TabularWatch, color = pnlColor(p.pnl), fontSize = 11.sp)
        }
    },
)

@Composable
private fun DetailScreen(p: PositionSnapshot, marketCoin: MarketCoin?, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val list = rememberScalingLazyListState()
    val span = (p.takeProfit - p.stopLoss).coerceAtLeast(0.0001)
    val progress = ((p.price - p.stopLoss) / span).toFloat().coerceIn(0f, 1f)
    val ringColor = pnlColor(p.pnl)

    Scaffold(timeText = { TimeText() }, positionIndicator = { PositionIndicator(list) }) {
        Box(Modifier.fillMaxSize()) {
            Canvas(Modifier.fillMaxSize().padding(3.dp)) {
                val stroke = 4.dp.toPx()
                drawArc(
                    color = SurfaceChip,
                    startAngle = 135f,
                    sweepAngle = 270f,
                    useCenter = false,
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
                drawArc(
                    color = ringColor,
                    startAngle = 135f,
                    sweepAngle = 270f * progress,
                    useCenter = false,
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
            }
            ScalingLazyColumn(state = list, modifier = Modifier.fillMaxSize()) {
                item { ListHeader { Text("${p.symbol} · ${p.quantity} u.", fontWeight = FontWeight.Bold) } }
                item {
                    Text(
                        text = Fmt.price(p.price),
                        style = TabularWatch,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
                item {
                    Text(
                        text = "${Fmt.money(p.pnl)} (${Fmt.pct(p.pnlPct)})",
                        style = TabularWatch,
                        color = ringColor,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                item {
                    Text(
                        text = "SL ${Fmt.price(p.stopLoss)} · TP ${Fmt.price(p.takeProfit)}",
                        style = TabularWatch,
                        fontSize = 11.sp,
                        color = TextMuted,
                        textAlign = TextAlign.Center,
                    )
                }
                if (marketCoin != null) {
                    item {
                        ActionChip("+ Comprar 1 u. más", Bullish) {
                            WatchClient.buyAsset(ctx, marketCoin, quantity = 1.0)
                            onBack()
                        }
                    }
                }
                item {
                    ActionChip("Venta Parcial 50%", null) {
                        WatchClient.sendAction(ctx, p.id, "SELL", 0.5)
                        onBack()
                    }
                }
                item {
                    ActionChip("Liquidar 100%", Bearish) {
                        WatchClient.sendAction(ctx, p.id, "SELL", 1.0)
                        onBack()
                    }
                }
                item {
                    ActionChip("Ajustar TP / SL (+5%)", null) {
                        WatchClient.sendAction(ctx, p.id, "ADJUST", 1.0)
                        onBack()
                    }
                }
                item { ActionChip("Volver", null, onBack) }
            }
        }
    }
}

@Composable
private fun AlertScreen(a: AlertMessage) {
    val ctx = LocalContext.current
    val gain = a.type == AlertType.TAKE_PROFIT
    val color = if (gain) Bullish else Bearish
    val list = rememberScalingLazyListState()

    Scaffold(positionIndicator = { PositionIndicator(list) }) {
        Box(Modifier.fillMaxSize()) {
            Canvas(Modifier.fillMaxSize().padding(2.dp)) {
                drawCircle(color = color.copy(alpha = 0.75f), style = Stroke(width = 4.dp.toPx()))
            }
            ScalingLazyColumn(state = list, modifier = Modifier.fillMaxSize()) {
                item {
                    Text(
                        text = if (gain) "OBJETIVO ALCANZADO" else "LÍMITE DE PÉRDIDA",
                        color = color,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
                item {
                    Text(
                        text = "${a.symbol} ${Fmt.price(a.price)}",
                        style = TabularWatch,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
                item {
                    Text(
                        text = "${Fmt.money(a.pnl)} (${Fmt.pct(a.pnlPct)})",
                        style = TabularWatch,
                        color = color,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                item {
                    ActionChip(if (gain) "Asegurar ganancia" else "Cortar pérdida", color) {
                        WatchClient.sendAction(ctx, a.positionId, "SELL", 1.0)
                    }
                }
                item {
                    ActionChip(if (gain) "Subir objetivo +5%" else "Dar 5% de margen", null) {
                        WatchClient.sendAction(ctx, a.positionId, "ADJUST", 1.0)
                    }
                }
                item {
                    ActionChip("Posponer 15 min", null) {
                        WatchClient.sendAction(ctx, a.positionId, "SNOOZE", 1.0)
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionChip(label: String, color: Color?, onClick: () -> Unit) = Chip(
    onClick = onClick,
    modifier = Modifier.fillMaxWidth(),
    colors = if (color != null) {
        ChipDefaults.primaryChipColors(backgroundColor = color, contentColor = Color.Black)
    } else {
        ChipDefaults.chipColors(backgroundColor = SurfaceChip)
    },
    label = { Text(label, maxLines = 1, fontWeight = if (color != null) FontWeight.Bold else FontWeight.Normal) },
)
