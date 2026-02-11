// Validation utility fonksiyonları

/**
 * API key'i temizler ve validate eder
 */
function cleanApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
        return null;
    }
    
    // Trim ve invisible karakterleri temizle
    let cleaned = apiKey.trim();
    cleaned = cleaned.replace(/[\x00-\x1F\x7F-\x9F]/g, ''); // Non-printable
    cleaned = cleaned.replace(/[\r\n\t]/g, ''); // Newlines ve tabs
    
    // HTML tag kontrolü
    const htmlPatterns = ['<html', '<div', '<script', 'document.getElementById'];
    const hasHtml = htmlPatterns.some(pattern => 
        cleaned.toLowerCase().includes(pattern.toLowerCase())
    );
    
    if (hasHtml) {
        return null;
    }
    
    // Minimum uzunluk kontrolü
    if (cleaned.length < 10) {
        return null;
    }
    
    return cleaned;
}

/**
 * URL'i validate eder
 */
function isValidUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }
    
    try {
        const urlObj = new URL(url);
        return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Lead ID'yi validate eder
 */
function isValidLeadId(leadId) {
    if (!leadId || typeof leadId !== 'string') {
        return false;
    }
    
    // Placeholder kontrolü
    if (leadId.includes('$') || leadId.includes('{') || leadId.includes('#') || 
        leadId.toLowerCase().includes('recordid')) {
        return false;
    }
    
    // Zoho lead ID'leri genellikle 10+ haneli sayı
    return /^\d{10,}$/.test(leadId);
}

/**
 * Telefon numarasını normalize eder
 */
function normalizePhone(phone) {
    if (!phone || typeof phone !== 'string') {
        return '';
    }
    
    // + işaretini kaldır, sadece rakamları al
    return phone.replace(/^\+/, '').replace(/\D/g, '');
}

module.exports = {
    cleanApiKey,
    isValidUrl,
    isValidLeadId,
    normalizePhone
};

