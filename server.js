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

// CORS: Widget Zoho CRM iframe'inden veya farklı origin'den istek atabiliyor
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
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

app.get("/bulk-message.html", (req, res) => {
    logger.info("GET /bulk-message.html");
    res.sendFile(path.join(__dirname, "bulk-message.html"));
});

// Static files middleware
app.use(express.static(path.join(__dirname)));

// =====================
// API ROUTES
// =====================
app.use("/api/sleekflow", sleekflowRoutes);
app.use("/api/zoho", zohoRoutes);

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
