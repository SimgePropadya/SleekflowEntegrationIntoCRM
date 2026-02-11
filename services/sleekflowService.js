// SleekFlow API servisi

const axios = require('axios');
const { parseApiError } = require('../utils/errorHandler');
const logger = require('../utils/logger');
const { cleanApiKey } = require('../utils/validation');
const { SLEEKFLOW_BASE_URLS, API_TIMEOUT } = require('../config/constants');

class SleekflowService {
    constructor() {
        this.apiKey = null;
        this.baseUrl = null;
    }

    /**
     * API key ve base URL'i ayarla
     */
    setCredentials(apiKey, baseUrl = null) {
        // ✅ KRITIK: apiKey null/undefined kontrolü
        if (!apiKey) {
            throw new Error('API anahtarı gerekli');
        }
        
        if (typeof apiKey !== 'string') {
            throw new Error('API anahtarı string olmalı');
        }
        
        const trimmedKey = apiKey.trim();
        if (trimmedKey.length < 10) {
            throw new Error('API anahtarı çok kısa (minimum 10 karakter)');
        }
        
        const cleanedKey = cleanApiKey(trimmedKey);
        if (!cleanedKey) {
            throw new Error('Geçersiz API anahtarı - temizleme başarısız');
        }
        
        this.apiKey = cleanedKey;
        
        // ✅ KRITIK: baseUrl null/undefined/boş string/"undefined" string kontrolü
        if (baseUrl && typeof baseUrl === 'string') {
            const trimmedBaseUrl = baseUrl.trim();
            // "undefined" string'ini kontrol et
            if (trimmedBaseUrl && trimmedBaseUrl !== 'undefined' && trimmedBaseUrl !== 'null') {
                this.baseUrl = trimmedBaseUrl.replace(/\/+$/, '');
            } else {
                this.baseUrl = null;
            }
        } else {
            // baseUrl null/boş ise default kullan (call metodunda zaten fallback var ama burada da set edelim)
            this.baseUrl = null; // call metodunda SLEEKFLOW_BASE_URLS.HONG_KONG kullanılacak
        }
    }

    /**
     * SleekFlow API'ye istek at
     */
    async call(method, path, options = {}) {
        if (!this.apiKey) {
            throw new Error('Sleekflow API anahtarı ayarlı değil');
        }

        const { params = {}, data = null } = options;
        const base = this.baseUrl || SLEEKFLOW_BASE_URLS.HONG_KONG;
        const url = `${base.replace(/\/+$/, '')}${path}`;

        // ✅ PERFORMANS: Direkt ilk header formatını kullan (deneme yok)
        const headers = { 'X-Sleekflow-Api-Key': this.apiKey, 'Content-Type': 'application/json' };
        
        const config = {
            method,
            url,
            params,
            headers,
            timeout: API_TIMEOUT || 5000
        };

        if (data) {
            config.data = data;
        }

        try {
            const response = await axios(config);
            
            // ✅ KRITIK: Response'u detaylı logla (mesaj gönderme için)
            if (path.includes('/message/send')) {
                logger.info('SleekFlow API response (raw)', {
                    status: response.status,
                    statusText: response.statusText,
                    data: response.data,
                    headers: response.headers
                });
            }
            
            return response.data;
        } catch (error) {
            // Axios hatalarını daha iyi yönet
            if (error.response) {
                // API'den hata döndü (4xx, 5xx)
                const apiError = new Error(error.response.data?.message || error.response.data?.error || `HTTP ${error.response.status}`);
                apiError.status = error.response.status;
                apiError.response = error.response;
                throw apiError;
            } else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
                // Timeout hatası
                const timeoutError = new Error(`SleekFlow API'ye bağlanırken zaman aşımı oluştu (${API_TIMEOUT}ms). URL: ${url}`);
                timeoutError.code = 'TIMEOUT';
                timeoutError.status = 504;
                throw timeoutError;
            } else if (error.request) {
                // İstek gönderildi ama yanıt alınamadı - Daha detaylı hata mesajı
                const networkError = new Error(`SleekFlow API'ye bağlanılamadı. URL: ${url}. Hata: ${error.code || error.message || 'Bilinmeyen network hatası'}`);
                networkError.code = error.code || 'NETWORK_ERROR';
                networkError.status = 503;
                networkError.url = url;
                throw networkError;
            } else {
                // İstek hazırlanırken hata oluştu
                const configError = new Error(`İstek hazırlanırken hata: ${error.message || 'Bilinmeyen hata'}. URL: ${url}`);
                configError.code = 'CONFIG_ERROR';
                throw configError;
            }
        }
    }

    /**
     * Bağlantıyı test et
     */
    async testConnection(baseUrl = null) {
        const testBaseUrl = baseUrl || this.baseUrl;
        const originalBaseUrl = this.baseUrl;
        
        if (testBaseUrl) {
            this.baseUrl = testBaseUrl.replace(/\/+$/, '');
        }

        try {
            const data = await this.call('get', '/api/contact', {
                params: { limit: 1, offset: 0 }
            });
            
            return {
                success: true,
                baseUrl: this.baseUrl,
                endpoint: '/api/contact',
                sample: data
            };
        } catch (error) {
            throw error;
        } finally {
            if (originalBaseUrl) {
                this.baseUrl = originalBaseUrl;
            }
        }
    }

    /**
     * Tüm base URL'leri dene ve çalışanı bul
     */
    async findWorkingBaseUrl(preferredUrl = null) {
        const urlsToTry = [
            preferredUrl,
            ...Object.values(SLEEKFLOW_BASE_URLS)
        ].filter(Boolean);

        logger.info('Base URL aranıyor', { count: urlsToTry.length });

        let lastAuthError = null;
        let lastError = null;

        for (const testUrl of urlsToTry) {
            try {
                const result = await this.testConnection(testUrl);
                if (result && result.success) {
                    logger.info('Çalışan base URL bulundu', { url: testUrl });
                    return { success: true, baseUrl: testUrl, ...result };
                }
            } catch (error) {
                const parsed = parseApiError(error);
                lastError = parsed;
                
                // 401/403 - Base URL doğru ama API key yanlış
                if (parsed.status === 401 || parsed.status === 403) {
                    lastAuthError = {
                        success: false,
                        baseUrl: testUrl,
                        endpointFound: true,
                        authError: true
                    };
                    logger.info('Auth hatası bulundu (endpoint var ama API key yanlış)', { url: testUrl });
                    // Devam et, belki başka bir URL çalışır
                    continue;
                }
                
                logger.debug('Base URL test başarısız', { url: testUrl, error: parsed.message });
            }
        }

        // Eğer auth hatası varsa onu döndür (en az bir endpoint bulundu demektir)
        if (lastAuthError) {
            return lastAuthError;
        }

        // Hiçbir URL çalışmadı
        return {
            success: false,
            endpointFound: false,
            lastError: lastError
        };
    }
}

// Singleton instance
const sleekflowService = new SleekflowService();

module.exports = sleekflowService;

