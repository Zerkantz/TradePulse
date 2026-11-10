# TradePulse — Institutional Smartwatch & Mobile Trading Terminal

Terminal financiera multi-dispositivo en tiempo real para **Móvil (React Native + Expo)** y **Smartwatch (Wear OS Kotlin + Jetpack Compose)** sincronizados mediante **Node.js + Socket.io** con integración a **Alpaca Markets API v2 / OAuth2 (SEC/FINRA)**, **Yahoo Finance (NYSE/NASDAQ)** y **Binance Spot**.

## Arquitectura del Proyecto

```text
TradePulse/
├── backend/   # Servidor Node.js + Express + Socket.io + Alpaca Markets v2/OAuth2 + Yahoo/Binance Live
├── mobile/    # App Móvil en React Native + Expo Router (Modo Oscuro y Claro, Gráficas SVG, Billetera SPEI)
└── wear/      # App Nativa Wear OS en Kotlin + Jetpack Compose (Gradle 9.6.0 + AGP 9.4.1 + JBR 25)
```

## Características Principales
- **Cotizaciones e Historial Intradía en Tiempo Real**: Velas e indicadores técnicos (`EMA-12`, `EMA-20`, `RSI-14`, `Bid/Ask`) de acciones de EE. UU. (`NVDA`, `AAPL`, `TSLA`, `MSFT`) y Cripto Spot (`BTC`, `ETH`, `SOL`).
- **Gráfica Institucional Auto-Escalada (`InstitutionalPriceChart`)**: Sin límites fijos ni aplastamiento de escala al bajar o subir el activo, con inspección táctil punto por punto (`Crosshair`) y temporalidades `15M`, `1H`, `4H`, `1D`.
- **Modo Oscuro y Modo Claro Institucional**: Conmutador instantáneo con persistencia en `AsyncStorage`.
- **Autenticación y Billetera Patrimonial (`Buying Power`)**: Validación cliente/servidor en Login y Apertura de Cuenta, depósitos/retiros SPEI (`CLABE`) y libro contable de operaciones.
- **Integración con Alpaca Markets (`OAuth2` + `Trading API v2`)**: Ejecución y firmado de órdenes de compra/venta con reglas `Take-Profit` y `Stop-Loss`.
- **Smartwatch Wear OS Bidireccional**: Compra de activos desde la muñeca (`+ Comprar Activo`), anillo radial de 270°, vibración háptica diferenciada para `Take-Profit` y `Stop-Loss` y liquidación en 1 toque (`50%` o `100%`).

## Ejecución Rápida

### 1. Backend (`:4000`)
```bash
cd backend
cp .env.example .env
npm install
npm start
```

### 2. App Móvil (`:8081`)
```bash
cd mobile
npm install
npx expo start --port 8081
```

### 3. Smartwatch Wear OS
Abrir la carpeta `wear/` en **Android Studio** (compatible nativamente con JBR 25 / Gradle 9.6.0) y ejecutar en un emulador o reloj Wear OS.
