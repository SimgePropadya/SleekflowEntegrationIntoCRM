// Merkezi error handling utility

/**
 * API hatalarını parse eder ve kullanıcı dostu mesajlar döndürür
 */
function parseApiError(error) {
    const status = error.response?.status;
    const data = error.response?.data;
    const message = error.message || 'Bilinmeyen hata';
    
    // 401/403 - Yetkilendirme hatası
    if (status === 401 || status === 403) {
        return {
            type: 'AUTH_ERROR',
            status,
            message: 'API anahtarı geçersiz veya yetkilendirme hatası',
            details: data,
            userMessage: 'Lütfen API anahtarınızı kontrol edin ve tekrar deneyin.',
            endpointFound: true
        };
    }
    
    // 404 - Endpoint bulunamadı
    if (status === 404) {
        return {
            type: 'NOT_FOUND',
            status,
            message: 'Endpoint bulunamadı',
            details: data,
            userMessage: 'API endpoint\'i bulunamadı. Base URL\'i kontrol edin.',
            endpointFound: false
        };
    }
    
    // 500 - Sunucu hatası
    if (status === 500) {
        return {
            type: 'SERVER_ERROR',
            status,
            message: 'Sunucu hatası',
            details: data,
            userMessage: 'Sunucuda geçici bir sorun var. Lütfen birkaç dakika sonra tekrar deneyin.',
            endpointFound: true
        };
    }
    
    // Network hatası
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        return {
            type: 'NETWORK_ERROR',
            status: null,
            message: 'Bağlantı hatası',
            details: { code: error.code, message },
            userMessage: 'Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin.',
            endpointFound: false
        };
    }
    
    // Diğer hatalar
    return {
        type: 'UNKNOWN_ERROR',
        status: status || null,
        message,
        details: data || error,
        userMessage: 'Bir hata oluştu. Lütfen tekrar deneyin.',
        endpointFound: status ? true : false
    };
}

/**
 * Error response formatı oluşturur
 */
function createErrorResponse(parsedError, additionalData = {}) {
    return {
        error: parsedError.userMessage || parsedError.message,
        status: parsedError.status,
        endpointFound: parsedError.endpointFound,
        details: parsedError.details,
        ...additionalData
    };
}

/**
 * Express async route handler wrapper - Hataları otomatik yakalar
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch((error) => {
            const parsedError = parseApiError(error);
            const errorResponse = createErrorResponse(parsedError, {
                path: req.path,
                method: req.method
            });
            res.status(parsedError.status || 500).json(errorResponse);
        });
    };
}

module.exports = {
    parseApiError,
    createErrorResponse,
    asyncHandler
};

