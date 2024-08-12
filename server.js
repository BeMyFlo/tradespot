const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

// Tạo ứng dụng Express
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// Cấu hình để phục vụ các file tĩnh từ thư mục 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Thông tin API Key và Secret của bạn
const apiKey = '';
const apiSecret = '';

function createSignature(queryString) {
    return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

async function getAccountBalance(asset) {
    const baseUrl = 'https://api.binance.com/api/v3/account';
    const params = { timestamp: Date.now() };
    const queryString = new URLSearchParams(params).toString();
    const signature = createSignature(queryString);
    const fullUrl = `${baseUrl}?${queryString}&signature=${signature}`;

    try {
        const response = await axios.get(fullUrl, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });
        const assetBalance = response.data.balances.find(b => b.asset === asset);
        return parseFloat(assetBalance.free);
    } catch (error) {
        console.error('Error fetching account balance:', error);
        return 0;
    }
}

async function getHistoricalPrices(symbol, interval, limit) {
    const baseUrl = 'https://api.binance.com/api/v3/klines';
    const params = { symbol, interval, limit };
    try {
        const response = await axios.get(baseUrl, { params });
        return response.data.map(candle => parseFloat(candle[4]));
    } catch (error) {
        console.error('Error fetching historical prices:', error);
        return null;
    }
}

function calculateBollingerBands(prices, period = 20, stdDevMultiplier = 2) {
    const sma = prices.slice(-period).reduce((acc, price) => acc + price, 0) / period;
    const variance = prices.slice(-period).reduce((acc, price) => acc + Math.pow(price - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    const upperBand = sma + (stdDevMultiplier * stdDev);
    const lowerBand = sma - (stdDevMultiplier * stdDev);
    return { sma, upperBand, lowerBand };
}

function calculateMinimumSellPrice(P_buy, feeRate) {
    return (P_buy * (1 + feeRate)) / (1 - feeRate);
}

function calculateMaximumBuyPrice(P_sell, feeRate) {
    return (P_sell * (1 - feeRate)) / (1 + feeRate);
}

async function tradeBasedOnBollingerBands() {
    const feeRate = 0.001; // 0.1% phí giao dịch
    const symbol = 'ADAUSDT';
    const prices = await getHistoricalPrices(symbol, '1m', 20);

    if (prices && prices.length >= 20) {
        const { upperBand, lowerBand } = calculateBollingerBands(prices);
        const price = prices[prices.length - 1];
        const usdtBalance = await getAccountBalance('USDT');
        const adaBalance = await getAccountBalance('ADA');
        const minSellPrice = calculateMinimumSellPrice(price, feeRate);
        const maxBuyPrice = calculateMaximumBuyPrice(price, feeRate);

        io.emit('priceUpdate', {
            price,
            upperBand,
            lowerBand,
            minSellPrice,
            maxBuyPrice
        });

        if (price >= upperBand && adaBalance > 0.05 && price >= minSellPrice) {
            io.emit('tradeAction', 'Giá chạm dải trên của Bollinger Bands và đủ điều kiện bán có lãi, bán ADA...');
        } else if (price <= lowerBand && usdtBalance > 0.05 && price <= maxBuyPrice) {
            io.emit('tradeAction', 'Giá chạm dải dưới của Bollinger Bands và đủ điều kiện mua có lãi, mua ADA...');
        } else {
            io.emit('tradeAction', 'Không có hành động nào cần thực hiện.');
        }
    }
}

setInterval(tradeBasedOnBollingerBands, 10000);

server.listen(3000, () => {
    console.log('Server listening on port 3000');
});
