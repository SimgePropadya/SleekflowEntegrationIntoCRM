require('dotenv').config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const logger = require('./utils/logger');
const { PORT } = require('./config/constants');

// Route'ları import et
const sleekflowRoutes = require('./routes/sleekflowRoutes');
const zohoRoutes = require('./routes/zohoRoutes');

const app = express();

// CORS: Widget Zoho iframe'den veya aynı host'tan istek atabiliyor
function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;
    const host = req.get('host') || req.hostname || '';
    const isSameHost = origin && (origin.indexOf(host.replace(/:\d+$/, '')) !== -1);
    const isZoho = origin && (/^https?:\/\/([a-z0-9-]+\.)?zoho\.(com|eu|in|com\.au)/i.test(origin) || /crm\.zoho/i.test(origin));
    const isRender = origin && /\.onrender\.com$/i.test(origin);
    const isLocal = origin && (/^https?:\/\/localhost(\d*)/i.test(origin) || /^https?:\/\/127\.0\.0\.1/i.test(origin));
    const allowOrigin = (origin && (isSameHost || isZoho || isRender || isLocal)) ? origin : (origin || `https://${host}`);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
        res.setHeader('Content-Length', '0');
        return res.status(204).end();
    }
    next();
}
app.use(corsMiddleware);
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.url}`, req.body && Object.keys(req.body).length > 0 ? req.body : null);
    next();
});

// =====================
// STATIC FILES & WIDGET ROUTES
// =====================
app.get("/", (req, res) => {
    logger.info("GET / -> zoho-widget.html");
    res.sendFile(path.join(__dirname, "zoho-widget.html"));
});

app.get("/zoho-widget.html", (req, res) => {
    logger.info("GET /zoho-widget.html");
    res.sendFile(path.join(__dirname, "zoho-widget.html"));
});

// Zoho embed: tek link, query parametreleri widget'a iletir (her lead için dinamik)
app.get("/zoho-embed", (req, res) => {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(302, "/zoho-widget.html" + qs);
});
app.get("/zoho-embed/", (req, res) => {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(302, "/zoho-widget.html" + qs);
});

app.get("/bulk-message.html", (req, res) => {
    logger.info("GET /bulk-message.html");
    res.sendFile(path.join(__dirname, "bulk-message.html"));
});

// Static files middleware
app.use(express.static(path.join(__dirname)));

// =====================
// API ROUTES (JSON Content-Type CORB icin)
// =====================
app.use("/api/sleekflow", (req, res, next) => { res.setHeader('Content-Type', 'application/json'); next(); }, sleekflowRoutes);
app.use("/api/zoho", (req, res, next) => { res.setHeader('Content-Type', 'application/json'); next(); }, zohoRoutes);

app.get("/api/health", (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json({ ok: true, cors: true, time: new Date().toISOString() });
});

// =====================
// ERROR HANDLING MIDDLEWARE
// =====================
app.use((err, req, res, next) => {
    logger.error('Unhandled error', { 
        error: err.message, 
        stack: err.stack,
        url: req.url,
        method: req.method
    });

    const { parseApiError, createErrorResponse } = require('./utils/errorHandler');
    const parsedError = parseApiError(err);
    
    res.status(parsedError.status || 500).json(
        createErrorResponse(parsedError, {
            path: req.path,
            method: req.method
        })
    );
});

// =====================
// 404 HANDLER
// =====================
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint bulunamadı',
        path: req.path,
        method: req.method
    });
});

// =====================
// SERVER START
// =====================
app.listen(PORT, () => {
    logger.info(`Server başlatıldı`, { 
        port: PORT,
        env: process.env.NODE_ENV || 'development'
    });
});

module.exports = app;
