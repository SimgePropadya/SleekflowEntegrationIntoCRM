// Environment variables ve sabitler
module.exports = {
    // API Base URL - Environment variable'dan al, yoksa default
    API_BASE_URL: process.env.API_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000',
    
    // SleekFlow Base URL'leri
    SLEEKFLOW_BASE_URLS: {
        WEST_EUROPE: 'https://sleekflow-core-app-weu-production.azurewebsites.net',
        HONG_KONG: 'https://api.sleekflow.io',
        UNITED_STATES: 'https://sleekflow-core-app-eus-production.azurewebsites.net',
        SINGAPORE: 'https://sleekflow-core-app-seas-production.azurewebsites.net',
        UAE_NORTH: 'https://sleekflow-core-app-uaen-production.azurewebsites.net'
    },
    
    // Zoho Configuration
    ZOHO: {
        ACCOUNTS_URL: process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com',
        API_DOMAIN: process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com',
        SCOPE: process.env.ZOHO_SCOPE || 'ZohoCRM.modules.ALL',
        // Zoho Web Tab/Widget'ta kullanılacak dinamik embed linki (her lead için recordId ve recordName Zoho tarafından doldurulur)
        EMBED_BASE_URL: process.env.WIDGET_BASE_URL || 'https://sleekflowentegrationintocrm-1.onrender.com',
        EMBED_PATH: '/zoho-embed'
    },
    
    // Port
    PORT: process.env.PORT || 3000,
    
    // Environment
    NODE_ENV: process.env.NODE_ENV || 'development',
    
    // Timeouts
    API_TIMEOUT: 30000, // ✅ 30 saniye (Render.com free instance spin down için yeterli süre)
    TOKEN_CACHE_BUFFER: 300000 // 5 dakika (ms)
};

