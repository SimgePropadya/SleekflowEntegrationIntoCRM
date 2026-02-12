// SleekFlow API route'ları

const express = require('express');
const multer = require('multer');
const router = express.Router();
const sleekflowService = require('../services/sleekflowService');
const metaInstagramService = require('../services/metaInstagramService');
const { asyncHandler, createErrorResponse, parseApiError } = require('../utils/errorHandler');
const logger = require('../utils/logger');
const { zohoGet } = require('../zohoClient');
const { API_TIMEOUT } = require('../config/constants');
const fs = require('fs');
const path = require('path');

const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 50 * 1024 * 1024 }
});

// Bellekte tutulan bağlantı bilgileri (session bazlı)
// Production'da Redis veya database kullanılmalı
let sleekflowApiKey = null;
let sleekflowBaseUrl = null;

/**
 * POST /api/sleekflow/connect-fast
 * Hızlı bağlantı - Sadece API key'i kaydeder, test yapmaz
 */
router.post('/connect-fast', asyncHandler(async (req, res, next) => {
    const { apiKey, baseUrl } = req.body || {};

    if (!apiKey) {
        return res.status(400).json({ 
            error: 'API anahtarı gerekli' 
        });
    }

    // Service'e credentials'ı set et (test yapmadan)
    sleekflowService.setCredentials(apiKey, baseUrl);
    sleekflowApiKey = apiKey;
    sleekflowBaseUrl = baseUrl || 'https://api.sleekflow.io';
    
    res.json({
        success: true,
        message: 'API anahtarı kaydedildi'
    });
}));

/**
 * POST /api/sleekflow/connect
 * SleekFlow bağlantısı kur (tam test ile)
 */
router.post('/connect', asyncHandler(async (req, res, next) => {
    logger.info('SleekFlow bağlantı isteği');
    
    const { apiKey, baseUrl } = req.body || {};

    if (!apiKey) {
        return res.status(400).json({ 
            error: 'API anahtarı gerekli' 
        });
    }

    // Service'e credentials'ı set et
    sleekflowService.setCredentials(apiKey, baseUrl);
    sleekflowApiKey = apiKey;
    
    // ✅ PERFORMANS: Eğer baseUrl verilmişse sadece onu test et
    let urlResult;
    if (baseUrl && baseUrl.trim()) {
        // Sadece verilen URL'yi test et
        try {
            const result = await sleekflowService.testConnection(baseUrl);
            urlResult = { success: true, baseUrl: baseUrl, ...result };
        } catch (error) {
            const parsed = parseApiError(error);
            if (parsed.status === 401 || parsed.status === 403) {
                urlResult = {
                    success: false,
                    baseUrl: baseUrl,
                    endpointFound: true,
                    authError: true
                };
            } else {
                // Verilen URL çalışmıyorsa tüm URL'leri dene
                urlResult = await sleekflowService.findWorkingBaseUrl(baseUrl);
            }
        }
    } else {
        // Base URL verilmemişse tüm URL'leri dene
        urlResult = await sleekflowService.findWorkingBaseUrl(baseUrl);
    }
    
    if (!urlResult.success) {
        if (urlResult.authError) {
            return res.status(401).json(createErrorResponse({
                type: 'AUTH_ERROR',
                status: 401,
                message: 'API anahtarı geçersiz',
                userMessage: 'API anahtarı geçersiz. Lütfen doğru API anahtarını girin.',
                endpointFound: true
            }));
        }
        
        // Endpoint bulunamadı veya network hatası
        const errorType = urlResult.endpointFound === false ? 'NOT_FOUND' : 'NETWORK_ERROR';
        const statusCode = urlResult.endpointFound === false ? 404 : 500;
        
        return res.status(statusCode).json(createErrorResponse({
            type: errorType,
            status: statusCode,
            message: urlResult.endpointFound === false ? 'Base URL bulunamadı' : 'Bağlantı hatası',
            userMessage: urlResult.endpointFound === false 
                ? 'Tüm base URL\'ler denenendi ama bağlantı kurulamadı. Lütfen internet bağlantınızı kontrol edin.'
                : 'SleekFlow sunucusuna bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.',
            endpointFound: urlResult.endpointFound || false
        }, {
            triedUrls: Object.values(require('../config/constants').SLEEKFLOW_BASE_URLS),
            lastError: urlResult.lastError
        }));
    }

    sleekflowBaseUrl = urlResult.baseUrl;
    
    res.json({
        success: true,
        connected: true,
        endpointFound: true,
        message: 'Sleekflow bağlantısı başarılı',
        workingEndpoint: urlResult.endpoint,
        baseUrl: sleekflowBaseUrl
    });
}));

/**
 * GET /api/sleekflow/conversations
 * Konuşma listesi
 */
router.get('/conversations', asyncHandler(async (req, res, next) => {
    const { channel: filterChannel, apiKey, baseUrl, fromPhone: requestedFromPhone, userEmail, userId, leadName: reqLeadNameParam, leadId: reqLeadIdParam } = req.query;
    
    // ✅ Helper function: Telefon numarasını temizle (tüm scope'ta erişilebilir)
    const cleanPhone = (phone) => {
        return String(phone || '').replace(/\+/g, '').replace(/\s/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '').trim();
    };
    
    // ✅ BACKEND YETKİ KONTROLÜ: Kullanıcı bilgisini al ve yetkilerini kontrol et
    let allowedSenders = ['*']; // Default: Tüm sender'lar
    let allowedChannels = ['*']; // Default: Tüm kanallar
    let userPermissions = null; // Kullanıcı yetkileri (hem eski hem yeni format için)
    
    if (userEmail || userId) {
        try {
            const userSenderPermissions = require('../config/userSenderPermissions');
            const userKey = userEmail || userId;
            userPermissions = userSenderPermissions[userKey] || userSenderPermissions.default || ['*'];
            
            // ✅ ESKİ FORMAT (Array): Sadece sender array'i
            if (Array.isArray(userPermissions)) {
                allowedSenders = userPermissions;
                allowedChannels = ['*']; // Eski format: Tüm kanallar
            } 
            // ✅ YENİ FORMAT (Object): Sender + Channel
            else if (userPermissions && typeof userPermissions === 'object') {
                allowedSenders = userPermissions.senders || ['*'];
                allowedChannels = userPermissions.channels || ['*'];
            } 
            // ✅ Fallback
            else {
                allowedSenders = ['*'];
                allowedChannels = ['*'];
            }
            
            logger.info('✅ [BACKEND YETKİ] Kullanıcı yetkileri kontrol edildi', { 
                userEmail, 
                userId, 
                allowedSenders,
                allowedChannels,
                format: Array.isArray(userPermissions) ? 'eski (array)' : 'yeni (object)'
            });
        } catch (permError) {
            logger.warn('⚠️ [BACKEND YETKİ] Yetki kontrolü hatası, default yetkiler kullanılıyor', { error: permError.message });
            allowedSenders = ['*'];
            allowedChannels = ['*'];
        }
    }
    
    // ✅ BACKEND YETKİ KONTROLÜ: Eğer requestedFromPhone varsa, kullanıcının bu sender'a yetkisi var mı kontrol et
    if (requestedFromPhone) {
        const cleanRequestedPhone = cleanPhone(requestedFromPhone);
        
        // ✅ Admin değilse ve requestedFromPhone yetkili değilse, erişim reddedilir
        if (!allowedSenders.includes('*') && !allowedSenders.includes(cleanRequestedPhone)) {
            logger.warn('❌ [BACKEND YETKİ] Kullanıcının bu sender\'a erişim yetkisi yok', { 
                userEmail, 
                userId, 
                requestedFromPhone: cleanRequestedPhone, 
                allowedSenders 
            });
            return res.status(403).json({ 
                error: 'Bu sender numarasına erişim yetkiniz yok',
                conversations: []
            });
        }
    }
    
    // ✅ KRITIK: API key kontrolü - En başta yap
    if (!apiKey && !sleekflowApiKey) {
        return res.status(401).json({ 
            error: 'Sleekflow bağlantısı yok. Lütfen API anahtarınızı girin ve bağlanın.',
            conversations: []
        });
    }
    
    // ✅ PERFORMANS: Eğer query'de API key varsa onu kullan (connect-fast'e gerek yok)
    try {
        const apiKeyToUse = apiKey || sleekflowApiKey;
        
        // ✅ API key kontrolünü esnet - sadece boş olup olmadığını kontrol et
        if (!apiKeyToUse || typeof apiKeyToUse !== 'string' || apiKeyToUse.trim().length === 0) {
            return res.status(400).json({ 
                error: 'Geçersiz API anahtarı. Lütfen doğru API anahtarını girin.',
                conversations: []
            });
        }
        
        // ✅ KRITIK: baseUrl null/undefined/boş string kontrolü
        let finalBaseUrl = 'https://api.sleekflow.io'; // Default
        if (baseUrl && typeof baseUrl === 'string' && baseUrl.trim() && baseUrl.trim() !== 'undefined') {
            finalBaseUrl = baseUrl.trim();
        } else if (sleekflowBaseUrl && typeof sleekflowBaseUrl === 'string' && sleekflowBaseUrl.trim() && sleekflowBaseUrl.trim() !== 'undefined') {
            finalBaseUrl = sleekflowBaseUrl.trim();
        }
        
        // ✅ KRITIK: setCredentials çağrısından önce tüm kontroller yapıldı
        sleekflowService.setCredentials(apiKeyToUse, finalBaseUrl);
        sleekflowApiKey = apiKeyToUse;
        sleekflowBaseUrl = finalBaseUrl;
    } catch (credError) {
        logger.error('Credentials set hatası', { 
            error: credError.message,
            stack: credError.stack,
            apiKey: apiKey ? (apiKey.substring(0, 10) + '...') : 'NOT SET',
            baseUrl: baseUrl || 'NOT SET',
            sleekflowBaseUrl: sleekflowBaseUrl || 'NOT SET',
            apiKeyType: typeof apiKey,
            baseUrlType: typeof baseUrl
        });
        return res.status(500).json({ 
            error: 'API anahtarı ayarlanırken hata oluştu: ' + (credError.message || 'Bilinmeyen hata'),
            conversations: []
        });
    }

    // ✅ TÜM KONUŞMALARI ÇEK - Pagination ile
    const allConversations = [];
    const pageSize = 1000;
    let offset = 0;
    let hasMore = true;
    
    // ✅ Hamzah için: Channel bilgilerini burada tanımla (scope için)
    const isHamzahRequest = requestedFromPhone && cleanPhone(requestedFromPhone) === '905421363421';
    const hamzahPhoneNumber = '905421363421'; // ✅ Hamzah'ın telefon numarası
    let hamzahChannelInfo = null;
    let hamzahChannelName = null;
    let hamzahTwilioAccountId = null;

    try {
        // ✅ Hamzah için: Önce channel bilgilerini çek ve channel name ile filtreleme yap
        
        if (isHamzahRequest) {
            try {
                console.log(`✅ [BACKEND] Hamzah için channel bilgileri çekiliyor...`);
                const channelData = await sleekflowService.call('get', '/api/conversation/channel');
                
                if (channelData && channelData.whatsAppConfigs && Array.isArray(channelData.whatsAppConfigs)) {
                    // ✅ "Hamzah Coexistence" kanalını bul (parantez içindeki numaraları ignore et)
                    hamzahChannelInfo = channelData.whatsAppConfigs.find(config => {
                        if (!config.name) return false;
                        const nameLower = config.name.toLowerCase();
                        const cleanName = nameLower.replace(/\([^)]*\)/g, '').trim(); // Parantez içindekileri kaldır
                        return cleanName.includes('hamzah') || cleanName.includes('coexistence') ||
                               nameLower.includes('hamzah') || nameLower.includes('coexistence') ||
                               config.name.includes('5421363421'); // Telefon numarasını da kontrol et
                    });
                    
                    if (hamzahChannelInfo) {
                        hamzahChannelName = hamzahChannelInfo.name; // ✅ Channel name'i al
                        hamzahTwilioAccountId = hamzahChannelInfo.twilioAccountId;
                        console.log(`✅ [BACKEND] Hamzah kanalı bulundu:`, {
                            name: hamzahChannelName,
                            whatsAppSender: hamzahChannelInfo.whatsAppSender,
                            twilioAccountId: hamzahTwilioAccountId
                        });
                    } else {
                        console.log(`⚠️ [BACKEND] Hamzah kanalı bulunamadı, tüm kanallar:`, channelData.whatsAppConfigs.map(c => c.name));
                    }
                } else {
                    console.log(`⚠️ [BACKEND] Channel data formatı beklenmeyen:`, channelData);
                }
            } catch (channelError) {
                // ✅ Channel bilgileri çekilemese bile devam et (fallback olarak field'lara bakacağız)
                console.log(`⚠️ [BACKEND] Channel bilgileri çekilemedi (devam ediliyor): ${channelError.message}`);
            }
        }
        
        // ✅ Hamzah için: Tüm conversation'ları çek, sonra field'lara bakarak filtreleme yapacağız
        if (isHamzahRequest) {
            console.log(`✅ [BACKEND] Hamzah için tüm conversation'lar çekiliyor, sonra field'lara bakarak filtreleme yapılacak...`);
        }
        
        // ✅ Tüm conversation'ları çek
        // ✅ Hamzah için: Channel name veya channel ID ile filtreleme yap
        while (hasMore) {
            const params = { limit: pageSize, offset };
            
            // ✅ Hamzah için: Channel parametresi ekle
            if (isHamzahRequest && hamzahChannelName) {
                // ✅ Önce channel name ile dene
                params.channel = hamzahChannelName;
                console.log(`✅ [BACKEND] Hamzah için channel parametresi eklendi: ${hamzahChannelName}`);
            } else if (filterChannel) {
                params.channel = filterChannel;
            }

            try {
                const data = await sleekflowService.call('get', '/api/conversation/all', { params });
                const pageConversations = Array.isArray(data) ? data : (data.data || data.items || data.conversations || []);

                if (!Array.isArray(pageConversations) || pageConversations.length === 0) {
                    hasMore = false;
                    break;
                }

                allConversations.push(...pageConversations);
                console.log(`✅ [BACKEND] Conversation'lar çekildi: ${pageConversations.length} (toplam: ${allConversations.length}, offset: ${offset})`);
                
                // ✅ DEBUG: İlk conversation'ın raw data'sını logla (Hamzah için)
                if (isHamzahRequest && offset === 0 && pageConversations.length > 0) {
                    const firstConv = pageConversations[0];
                    // ✅ conversationChannels array'inin içeriğini detaylı logla
                    const channelsInfo = firstConv.conversationChannels ? 
                        firstConv.conversationChannels.map((ch, idx) => ({
                            index: idx,
                            keys: Object.keys(ch || {}),
                            name: ch.name || ch.channelName || ch.displayName || '(yok)',
                            id: ch.id || ch.channelId || ch.channelIdentityId || '(yok)',
                            phoneNumber: ch.phoneNumber || ch.whatsappChannelPhoneNumber || '(yok)',
                            fullChannel: ch // ✅ Tüm channel objesi
                        })) : [];
                    
                    console.log(`🔍 [BACKEND] İLK CONVERSATION RAW DATA (Hamzah için):`, {
                        conversationId: firstConv.conversationId || firstConv.id,
                        allKeys: Object.keys(firstConv),
                        // ✅ Channel bilgileri
                        channelName: firstConv.channelName,
                        channel: firstConv.channel,
                        channelConfig: firstConv.channelConfig,
                        channelId: firstConv.channelId,
                        twilioAccountId: firstConv.twilioAccountId,
                        whatsappCloudApiReceiver: firstConv.whatsappCloudApiReceiver,
                        dynamicChannelSender: firstConv.dynamicChannelSender,
                        channelIdentityId: firstConv.channelIdentityId,
                        lastMessageChannel: firstConv.lastMessageChannel,
                        // ✅ YENİ: conversationChannels detaylı
                        lastChannelIdentityId: firstConv.lastChannelIdentityId || '(yok)',
                        conversationChannelsLength: firstConv.conversationChannels ? firstConv.conversationChannels.length : 0,
                        conversationChannelsInfo: channelsInfo, // ✅ Detaylı channel bilgileri
                        // ✅ Phone bilgileri
                        fromPhone: firstConv.fromPhone || '(yok)',
                        from: firstConv.from || '(yok)'
                    });
                }

                if (pageConversations.length < pageSize) {
                    hasMore = false;
                } else {
                    offset += pageSize;
                }
            } catch (conversationError) {
                // ✅ Eğer channel parametresi 400 hatası veriyorsa, channel parametresini kaldır ve tekrar dene
                if (isHamzahRequest && hamzahChannelName && conversationError.response?.status === 400) {
                    console.log(`⚠️ [BACKEND] Channel parametresi 400 hatası verdi, channel parametresi kaldırılıyor ve tekrar deneniyor...`);
                    delete params.channel;
                    const data = await sleekflowService.call('get', '/api/conversation/all', { params });
                    const pageConversations = Array.isArray(data) ? data : (data.data || data.items || data.conversations || []);

                    if (!Array.isArray(pageConversations) || pageConversations.length === 0) {
                        hasMore = false;
                        break;
                    }

                    allConversations.push(...pageConversations);
                    console.log(`✅ [BACKEND] Conversation'lar channel parametresi OLMADAN çekildi: ${pageConversations.length} (toplam: ${allConversations.length})`);

                    if (pageConversations.length < pageSize) {
                        hasMore = false;
                    } else {
                        offset += pageSize;
                    }
                } else {
                    // ✅ Diğer hatalar için yukarı fırlat
                    logger.error('Conversation çekme hatası', { 
                        error: conversationError.message,
                        offset,
                        pageSize,
                        params,
                        status: conversationError.response?.status
                    });
                    throw conversationError;
                }
            }
        }
    } catch (error) {
        logger.error('Konuşmalar çekilirken hata', { 
            error: error.message, 
            stack: error.stack,
            response: error.response?.data,
            status: error.status || error.response?.status,
            apiKey: sleekflowApiKey ? 'SET' : 'NOT SET',
            baseUrl: sleekflowBaseUrl || 'NOT SET',
            name: error.name,
            code: error.code,
            url: error.url || 'NOT SET'
        });
        
        // Axios hatalarını daha iyi yakala
        if (error.response) {
            const status = error.response.status;
            const errorData = error.response.data || {};
            const errorMsg = errorData.message || errorData.error || error.message || 'Bilinmeyen hata';
            
            // 401/403 için özel mesaj
            if (status === 401 || status === 403) {
                return res.status(401).json({ 
                    error: 'API anahtarı geçersiz. Lütfen doğru API anahtarını girin.',
                    conversations: []
                });
            }
            
            return res.status(status >= 400 && status < 500 ? status : 500).json({ 
                error: `SleekFlow API hatası (${status}): ${errorMsg}`,
                conversations: []
            });
        }
        
        // Network veya timeout hataları - error.status veya error.code kontrolü
        if (error.status === 504 || error.status === 503 || error.code === 'ECONNABORTED' || error.code === 'TIMEOUT' || error.message?.includes('timeout') || error.message?.includes('zaman aşımı')) {
            return res.status(504).json({ 
                error: `SleekFlow API'ye bağlanılamadı: Zaman aşımı (${API_TIMEOUT}ms). Lütfen tekrar deneyin.`,
                conversations: []
            });
        }
        
        if (error.status === 503 || error.code === 'NETWORK_ERROR' || (error.request && !error.response)) {
            return res.status(503).json({ 
                error: `SleekFlow API'ye bağlanılamadı. ${error.url ? `URL: ${error.url}` : ''} Lütfen internet bağlantınızı kontrol edin.`,
                conversations: []
            });
        }
        
        // Diğer hatalar
        return res.status(error.status || 500).json({ 
            error: 'Konuşmalar yüklenirken hata oluştu: ' + (error.message || 'Bilinmeyen hata'),
            conversations: []
        });
    }

    let rawConversations = allConversations;

    if (!Array.isArray(rawConversations)) {
        return res.status(500).json({ 
            error: 'API\'den beklenmeyen veri formatı geldi',
            conversations: []
        });
    }
    
    // ✅ NOT: Hamzah için filtreleme mapping'den SONRA yapılacak (fromPhone belirlendikten sonra)
    // ✅ Çünkü conversation'lardaki field'lar boş olabilir, fromPhone belirleme işlemi gerekli

    // ✅ ULTRA HIZLI MAPPING - Minimal işlem
    const mappedConversations = [];
    const len = rawConversations.length;
    
    // ✅ ÖNCE: Tüm conversation'ları map et ve fromPhone boş olanları topla
    const conversationsNeedingFromPhone = [];
    
    for (let i = 0; i < len; i++) {
        const c = rawConversations[i];
        try {
            const up = c.userProfile || {};
            const fn = up.firstName || '';
            const ln = up.lastName || '';
            
            // ✅ İsim için tüm olası field'ları sırayla dene
            const nameCandidates = [
                `${fn} ${ln}`.trim(),
                up.fullName,
                up.displayName,
                up.name,
                up.nickname,
                up.profileName,
                up.whatsappName,
                c.contactName,
                c.customerName,
                c.customer?.name,
                c.customer?.fullName,
                c.receiverName,
                c.participantName,
                c.conversationName,
                c.conversationTitle,
                c.title,
                c.name,
                c.profileName,
                c.whatsappProfileName,
                c.facebookProfileName,
                c.instagramProfileName,
                c.lastMessage?.customerName,
                c.lastMessage?.contactName,
                c.lastMessage?.senderName
            ];
            
            const contactName = nameCandidates
                .map(value => (typeof value === 'string' ? value.trim() : ''))
                .find(value => value && !/^(unknown|bilinmeyen)$/i.test(value)) || 'Bilinmeyen';
            
            // ✅ ULTRA HIZLI CHANNEL - Sadece ilk channel'ı kontrol et
            const ch = (c.lastMessageChannel || '').toLowerCase();
            let displayChannel = 'WhatsApp';
            if (ch.includes('instagram')) displayChannel = 'Instagram';
            else if (ch.includes('facebook')) displayChannel = 'Facebook';
            else if (ch.includes('sms')) displayChannel = 'SMS';
            else if (ch.includes('line')) displayChannel = 'LINE';
            else if (ch.includes('wechat') || ch.includes('weixin')) displayChannel = 'WeChat';
            else if (ch.includes('web')) displayChannel = 'Web';

            // ✅ ULTRA HIZLI LAST MESSAGE - Tek kontrol
            let lastMessage = '';
            let lastMessageType = 'text';
            if (c.lastMessage) {
                if (typeof c.lastMessage === 'string') {
                    lastMessage = c.lastMessage.trim();
                } else {
                    lastMessage = (c.lastMessage.messageContent || c.lastMessage.text || '').trim();
                    lastMessageType = c.lastMessage.messageType || 'text';
                }
            }
            if (!lastMessage) lastMessage = (c.lastMessageText || '').trim();

            // ✅ ULTRA HIZLI TIMESTAMP - Number olarak sakla
            const time = c.updatedTime || c.modifiedAt || c.updatedAt || Date.now();
            const timestamp = typeof time === 'number' ? time : new Date(time).getTime();

            // ✅ FROM numarasını bul - ÖNCE conversation'dan, yoksa lastMessage'dan
            let fromPhone = c.fromPhone || c.from || '';
            
            // ✅ Eğer fromPhone yoksa veya customer numarasına eşitse, lastMessage'dan kontrol et
            const customerPhone = up.phoneNumber || up.phone || '';
            const cleanPhone = (phone) => {
                return String(phone || '').replace(/\+/g, '').replace(/\s/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '').trim();
            };
            
            // ✅ Business numaraları listesi
            const businessNumbers = ['908505327532', '905421363421'];
            
            if (!fromPhone || (customerPhone && cleanPhone(fromPhone) === cleanPhone(customerPhone))) {
                // ✅ lastMessage'dan FROM bul (eğer varsa)
                if (c.lastMessage && typeof c.lastMessage === 'object') {
                    const lastMsgFrom = cleanPhone(c.lastMessage.from || c.lastMessage.fromPhone || c.lastMessage.senderPhone || '');
                    const lastMsgDirection = (c.lastMessage.direction || (c.lastMessage.isSentFromSleekflow ? 'sent' : 'received')).toLowerCase();
                    const isLastMsgOutgoing = lastMsgDirection === 'sent' || c.lastMessage.isSentFromSleekflow === true;
                    
                    // ✅ Sadece outgoing mesajlardan FROM al
                    if (isLastMsgOutgoing && lastMsgFrom && lastMsgFrom !== cleanPhone(customerPhone)) {
                        fromPhone = lastMsgFrom;
                    }
                }
            }
            
            // ✅ KRITIK: Eğer hala fromPhone yoksa veya customer numarasına eşitse, conversation'dan diğer field'ları kontrol et
            if (!fromPhone || (customerPhone && cleanPhone(fromPhone) === cleanPhone(customerPhone))) {
                // ✅ ÖNCE: whatsappCloudApiReceiver'dan kontrol et (daha güvenilir)
                const whatsappReceiver = c.whatsappCloudApiReceiver || c.whatsappReceiver || {};
                let channelIdentityId = cleanPhone(whatsappReceiver.whatsappChannelPhoneNumber || whatsappReceiver.channelIdentityId || whatsappReceiver.userIdentityId || '');
                
                // ✅ Eğer channelIdentityId yoksa, dynamicChannelSender'dan kontrol et
                if (!channelIdentityId) {
                    const convChannelSender = c.dynamicChannelSender || c.channelSender || {};
                    channelIdentityId = cleanPhone(convChannelSender.channelIdentityId || convChannelSender.userIdentityId || c.channelIdentityId || '');
                }
                
                // ✅ Eğer hala channelIdentityId yoksa, lastMessage'dan dynamicChannelSender kontrol et
                if (!channelIdentityId && c.lastMessage && typeof c.lastMessage === 'object') {
                    const lastMsgSender = c.lastMessage.dynamicChannelSender || c.lastMessage.channelSender || {};
                    channelIdentityId = cleanPhone(lastMsgSender.channelIdentityId || lastMsgSender.userIdentityId || '');
                    
                    // ✅ lastMessage'dan direkt FROM kontrol et
                    if (!channelIdentityId) {
                        const lastMsgFrom = cleanPhone(c.lastMessage.from || c.lastMessage.fromPhone || c.lastMessage.senderPhone || '');
                        const lastMsgDirection = (c.lastMessage.direction || (c.lastMessage.isSentFromSleekflow ? 'sent' : 'received')).toLowerCase();
                        const isLastMsgOutgoing = lastMsgDirection === 'sent' || c.lastMessage.isSentFromSleekflow === true;
                        
                        // ✅ Sadece outgoing mesajlardan FROM al ve business numarası ise kullan
                        if (isLastMsgOutgoing && lastMsgFrom && businessNumbers.includes(lastMsgFrom)) {
                            channelIdentityId = lastMsgFrom;
                        }
                    }
                }
                
                // ✅ Eğer channelIdentityId business numarası ise, onu FROM olarak kullan
                if (channelIdentityId && businessNumbers.includes(channelIdentityId)) {
                    fromPhone = channelIdentityId;
                    console.log('✅ [BACKEND] fromPhone conversation field\'larından bulundu:', {
                        conversationId: c.conversationId || c.id,
                        fromPhone,
                        channelIdentityId,
                        whatsappReceiver: whatsappReceiver.whatsappChannelPhoneNumber || whatsappReceiver.channelIdentityId || 'YOK',
                        dynamicChannelSender: (c.dynamicChannelSender || {}).channelIdentityId || 'YOK'
                    });
                } else {
                    // ✅ Fallback: Eğer hala bulunamadıysa, conversation'ın tüm field'larını kontrol et
                    // ✅ WhatsApp Cloud API için özel kontrol
                    if (ch.includes('whatsapp') || ch.includes('whatsappcloudapi')) {
                        // ✅ Conversation'dan tüm olası field'ları kontrol et
                        const possibleFromFields = [
                            c.channelIdentityId,
                            c.senderPhone,
                            c.senderIdentityId,
                            c.fromPhone,
                            c.from,
                            (c.channelConfig || {}).phoneNumber,
                            (c.channelConfig || {}).senderPhone,
                            // ✅ YENİ: Daha fazla field kontrol et
                            (c.whatsappCloudApiReceiver || {}).whatsappChannelPhoneNumber,
                            (c.whatsappCloudApiReceiver || {}).channelIdentityId,
                            (c.dynamicChannelSender || {}).channelIdentityId,
                            (c.dynamicChannelSender || {}).userIdentityId,
                            (c.lastMessage || {}).dynamicChannelSender?.channelIdentityId,
                            (c.lastMessage || {}).dynamicChannelSender?.userIdentityId
                        ];
                        
                        for (const field of possibleFromFields) {
                            const cleaned = cleanPhone(field || '');
                            if (cleaned && businessNumbers.includes(cleaned)) {
                                fromPhone = cleaned;
                                console.log('✅ [BACKEND] fromPhone possibleFromFields\'dan bulundu:', {
                                    conversationId: c.conversationId || c.id,
                                    fromPhone,
                                    field: field
                                });
                                break;
                            }
                        }
                    }
                    
                    // ✅ NOT: Conversation mesajlarını çekmeyi kaldırdık - çok yavaş ve rate limit hatası veriyor
                    // ✅ fromPhone boş kalırsa, frontend'de mesajlardan bulunacak
                    
                    // ✅ ÇÖZÜM 1: Eğer hala fromPhone yoksa, conversation mesajlarından FROM bul (optimize edilmiş)
                    if (!fromPhone) {
                        // ✅ fromPhone boş olan conversation'ı listeye ekle (sonra toplu işlenecek)
                        conversationsNeedingFromPhone.push({
                            conversationId: c.conversationId || c.id,
                            index: mappedConversations.length, // ✅ Map edilen conversation'ın index'i
                            contactName
                        });
                        fromPhone = ''; // ✅ Şimdilik boş bırak
                    }
                }
            }

            // ✅ Channel bilgilerini al (Hamzah için filtreleme için)
            const channelName = c.channelName || c.channel || c.channelConfig?.name || '';
            const channelId = c.channelId || c.channelConfig?.id || '';
            const twilioAccountId = c.twilioAccountId || c.channelConfig?.twilioAccountId || '';
            
            mappedConversations.push({
                id: c.conversationId || c.id || `c${i}`,
                conversationId: c.conversationId || c.id || `c${i}`,
                contactName,
                lastMessage,
                lastMessageType: lastMessageType.toLowerCase(),
                lastMessageTime: timestamp,
                channel: displayChannel,
                rawChannel: ch,
                unreadCount: c.unreadMessageCount || 0,
                phoneNumber: customerPhone,
                fromPhone: fromPhone, // ✅ Gerçek FROM numarası (customer numarası değil)
                toPhone: c.toPhone || c.to || '',
                // ✅ Hamzah için fallback filtreleme: Conversation'daki field'ları sakla
                rawChannelData: {
                    whatsappCloudApiReceiver: c.whatsappCloudApiReceiver || c.whatsappReceiver || {},
                    dynamicChannelSender: c.dynamicChannelSender || c.channelSender || {},
                    channelIdentityId: c.channelIdentityId || '',
                    channelName: channelName, // ✅ Channel name'i sakla
                    channelId: channelId, // ✅ Channel ID'yi sakla
                    twilioAccountId: twilioAccountId, // ✅ Twilio Account ID'yi sakla
                    conversationChannels: c.conversationChannels || [], // ✅ conversationChannels array'i
                    lastChannelIdentityId: c.lastChannelIdentityId || '' // ✅ lastChannelIdentityId
                },
                // ✅ YENİ: Raw conversation data'yı sakla (Hamzah filtreleme için)
                _rawConversation: c
            });
        } catch (e) {
            continue;
        }
    }
    
    // ✅ KRITIK: fromPhone belirleme - Hamzah için öncelikli, VIP için arka planda
    // ✅ NOT: Hamzah için strict filtering yapıyoruz, bu yüzden fromPhone belirleme öncelikli olmalı
    if (conversationsNeedingFromPhone.length > 0) {
        const cleanPhoneForCheck = (phone) => {
            return String(phone || '').replace(/\+/g, '').replace(/\s/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '').trim();
        };
        const isHamzahRequest = requestedFromPhone && cleanPhoneForCheck(requestedFromPhone) === '905421363421';
        // ✅ HIZLANDIRMA: İlk yüklemede daha az conversation işle (500 -> 200), arka planda devam et
        const maxConversationsToProcess = isHamzahRequest ? 200 : 300; // ✅ Hamzah için ilk yüklemede 200, sonra arka planda devam
        
        const conversationsToProcess = conversationsNeedingFromPhone.slice(0, maxConversationsToProcess);
        
        console.log(`🔄 [BACKEND] ${conversationsToProcess.length} conversation için FROM numarası belirleniyor (${isHamzahRequest ? 'ÖNCELİKLİ - Hamzah için strict filtering' : 'ARKA PLANDA'} - toplam ${conversationsNeedingFromPhone.length} conversation var, ilk ${maxConversationsToProcess} işleniyor)...`);
        
        // ✅ Hamzah için: Öncelikli işle (strict filtering için fromPhone gerekli)
        // ✅ VIP için: Arka planda işle (tüm conversation'lar gösteriliyor)
        const processFunction = async () => {
            const businessNumbers = ['908505327532', '905421363421'];
            const cleanPhone = (phone) => {
                return String(phone || '').replace(/\+/g, '').replace(/\s/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '').trim();
            };
            
            // ✅ HIZLANDIRMA: Daha fazla paralel işleme (5 -> 10)
            const batchSize = 10; // ✅ 5'ten 10'a çıkardık (2x daha hızlı)
            const totalBatches = Math.ceil(conversationsToProcess.length / batchSize);
            
            let successCount = 0;
            let failCount = 0;
            
            for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
                const startIndex = batchIndex * batchSize;
                const endIndex = Math.min(startIndex + batchSize, conversationsToProcess.length);
                const batch = conversationsToProcess.slice(startIndex, endIndex);
                
                // ✅ Bu batch'i paralel işle
                const batchPromises = batch.map(async (convInfo) => {
                    try {
                        // ✅ HIZLANDIRMA: Timeout'u azalt (3s -> 2s) ve sadece son 1 mesajı çek
                        const messagesResponse = await Promise.race([
                            sleekflowService.call('get', `/api/conversation/message/${convInfo.conversationId}`, {
                                params: { limit: 1, offset: 0 },
                                timeout: 2000 // ✅ HIZLANDIRMA: 3'ten 2 saniyeye düşürdük
                            }),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
                        ]);
                        
                        if (messagesResponse && messagesResponse.data && Array.isArray(messagesResponse.data) && messagesResponse.data.length > 0) {
                            const lastMsg = messagesResponse.data[0];
                            const msgDirection = (lastMsg.direction || (lastMsg.isSentFromSleekflow ? 'sent' : 'received')).toLowerCase();
                            const isOutgoing = msgDirection === 'sent' || lastMsg.isSentFromSleekflow === true;
                            
                            if (isOutgoing) {
                                const msgFrom = cleanPhone(lastMsg.from || lastMsg.fromPhone || lastMsg.senderPhone || (lastMsg.dynamicChannelSender || {}).channelIdentityId || (lastMsg.dynamicChannelSender || {}).userIdentityId || '');
                                
                                // ✅ Business numarası ise kullan
                                if (msgFrom && businessNumbers.includes(msgFrom)) {
                                    // ✅ mappedConversations'ta ilgili conversation'ı bul ve fromPhone'u güncelle
                                    const mappedConv = mappedConversations[convInfo.index];
                                    if (mappedConv && mappedConv.conversationId === convInfo.conversationId) {
                                        mappedConv.fromPhone = msgFrom;
                                        successCount++;
                                        return { success: true, conversationId: convInfo.conversationId, fromPhone: msgFrom };
                                    }
                                }
                            }
                        }
                        failCount++;
                    } catch (msgError) {
                        // ✅ Hata durumunda sessizce devam et
                        failCount++;
                        return { success: false, conversationId: convInfo.conversationId };
                    }
                    return { success: false, conversationId: convInfo.conversationId };
                });
                
                // ✅ Batch'i bekle
                await Promise.all(batchPromises);
                
                // ✅ HIZLANDIRMA: Batch arası bekleme süresini azalt (150ms -> 100ms)
                if (batchIndex < totalBatches - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100)); // ✅ HIZLANDIRMA: 150ms'den 100ms'ye düşürdük
                }
            }
            
            console.log(`✅ [BACKEND] FROM numarası belirleme tamamlandı (${isHamzahRequest ? 'ÖNCELİKLİ' : 'ARKA PLANDA'} - ${conversationsToProcess.length} conversation işlendi, ${successCount} başarılı, ${failCount} başarısız)`);
        };
        
        // ✅ HIZLANDIRMA: Hamzah için de arka planda işle (conversation'lar hemen döndürülsün)
        // ✅ NOT: lastChannelIdentityId kontrolü zaten yapılıyor, fromPhone belirleme kritik değil
        // ✅ Conversation'lar hemen döndürülüyor, fromPhone belirleme arka planda devam ediyor
        setImmediate(processFunction); // ✅ Hem VIP hem Hamzah için arka planda işle
    }

    // ✅ ULTRA HIZLI SORT - Timestamp zaten number
    mappedConversations.sort((a, b) => b.lastMessageTime - a.lastMessageTime);

    // ✅ KRITIK: fromPhone parametresi varsa, sender'a göre farklı filtreleme mantığı uygula
    let filteredConversations = mappedConversations;
    if (requestedFromPhone) {
        const cleanPhone = (phone) => {
            return String(phone || '').replace(/\+/g, '').replace(/\s/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '').trim();
        };
        const cleanRequestedPhone = cleanPhone(requestedFromPhone);
        
        // ✅ KULLANICI BAZLI FİLTRELEME: userEmail/userId'ye göre kullanıcı tipini belirle
        // ✅ Önce kullanıcı bazlı kontrol et, sonra requestedFromPhone'a göre
        let isVIP = false;
        let isHamzah = false;
        
        // ✅ Kullanıcı bazlı kontrol (userEmail/userId'den)
        if (userEmail || userId) {
            const userKey = userEmail || userId;
            // ✅ VIP kullanıcıları: info@vipproperty.com, hello@propadya.com
            if (userKey === 'info@vipproperty.com' || userKey === 'hello@propadya.com') {
                isVIP = true;
            }
            // ✅ Hamzah kullanıcıları: (şimdilik userSenderPermissions'dan kontrol edilecek)
            // TODO: Hamzah kullanıcı email/userId'sini buraya ekle
        }
        
        // ✅ Fallback: requestedFromPhone'a göre (eski mantık - geriye uyumluluk için)
        if (!isVIP && !isHamzah) {
            isVIP = cleanRequestedPhone === '908505327532';
            isHamzah = cleanRequestedPhone === '905421363421';
        }
        
        console.log(`🔍 [BACKEND] Kullanıcı bazlı filtreleme:`, {
            userEmail,
            userId,
            requestedFromPhone: cleanRequestedPhone,
            isVIP,
            isHamzah,
            source: (userEmail || userId) ? 'user-based' : 'phone-based'
        });
        
        // ✅ Hamzah için: Channel parametresi ile çekildiyse, channel kontrolü yapma
        // ✅ Channel parametresi ile çekilen conversation'lar zaten doğru kanaldan geliyor
        const hamzahChannelParamUsed = isHamzah && hamzahChannelName;
        
        // ✅ ÖNCE: fromPhone eşleşen conversation'ları bul
        const matchedConversations = mappedConversations.filter(conv => {
            const convFromPhone = cleanPhone(conv.fromPhone || '');
            return convFromPhone === cleanRequestedPhone;
        });
        
        // ✅ Sender kontrolü: Kullanıcının bu sender'a yetkisi var mı?
        const hasSenderAccess = allowedSenders.includes('*') || allowedSenders.includes(cleanRequestedPhone);
        
        if (!hasSenderAccess) {
            // ✅ Sender yetkisi yoksa boş döndür (zaten yukarıda 403 döndürülmüştü ama yine de kontrol)
            filteredConversations = [];
            console.log(`❌ [BACKEND] Sender yetkisi yok: ${cleanRequestedPhone}`);
        } else {
            // ✅ Sender yetkisi varsa, conversation'ları filtrele
            let debugCounter = 0; // ✅ Debug için counter
            filteredConversations = filteredConversations.filter(conv => {
                const convFromPhone = cleanPhone(conv.fromPhone || '');
                
                // ✅ HAMZAH İÇİN YENİ YAKLAŞIM: Raw conversation data'dan tüm field'ları kontrol et
                if (isHamzah) {
                    const rawConv = conv._rawConversation;
                    if (!rawConv) {
                        // ✅ Raw data yoksa, mevcut bilgilerle kontrol et
                        const channelName = (conv.rawChannelData?.channelName || conv.channelName || conv.channel || '').trim().toLowerCase();
                        if (channelName) {
                            const cleanName = channelName.replace(/\([^)]*\)/g, '').trim();
                            return cleanName.includes('hamzah') || cleanName.includes('coexistence') ||
                                   channelName.includes('hamzah') || channelName.includes('coexistence') ||
                                   channelName.includes('5421363421');
                        }
                        // ✅ Channel name yoksa, fromPhone kontrolü yap - Sadece eşleşiyorsa göster
                        return convFromPhone === cleanRequestedPhone;
                    }
                    
                    // ✅ Raw conversation data'dan tüm olası field'ları kontrol et
                    const hamzahNumbers = ['905421363421', '5421363421'];
                    const cleanPhoneForCheck = (phone) => {
                        return String(phone || '').replace(/\+/g, '').replace(/\s/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '').trim();
                    };
                    
                    // ✅ 0. conversationChannels array'ini kontrol et (EN ÖNEMLİ!)
                    // ✅ KRITIK: Conversation'da sadece seçili sender'a ait channel varsa göster
                    // ✅ Eğer conversation'da hem VIP hem Hamzah channel'ları varsa, conversation'ı gösterme
                    if (rawConv.conversationChannels && Array.isArray(rawConv.conversationChannels) && rawConv.conversationChannels.length > 0) {
                        // ✅ DEBUG: İlk 5 conversation için detaylı log
                        const isFirstFew = debugCounter < 5;
                        if (isFirstFew) {
                            console.log(`🔍 [BACKEND] conversationChannels kontrolü (${debugCounter + 1}. conversation):`, {
                                conversationId: rawConv.conversationId || conv.conversationId,
                                channelsCount: rawConv.conversationChannels.length,
                                channels: rawConv.conversationChannels.map((ch, idx) => ({
                                    index: idx,
                                    keys: Object.keys(ch || {}),
                                    name: ch.name || ch.channelName || ch.displayName || '(yok)',
                                    id: ch.id || ch.channelId || ch.channelIdentityId || '(yok)',
                                    phoneNumber: ch.phoneNumber || ch.whatsappChannelPhoneNumber || '(yok)'
                                }))
                            });
                        }
                        
                        // ✅ Tüm channel'ları kontrol et - Sadece seçili sender'a ait channel'lar var mı?
                        let hasHamzahChannel = false;
                        let hasVIPChannel = false;
                        
                        for (const channel of rawConv.conversationChannels) {
                            // Channel name kontrolü
                            const chName = (channel.name || channel.channelName || channel.displayName || '').trim().toLowerCase();
                            if (chName) {
                                const cleanName = chName.replace(/\([^)]*\)/g, '').trim();
                                if (cleanName.includes('hamzah') || cleanName.includes('coexistence') ||
                                    chName.includes('hamzah') || chName.includes('coexistence') ||
                                    chName.includes('5421363421')) {
                                    hasHamzahChannel = true;
                                }
                                if (cleanName.includes('vip') || cleanName.includes('proje pazarlama') ||
                                    chName.includes('vip') || chName.includes('proje pazarlama') ||
                                    chName.includes('8505327532') || chName.includes('908505327532')) {
                                    hasVIPChannel = true;
                                }
                            }
                            
                            // Channel ID veya telefon numarası kontrolü
                            const chIds = [
                                channel.id,
                                channel.channelId,
                                channel.channelIdentityId,
                                channel.twilioAccountId,
                                channel.phoneNumber,
                                channel.whatsappChannelPhoneNumber,
                                channel.userIdentityId
                            ].filter(Boolean);
                            
                            for (const chId of chIds) {
                                const cleanId = cleanPhoneForCheck(chId);
                                if (hamzahNumbers.includes(cleanId) || cleanId.includes('5421363421') || cleanId.includes('905421363421')) {
                                    hasHamzahChannel = true;
                                }
                                const vipNumbers = ['908505327532', '8505327532'];
                                if (vipNumbers.includes(cleanId) || cleanId.includes('8505327532') || cleanId.includes('908505327532')) {
                                    hasVIPChannel = true;
                                }
                            }
                        }
                        
                        // ✅ KRITIK: Conversation'da seçili sender'a ait channel varsa göster
                        // ✅ Eğer conversation'da hem VIP hem Hamzah channel'ları varsa, her iki sender'da da göster
                        // ✅ Mesajlar zaten gönderen numaraya göre filtrelenecek (frontend'de channel parametresi ile)
                        if (isHamzah) {
                            if (hasHamzahChannel) {
                                if (isFirstFew) {
                                    if (hasVIPChannel) {
                                        console.log(`✅ [BACKEND] conversationChannels'da hem Hamzah hem VIP channel var, conversation gösterilecek (mesajlar Hamzah'tan gönderilenler olacak)`);
                                    } else {
                                        console.log(`✅ [BACKEND] conversationChannels'da sadece Hamzah channel var, conversation gösterilecek`);
                                    }
                                }
                                return true; // ✅ Hamzah channel'ı varsa göster (VIP channel'ı da olsa bile)
                            }
                        }
                        
                        if (isFirstFew) {
                            console.log(`❌ [BACKEND] conversationChannels'da eşleşme bulunamadı`);
                        }
                    } else {
                        // ✅ DEBUG: conversationChannels yoksa veya boşsa
                        if (debugCounter < 5) {
                            console.log(`⚠️ [BACKEND] conversationChannels yok veya boş (${debugCounter + 1}. conversation):`, {
                                conversationId: rawConv.conversationId || conv.conversationId,
                                hasConversationChannels: !!rawConv.conversationChannels,
                                isArray: Array.isArray(rawConv.conversationChannels),
                                length: rawConv.conversationChannels ? rawConv.conversationChannels.length : 0
                            });
                        }
                    }
                    
                    // ✅ 1. lastChannelIdentityId kontrolü (EN ÖNEMLİ - log'da görüldü: '905421363421')
                    if (rawConv.lastChannelIdentityId) {
                        const cleanId = cleanPhoneForCheck(rawConv.lastChannelIdentityId);
                        // ✅ DEBUG: İlk 5 conversation için log
                        const isFirstFew = debugCounter < 5;
                        if (isFirstFew) {
                            console.log(`🔍 [BACKEND] lastChannelIdentityId kontrolü (${debugCounter + 1}. conversation):`, {
                                conversationId: rawConv.conversationId || conv.conversationId,
                                lastChannelIdentityId: rawConv.lastChannelIdentityId,
                                cleanId: cleanId,
                                hamzahNumbers: hamzahNumbers,
                                includesCheck: hamzahNumbers.includes(cleanId),
                                includes5421: cleanId.includes('5421363421'),
                                includes9054: cleanId.includes('905421363421'),
                                willMatch: hamzahNumbers.includes(cleanId) || cleanId.includes('5421363421') || cleanId.includes('905421363421')
                            });
                        }
                        if (hamzahNumbers.includes(cleanId) || cleanId.includes('5421363421') || cleanId.includes('905421363421')) {
                            if (isFirstFew) {
                                console.log(`✅ [BACKEND] lastChannelIdentityId EŞLEŞTİ! Conversation filtrelenecek.`);
                            }
                            debugCounter++;
                            return true;
                        }
                    }
                    
                    // ✅ 2. Channel name kontrolü (diğer field'lardan)
                    const rawChannelName = (rawConv.channelName || rawConv.channel || rawConv.channelConfig?.name || '').trim().toLowerCase();
                    if (rawChannelName) {
                        const cleanName = rawChannelName.replace(/\([^)]*\)/g, '').trim();
                        if (cleanName.includes('hamzah') || cleanName.includes('coexistence') ||
                            rawChannelName.includes('hamzah') || rawChannelName.includes('coexistence') ||
                            rawChannelName.includes('5421363421')) {
                            return true;
                        }
                    }
                    
                    // ✅ 3. Channel ID veya telefon numarası kontrolü (diğer field'lardan)
                    // ✅ KRİTİK: lastChannelIdentityId'yi de ekle!
                    const allPossibleIds = [
                        rawConv.lastChannelIdentityId, // ✅ EN ÖNEMLİ - log'da görüldü!
                        rawConv.channelId,
                        rawConv.channelIdentityId,
                        rawConv.twilioAccountId,
                        rawConv.channelConfig?.id,
                        rawConv.channelConfig?.twilioAccountId,
                        rawConv.whatsappCloudApiReceiver?.whatsappChannelPhoneNumber,
                        rawConv.whatsappCloudApiReceiver?.channelIdentityId,
                        rawConv.dynamicChannelSender?.channelIdentityId,
                        rawConv.dynamicChannelSender?.userIdentityId,
                        rawConv.fromPhone,
                        rawConv.from
                    ].filter(Boolean);
                    
                    for (const id of allPossibleIds) {
                        const cleanId = cleanPhoneForCheck(id);
                        if (hamzahNumbers.includes(cleanId) || cleanId.includes('5421363421') || cleanId.includes('905421363421')) {
                            return true;
                        }
                    }
                    
                    // ✅ 4. fromPhone kontrolü KALDIRILDI
                    // ✅ Çünkü fromPhone en son mesajın gönderildiği numarayı gösteriyor
                    // ✅ Bu yüzden conversation sadece o numaranın sender'ında görünüyor
                    // ✅ Ama kullanıcı istediği şey: Conversation'ın her iki sender'da da görünmesi
                    // ✅ Bu yüzden sadece conversationChannels kontrolü yeterli
                    // ✅ Eğer conversationChannels'da Hamzah channel'ı varsa, conversation gösterilecek (yukarıda kontrol edildi)
                    debugCounter++;
                    return false; // ✅ conversationChannels kontrolü yukarıda yapıldı, eşleşmediyse false döndür
                }
                
                // ✅ VIP VE HAMZAH İÇİN: lastChannelIdentityId + conversationChannels kontrolü
                if (isVIP || isHamzah) {
                    const rawConv = conv._rawConversation;
                    if (rawConv) {
                        // ✅ cleanPhoneForCheck fonksiyonunu burada tanımla (scope için)
                        const cleanPhoneForCheck = (phone) => {
                            return String(phone || '').replace(/\+/g, '').replace(/\s/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '').trim();
                        };
                        const isFirstFew = debugCounter < 5;
                        
                        // ✅ ÖNCE: conversationChannels kontrolü (EN ÖNEMLİ!)
                        // ✅ Conversation'da sadece seçili sender'a ait channel varsa göster
                        // ✅ Eğer conversation'da hem VIP hem Hamzah channel'ları varsa, conversation'ı gösterme
                        if (rawConv.conversationChannels && Array.isArray(rawConv.conversationChannels) && rawConv.conversationChannels.length > 0) {
                            let hasHamzahChannel = false;
                            let hasVIPChannel = false;
                            
                            for (const channel of rawConv.conversationChannels) {
                                const chName = (channel.name || channel.channelName || channel.displayName || '').trim().toLowerCase();
                                if (chName) {
                                    const cleanName = chName.replace(/\([^)]*\)/g, '').trim();
                                    if (cleanName.includes('hamzah') || cleanName.includes('coexistence') ||
                                        chName.includes('hamzah') || chName.includes('coexistence') ||
                                        chName.includes('5421363421')) {
                                        hasHamzahChannel = true;
                                    }
                                    if (cleanName.includes('vip') || cleanName.includes('proje pazarlama') ||
                                        chName.includes('vip') || chName.includes('proje pazarlama') ||
                                        chName.includes('8505327532') || chName.includes('908505327532')) {
                                        hasVIPChannel = true;
                                    }
                                }
                                
                                const chIds = [
                                    channel.id,
                                    channel.channelId,
                                    channel.channelIdentityId,
                                    channel.twilioAccountId,
                                    channel.phoneNumber,
                                    channel.whatsappChannelPhoneNumber,
                                    channel.userIdentityId
                                ].filter(Boolean);
                                
                                for (const chId of chIds) {
                                    const cleanId = cleanPhoneForCheck(chId);
                                    const hamzahNumbers = ['905421363421', '5421363421'];
                                    const vipNumbers = ['908505327532', '8505327532'];
                                    if (hamzahNumbers.includes(cleanId) || cleanId.includes('5421363421') || cleanId.includes('905421363421')) {
                                        hasHamzahChannel = true;
                                    }
                                    if (vipNumbers.includes(cleanId) || cleanId.includes('8505327532') || cleanId.includes('908505327532')) {
                                        hasVIPChannel = true;
                                    }
                                }
                            }
                            
                            // ✅ KRITIK: Conversation'da seçili sender'a ait channel varsa göster
                            // ✅ AMA: Eğer conversation'da hem VIP hem Hamzah channel'ları varsa, conversation'daki mesajları kontrol et
                            // ✅ Sadece seçili sender'dan mesaj gönderilmişse conversation'ı göster
                            if (isVIP) {
                                if (hasVIPChannel && !hasHamzahChannel) {
                                    // ✅ Sadece VIP channel'ı varsa, conversation'ı göster
                                    if (isFirstFew) {
                                        console.log(`✅ [BACKEND] VIP - conversationChannels'da sadece VIP channel var, conversation gösterilecek`);
                                    }
                                    debugCounter++;
                                    return true;
                                } else if (hasVIPChannel && hasHamzahChannel) {
                                    // ✅ Hem VIP hem Hamzah channel'ları varsa, conversation'daki mesajları kontrol et
                                    // ✅ Sadece VIP'den mesaj gönderilmişse conversation'ı göster
                                    // ✅ NOT: Mesaj kontrolü yapılacak (aşağıda)
                                    if (isFirstFew) {
                                        console.log(`🔍 [BACKEND] VIP - conversationChannels'da hem VIP hem Hamzah channel var, mesaj kontrolü yapılacak`);
                                    }
                                    // ✅ Mesaj kontrolü aşağıda yapılacak, burada false döndürme
                                }
                            }
                            
                            if (isHamzah) {
                                if (hasHamzahChannel && !hasVIPChannel) {
                                    // ✅ Sadece Hamzah channel'ı varsa, conversation'ı göster
                                    if (isFirstFew) {
                                        console.log(`✅ [BACKEND] Hamzah - conversationChannels'da sadece Hamzah channel var, conversation gösterilecek`);
                                    }
                                    debugCounter++;
                                    return true;
                                } else if (hasHamzahChannel && hasVIPChannel) {
                                    // ✅ Hem VIP hem Hamzah channel'ları varsa, conversation'daki mesajları kontrol et
                                    // ✅ Sadece Hamzah'tan mesaj gönderilmişse conversation'ı göster
                                    // ✅ NOT: Mesaj kontrolü yapılacak (aşağıda)
                                    if (isFirstFew) {
                                        console.log(`🔍 [BACKEND] Hamzah - conversationChannels'da hem VIP hem Hamzah channel var, mesaj kontrolü yapılacak`);
                                    }
                                    // ✅ Mesaj kontrolü aşağıda yapılacak, burada false döndürme
                                }
                            }
                        }
                        
                        // ✅ NOT: lastChannelIdentityId kontrolü KALDIRILDI
                        // ✅ Çünkü lastChannelIdentityId en son mesajın gönderildiği numarayı gösteriyor
                        // ✅ Bu yüzden conversation sadece o numaranın sender'ında görünüyor
                        // ✅ Ama kullanıcı istediği şey: Conversation'ın her iki sender'da da görünmesi
                        // ✅ Bu yüzden sadece conversationChannels kontrolü yeterli
                    }
                }
                
                // ✅ VIP ve diğer sender'lar için normal filtreleme
                // ✅ NOT: VIP ve Hamzah için conversationChannels kontrolü yukarıda yapıldı
                // ✅ Eğer conversation'da hem VIP hem Hamzah channel'ları varsa, fromPhone kontrolü yapılacak
                debugCounter++;
                let senderMatch = false;
                
                // ✅ Raw conversation data'yı kontrol et
                const rawConv = conv._rawConversation;
                
                if (isVIP || isHamzah) {
                    // ✅ KRITIK: Eğer conversation'da hem VIP hem Hamzah channel'ları varsa, fromPhone kontrolü yap
                    // ✅ Sadece seçili sender'dan mesaj gönderilmiş conversation'ları göster
                    // ✅ Bu sayede aynı kişiyle farklı numaralardan mesajlaşma ayrı conversation'lar olarak görünecek
                    const hasBothChannels = rawConv && rawConv.conversationChannels && Array.isArray(rawConv.conversationChannels) && rawConv.conversationChannels.length > 0;
                    
                    if (hasBothChannels) {
                        // ✅ Conversation'da hem VIP hem Hamzah channel'ları varsa, fromPhone kontrolü yap
                        let hasVIPChannel = false;
                        let hasHamzahChannel = false;
                        
                        for (const channel of rawConv.conversationChannels) {
                            const chName = (channel.name || channel.channelName || channel.displayName || '').trim().toLowerCase();
                            if (chName) {
                                const cleanName = chName.replace(/\([^)]*\)/g, '').trim();
                                if (cleanName.includes('hamzah') || cleanName.includes('coexistence') ||
                                    chName.includes('hamzah') || chName.includes('coexistence') ||
                                    chName.includes('5421363421')) {
                                    hasHamzahChannel = true;
                                }
                                if (cleanName.includes('vip') || cleanName.includes('proje pazarlama') ||
                                    chName.includes('vip') || chName.includes('proje pazarlama') ||
                                    chName.includes('8505327532') || chName.includes('908505327532')) {
                                    hasVIPChannel = true;
                                }
                            }
                        }
                        
                        if (hasVIPChannel && hasHamzahChannel) {
                            // ✅ Hem VIP hem Hamzah channel'ları varsa, konuşma HER İKİ listede de görünsün
                            // ✅ Ayrışma mesaj seviyesinde yapılır (fromPhone ile); listede iki ayrı ekran gibi göstermek için
                            senderMatch = true;
                            if (debugCounter < 5) {
                                console.log(`🔍 [BACKEND] ${isVIP ? 'VIP' : 'Hamzah'} - Hem VIP hem Hamzah channel var, konuşma her iki listede de gösterilecek (mesajlar fromPhone ile filtrelenecek)`);
                            }
                        } else {
                            // ✅ Sadece bir channel varsa, channel kontrolü yeterli (yukarıda yapıldı)
                            senderMatch = true;
                        }
                    } else {
                        // ✅ conversationChannels yoksa veya boşsa, channel kontrolü yeterli (yukarıda yapıldı)
                        senderMatch = true;
                    }
                } else {
                    // ✅ Diğer sender'lar için: Sadece fromPhone kontrolü
                    senderMatch = convFromPhone === cleanRequestedPhone;
                }
                
                // ✅ KANAL KONTROLÜ: Önce kullanıcı bazlı, sonra sender bazlı otomatik kontrol
                let channelMatch = true; // Default: Tüm kanallar
                
                // ✅ ÖNCE: Kullanıcı bazlı kanal kontrolü (eğer tanımlanmışsa)
                if (!allowedChannels.includes('*')) {
                    const channelName = (conv.rawChannelData?.channelName || conv.channelName || conv.channel || '').trim();
                    channelMatch = allowedChannels.some(allowedChannel => {
                        if (allowedChannel === '*') return true;
                        return channelName.toLowerCase().includes(allowedChannel.toLowerCase()) ||
                               allowedChannel.toLowerCase().includes(channelName.toLowerCase());
                    });
                }
                // ✅ SONRA: Sender bazlı otomatik kanal kontrolü (kullanıcı bazlı kontrol yoksa)
                else {
                    // ✅ VIP için: Kanal filtresi YOK - tüm conversation'lar gösterilir (önceki davranış)
                    // ✅ "vip"/"proje pazarlama" kontrolü kaldırıldı - WhatsApp/Instagram vb. hepsi görünüyordu, şimdi 0 geliyordu
                    if (isVIP) {
                        channelMatch = true; // VIP her zaman tüm konuşmaları görsün
                    }
                }
                
                // ✅ DEBUG: İlk birkaç conversation için detaylı log
                if (filteredConversations.length < 5) {
                    const channelName = (conv.rawChannelData?.channelName || conv.channelName || conv.channel || '').trim();
                    console.log(`🔍 [BACKEND] Conversation filtreleme:`, {
                        conversationId: conv.conversationId || conv.id,
                        contactName: conv.contactName,
                        fromPhone: convFromPhone || '(boş)',
                        channelName: channelName || '(boş)',
                        senderMatch: senderMatch,
                        channelMatch: channelMatch,
                        isVIP: isVIP,
                        isHamzah: isHamzah,
                        rawChannelData: conv.rawChannelData || {}
                    });
                }
                
                return senderMatch && channelMatch;
            });
            
            const channelControlActive = !allowedChannels.includes('*') || isVIP || isHamzah;
            const controlType = !allowedChannels.includes('*') ? 'kullanıcı bazlı' : (isVIP ? 'VIP otomatik' : (isHamzah ? 'Hamzah otomatik' : 'pasif'));
            console.log(`✅ [BACKEND] Filtreleme tamamlandı: ${filteredConversations.length} conversation bulundu (fromPhone eşleşen: ${matchedConversations.length}, toplam: ${mappedConversations.length}, sender: ${cleanRequestedPhone}, kanal kontrolü: ${controlType})`);
        }
    }

    // ✅ LEAD NAME FİLTRELEME: leadName query'den VEYA leadId ile Zoho'dan alınan isim
    let leadFilteredConversations = filteredConversations;
    let reqLeadName = typeof reqLeadNameParam === 'string' ? reqLeadNameParam.trim() : '';
    if (!reqLeadName && reqLeadIdParam) {
        const leadIdTrim = String(reqLeadIdParam).trim();
        const { isValidLeadId } = require('../utils/validation');
        if (leadIdTrim && isValidLeadId(leadIdTrim)) {
            try {
                const leadRes = await zohoGet(`/crm/v2/Leads/${leadIdTrim}`);
                if (leadRes && leadRes.data && leadRes.data[0]) {
                    const ld = leadRes.data[0];
                    reqLeadName = (ld.Full_Name != null ? String(ld.Full_Name).trim() : '') || [ld.First_Name, ld.Last_Name].filter(Boolean).map(s => String(s).trim()).join(' ').trim();
                    logger.info('Lead ismi leadId ile Zoho\'dan alındı', { leadId: leadIdTrim, Full_Name: reqLeadName });
                }
            } catch (err) {
                logger.warn('Lead ismi Zoho\'dan alınamadı (leadId ile filtre atlanıyor)', { leadId: String(reqLeadIdParam).trim(), error: err.message });
            }
        }
    }
    if (reqLeadName) {
        const normalizeNameBackend = (name) => {
            if (!name || typeof name !== 'string') return '';
            return String(name)
                .toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
                .replace(/\s+/g, ' ').trim();
        };
        const matchNamesBackend = (leadName, convName) => {
            if (!leadName || !convName) return false;
            const nLead = normalizeNameBackend(leadName);
            const nConv = normalizeNameBackend(convName);
            if (nLead === nConv) return true;
            if (nConv.includes(nLead) && nLead.length >= 3) return true;
            const leadWords = nLead.split(' ').filter(w => w.length >= 2);
            const convWords = nConv.split(' ').filter(w => w.length >= 2);
            if (leadWords.length > 0 && convWords.length > 0) {
                const matching = leadWords.filter(lw => convWords.some(cw => cw === lw));
                if (matching.length >= Math.min(2, leadWords.length) || (leadWords.length === 1 && leadWords[0].length >= 3 && matching.length === 1)) return true;
            }
            return false;
        };
        leadFilteredConversations = filteredConversations.filter(conv => {
            const raw = conv._rawConversation || {};
            const candidates = [
                conv.contactName,
                conv.displayName,
                conv.customerName,
                raw.customer?.name,
                raw.customer?.fullName,
                raw.userProfile?.firstName && raw.userProfile?.lastName ? `${raw.userProfile.firstName} ${raw.userProfile.lastName}`.trim() : '',
                raw.userProfile?.firstName,
                raw.userProfile?.lastName,
                raw.conversationName,
                raw.whatsappProfileName,
                raw.instagramProfileName
            ].filter(Boolean).map(s => (typeof s === 'string' ? s.trim() : ''));
            for (const c of candidates) {
                if (c && !/^(bilinmeyen|unknown)$/i.test(c) && matchNamesBackend(reqLeadName, c)) return true;
            }
            return false;
        });
        logger.info('Lead filtreleme uygulandı (sadece leadName)', { leadName: reqLeadName, before: filteredConversations.length, after: leadFilteredConversations.length });
    }

    // ✅ KRITIK: Conversation mapping - Her conversation için gönderen numarasına göre ayrı ID'ler oluştur
    // ✅ Aynı conversation'ı farklı numaralardan mesajlaşma yapıldığında ayrı conversation'lar gibi göstermek için
    const senderMappedConversations = leadFilteredConversations.map(conv => {
        const originalConvId = conv.conversationId || conv.id;
        
        // ✅ Eğer fromPhone parametresi varsa, conversation ID'sine gönderen numarasını ekle
        if (requestedFromPhone) {
            const cleanRequestedPhone = cleanPhone(requestedFromPhone);
            const isVIP = cleanRequestedPhone === '908505327532';
            const isHamzah = cleanRequestedPhone === '905421363421';
            
            // ✅ Conversation ID'sine gönderen numarasını ekle
            let mappedConvId = originalConvId;
            if (isVIP) {
                mappedConvId = `${originalConvId}_vip`;
            } else if (isHamzah) {
                mappedConvId = `${originalConvId}_hamzah`;
            } else {
                mappedConvId = `${originalConvId}_${cleanRequestedPhone}`;
            }
            
            // ✅ Yeni conversation objesi oluştur
            const mappedConv = {
                ...conv,
                conversationId: mappedConvId,
                id: mappedConvId,
                originalConversationId: originalConvId, // ✅ Orijinal ID'yi sakla (mesaj göndermek için)
                senderPhone: cleanRequestedPhone, // ✅ Gönderen numarasını sakla
                mappedForSender: true // ✅ Mapping yapıldığını işaretle
            };
            
            return mappedConv;
        }
        
        // ✅ fromPhone parametresi yoksa, conversation'ı olduğu gibi döndür
        return conv;
    });
    
    console.log(`✅ [BACKEND] Conversation mapping: ${senderMappedConversations.length} conversation döndürüldü (orijinal: ${filteredConversations.length}, fromPhone: ${requestedFromPhone || 'yok'})`);
    
    res.json({ conversations: senderMappedConversations });
}));

/**
 * GET /api/sleekflow/conversations/:id/messages
 * Mesaj listesi - HIZLI YÜKLEME: İlk yüklemede son mesajlar, lazy load için tüm mesajlar
 */
router.get('/conversations/:id/messages', asyncHandler(async (req, res, next) => {
    let { id } = req.params;
    
    // ✅ KRITIK: Conversation ID mapping - Eğer ID'de _vip veya _hamzah varsa, orijinal ID'yi al
    // ✅ Frontend'den gelen mapped ID'yi orijinal ID'ye çevir
    let originalConversationId = id;
    if (id.includes('_vip') || id.includes('_hamzah') || (id.includes('_') && id.split('_').length > 1)) {
        // ✅ Mapped ID'den orijinal ID'yi çıkar
        const parts = id.split('_');
        originalConversationId = parts[0]; // ✅ İlk kısım orijinal ID
        console.log(`✅ [BACKEND] Conversation ID mapping (GET messages): ${id} -> ${originalConversationId}`);
    }
    
    // ✅ Orijinal conversation ID'sini kullan
    id = originalConversationId;
    
    const { limit, offset: queryOffset, apiKey, baseUrl, channel: filterChannel, fromPhone: filterFromPhone } = req.query; // Query parametreleri
    
    // ✅ KRITIK: Query parametrelerinden gelen API key'i kullan (frontend'den gönderiliyor)
    const apiKeyToUse = apiKey || sleekflowApiKey;
    const baseUrlToUse = baseUrl || sleekflowBaseUrl;
    
    if (!apiKeyToUse) {
        return res.status(401).json({ 
            error: 'Sleekflow bağlantısı yok. Lütfen API anahtarınızı girin ve bağlanın.',
            messages: []
        });
    }

    // ✅ KRITIK: baseUrl null/undefined/boş string kontrolü
    try {
        let finalBaseUrl = 'https://api.sleekflow.io'; // Default
        if (baseUrlToUse && typeof baseUrlToUse === 'string' && baseUrlToUse.trim() && baseUrlToUse.trim() !== 'undefined') {
            finalBaseUrl = baseUrlToUse.trim();
        } else if (sleekflowBaseUrl && typeof sleekflowBaseUrl === 'string' && sleekflowBaseUrl.trim() && sleekflowBaseUrl.trim() !== 'undefined') {
            finalBaseUrl = sleekflowBaseUrl.trim();
        }
        sleekflowService.setCredentials(apiKeyToUse, finalBaseUrl);
    } catch (credError) {
        logger.error('Messages endpoint - Credentials set hatası', { error: credError.message });
        return res.status(500).json({ 
            error: 'API anahtarı ayarlanırken hata oluştu: ' + (credError.message || 'Bilinmeyen hata'),
            messages: []
        });
    }

    // ✅ HIZLI YÜKLEME: Eğer limit varsa sadece o kadar mesaj çek (ilk yükleme için)
    if (limit && parseInt(limit) > 0) {
        const limitNum = parseInt(limit);
        const offsetNum = parseInt(queryOffset) || 0;
        
        try {
            const data = await sleekflowService.call('get', `/api/conversation/message/${id}`, {
                params: { 
                    limit: limitNum, 
                    offset: offsetNum 
                }
            });
            
            const rawMessages = Array.isArray(data) ? data : (data.data || data.messages || []);
            
            if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
                return res.json({ messages: [], total: 0, fetched: 0 });
            }
            
            // ✅ ANINDA MAPPING - Minimum işlem, maksimum hız
            const mappedMessages = [];
            const msgLen = rawMessages.length;
            const now = Date.now();
            
            for (let i = 0; i < msgLen; i++) {
                const m = rawMessages[i];
                // ✅ EN HIZLI - Sadece gerekli alanlar
                const ts = m.timestamp 
                    ? (typeof m.timestamp === 'number' ? (m.timestamp < 10000000000 ? m.timestamp * 1000 : m.timestamp) : new Date(m.timestamp).getTime())
                    : now;

                const messageText = (m.messageContent || m.text || '');
                const channel = (m.channel || '').toLowerCase();
                const messageType = (m.messageType || m.type || 'text').toLowerCase();
                const ds = m.dynamicChannelSender || m.channelSender || {};
                const msgFrom = m.from || m.fromPhone || m.senderPhone || ds.channelIdentityId || ds.userIdentityId || '';
                
                // ✅ KRITIK: fileUrl ve fileType extraction - uploadedFiles kontrolü EKLENDİ
                let fileUrl = '';
                let fileName = '';
                let fileType = '';
                
                if (m.uploadedFiles && Array.isArray(m.uploadedFiles) && m.uploadedFiles.length > 0) {
                    const f = m.uploadedFiles[0];
                    fileUrl = (f.url || f.link || f.fileUrl || '').trim();
                    fileName = (f.filename || f.name || f.originalName || f.fileName || '').trim();
                    fileType = (f.type || f.mimeType || f.fileType || '').trim();
                } else if (m.fileUrl || m.url) {
                    fileUrl = (m.fileUrl || m.url || '').trim();
                    fileName = (m.fileName || m.filename || '').trim();
                    fileType = (m.fileType || m.mimeType || '').trim();
                }
                
                // null kontrolü
                if (fileUrl === null) fileUrl = '';
                if (fileName === null) fileName = '';
                if (fileType === null) fileType = '';
                
                mappedMessages.push({
                    id: m.id || m.message_id || `msg_${offsetNum + i}`,
                    conversationId: id,
                    text: messageText,
                    messageContent: messageText,
                    content: messageText,
                    timestamp: ts,
                    createdAt: new Date(ts),
                    direction: (m.direction || 'received').toLowerCase(),
                    channel: channel,
                    messageType: messageType,
                    type: messageType,
                    fileUrl: fileUrl,
                    fileName: fileName,
                    fileType: fileType,
                    url: fileUrl,
                    mimeType: fileType,
                    uploadedFiles: m.uploadedFiles || [],
                    isSentFromSleekflow: !!m.isSentFromSleekflow,
                    isStory: !!(m.isStory || (channel.includes('instagram') && messageType === 'story')),
                    from: msgFrom,
                    fromPhone: msgFrom,
                    senderPhone: msgFrom
                });
            }
            
            // ✅ SIRALAMA KALDIRILDI - Hız için (frontend'de sıralanabilir)
            
            // ✅ Channel filtreleme: Eğer channel parametresi varsa, sadece o channel'dan mesajları göster
            // ✅ NOT: Conversation'lar zaten backend'de doğru kanala göre filtrelenmiş geliyor
            // ✅ O yüzden mesajları çekerken sadece WhatsApp mesajlarını filtrelemek yeterli (VIP ve Hamzah için aynı mantık)
            let finalMessages = mappedMessages;
            if (filterChannel && filterChannel !== '') {
                const fc = filterChannel.toLowerCase();
                finalMessages = mappedMessages.filter(msg => {
                    const msgChannel = (msg.channel || '').toLowerCase();
                    // ✅ WhatsApp filtreleme: Instagram ve Facebook hariç
                    if (fc === 'whatsapp') {
                        return msgChannel.includes('whatsapp') && !msgChannel.includes('instagram') && !msgChannel.includes('facebook');
                    }
                    return msgChannel.includes(fc);
                });
            }
            
            // ✅ FROM filtreleme (fast path): Aynı conversation'da VIP/Hamzah ayrı ekranlar için
            if (filterFromPhone && filterFromPhone !== '') {
                const cleanPhone = (p) => String(p || '').replace(/\+/g, '').replace(/\s/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '').trim();
                const cleanFilterFromPhone = cleanPhone(filterFromPhone);
                finalMessages = finalMessages.filter(msg => {
                    const dir = (msg.direction || (msg.isSentFromSleekflow ? 'sent' : 'received')).toLowerCase();
                    const isOutgoing = dir === 'sent' || msg.isSentFromSleekflow === true;
                    if (!isOutgoing) return true;
                    const mf = cleanPhone(msg.from || msg.fromPhone || msg.senderPhone || '');
                    return mf === cleanFilterFromPhone;
                });
            }
            
            return res.json({ 
                messages: finalMessages,
                total: finalMessages.length,
                fetched: finalMessages.length,
                hasMore: rawMessages.length === limitNum // Eğer limit kadar mesaj geldiyse daha fazla olabilir
            });
        } catch (error) {
            // ✅ Hata durumunda sessizce geç, tüm mesajları çekmeyi dene
            logger.error('Hızlı mesaj çekme hatası, tüm mesajlar çekilecek', { error: error.message });
            // Devam et, aşağıdaki kod tüm mesajları çekecek
        }
    }

    // ✅ TÜM MESAJLARI ÇEK - SADECE LAZY LOAD İÇİN (limit yoksa veya çok büyükse)
    // ⚠️ NOT: İlk yüklemede limit=20 kullanılıyor, bu kısım sadece lazy load için
    // Eğer limit varsa ve 1000'den küçükse, bu kısım çalışmamalı
    if (limit && parseInt(limit) > 0 && parseInt(limit) < 1000) {
        // Limit var ve 1000'den küçükse, zaten yukarıda işlendi
        return res.json({ messages: [], total: 0, fetched: 0, error: 'Limit zaten işlendi' });
    }
    
    const allMessages = [];
    const pageSize = 1000; // ✅ API max limit (2000 değil, 1000!)
    let offset = 0;
    let hasMore = true;
    let totalFetched = 0;

    while (hasMore) {
        try {
            const data = await sleekflowService.call('get', `/api/conversation/message/${id}`, {
                params: { 
                    limit: pageSize, 
                    offset: offset 
                }
            });

            const rawMessages = Array.isArray(data) ? data : (data.data || data.messages || []);

            if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
                hasMore = false;
                break;
            }

            // ✅ ULTRA HIZLI MESSAGE MAPPING - for loop kullan (map'ten daha hızlı)
            const mappedMessages = [];
            const msgLen = rawMessages.length;
            for (let i = 0; i < msgLen; i++) {
                const m = rawMessages[i];
                try {
                    let timestamp;
                    if (m.timestamp) {
                        timestamp = typeof m.timestamp === 'number' 
                            ? (m.timestamp < 10000000000 ? new Date(m.timestamp * 1000) : new Date(m.timestamp))
                            : new Date(m.timestamp);
                    } else {
                        timestamp = new Date(m.createdAt || m.created_at || Date.now());
                    }

                    // ✅ GENİŞLETİLMİŞ TEXT EXTRACTION - Olduğu gibi, trim yok (boşluk/satır/sembol korunur)
                    let messageText = '';
                    if (m.messageContent && typeof m.messageContent === 'string') {
                        messageText = m.messageContent;
                    } else if (m.text && typeof m.text === 'string') {
                        messageText = m.text;
                    } else if (m.body && typeof m.body === 'string') {
                        messageText = m.body;
                    } else if (m.content && typeof m.content === 'string') {
                        messageText = m.content;
                    } else if (m.caption && typeof m.caption === 'string') {
                        messageText = m.caption;
                    } else if (m.message && typeof m.message === 'string') {
                        messageText = m.message;
                    } else if (m.value && typeof m.value === 'string') {
                        messageText = m.value;
                    }
                    if (!messageText && m.messageContent && typeof m.messageContent === 'object') {
                        messageText = m.messageContent.text || m.messageContent.content || m.messageContent.body || '';
                    }
                    if (!messageText && m.data && typeof m.data === 'object') {
                        messageText = m.data.text || m.data.content || m.data.messageContent || '';
                    }

                    // Channel bilgisini al
                    const channel = (m.channel || m.channelName || '').toLowerCase();
                    
                    // ✅ HIZLI FILE EXTRACTION - İlk bulunan file'ı al
                    let fileUrl = '';
                    let fileName = '';
                    let fileType = '';
                    
                    if (m.uploadedFiles && Array.isArray(m.uploadedFiles) && m.uploadedFiles.length > 0) {
                        const f = m.uploadedFiles[0];
                        fileUrl = f.url || f.link || f.fileUrl || '';
                        fileName = f.filename || f.name || '';
                        fileType = f.type || f.mimeType || '';
                    } else if (m.fileUrl || m.url) {
                        fileUrl = m.fileUrl || m.url || '';
                        fileName = m.fileName || m.filename || '';
                        fileType = m.fileType || m.mimeType || '';
                    }
                    
                    // null kontrolü
                    if (fileUrl === null) fileUrl = '';
                    if (fileName === null) fileName = '';
                    if (fileType === null) fileType = '';
                    
                    const messageType = (m.messageType || m.type || 'text').toLowerCase();
                    
                    // Story kontrolü - Instagram story mesajları için
                    const isStory = !!(m.isStory || m.story || m.isStoryReply || (channel.includes('instagram') && (m.messageType === 'story' || m.type === 'story')));
                    
                    mappedMessages.push({
                        id: m.id || m.message_id || m.messageId || `msg_${totalFetched + i}`,
                        conversationId: id,
                        text: messageText,
                        messageContent: messageText,
                        content: messageText,
                        timestamp: timestamp.getTime(),
                        createdAt: timestamp,
                        direction: (m.direction || (m.isSentFromSleekflow ? 'sent' : 'received')).toLowerCase(),
                        channel: channel,
                        messageType: messageType,
                        type: messageType,
                        fileUrl: fileUrl,
                        fileName: fileName,
                        fileType: fileType,
                        url: fileUrl,
                        mimeType: fileType,
                        isSentFromSleekflow: m.isSentFromSleekflow || (m.direction || '').toLowerCase() === 'sent',
                        isStory: isStory
                    });
                } catch (mapError) {
                    // Sessizce geç, mesajı atla
                    continue;
                }
            }

            allMessages.push(...mappedMessages);
            totalFetched += rawMessages.length;

            // Eğer dönen mesaj sayısı pageSize'dan azsa, daha fazla mesaj yok demektir
            if (rawMessages.length < pageSize) {
                hasMore = false;
                break;
            }

            offset += pageSize;

            logger.info('Mesaj sayfası çekildi', { 
                conversationId: id, 
                pageOffset: offset - pageSize, 
                fetched: rawMessages.length, 
                total: allMessages.length 
            });
        } catch (error) {
            logger.error('Mesaj çekme hatası', { error: error.message, offset });
            // Hata durumunda mevcut mesajları döndür
            break;
        }
    }

    // ✅ Channel filtreleme: Eğer channel parametresi varsa, sadece o channel'dan mesajları göster
    // ✅ NOT: Conversation'lar zaten backend'de doğru kanala göre filtrelenmiş geliyor
    // ✅ O yüzden mesajları çekerken sadece WhatsApp mesajlarını filtrelemek yeterli (VIP ve Hamzah için aynı mantık)
    let finalMessages = allMessages;
    if (filterChannel && filterChannel !== '') {
        const fc = filterChannel.toLowerCase();
        finalMessages = allMessages.filter(msg => {
            const msgChannel = (msg.channel || '').toLowerCase();
            // ✅ WhatsApp filtreleme: Instagram ve Facebook hariç
            if (fc === 'whatsapp') {
                return msgChannel.includes('whatsapp') && !msgChannel.includes('instagram') && !msgChannel.includes('facebook');
            }
            return msgChannel.includes(fc);
        });
    }
    
    // ✅ FROM filtreleme: Eğer fromPhone parametresi varsa, sadece o numaradan gönderilen mesajları göster
    // ✅ KRITIK: Aynı conversation'da hem VIP hem Hamzah mesajları varsa, sadece seçili sender'dan gönderilen mesajları göster
    if (filterFromPhone && filterFromPhone !== '') {
        const cleanPhone = (phone) => {
            return String(phone || '').replace(/\+/g, '').replace(/\s/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '').trim();
        };
        const cleanFilterFromPhone = cleanPhone(filterFromPhone);
        const businessNumbers = ['908505327532', '8505327532', '905421363421', '5421363421'];
        
        finalMessages = finalMessages.filter(msg => {
            const msgDirection = (msg.direction || (msg.isSentFromSleekflow ? 'sent' : 'received')).toLowerCase();
            const isOutgoing = msgDirection === 'sent' || msg.isSentFromSleekflow === true;
            
            // ✅ Sadece outgoing (bizden gönderilen) mesajları filtrele
            // ✅ Incoming (müşteriden gelen) mesajları her zaman göster
            if (!isOutgoing) {
                return true; // ✅ Incoming mesajları her zaman göster
            }
            
            // ✅ Outgoing mesajların FROM'unu kontrol et
            const msgFrom = cleanPhone(msg.from || msg.fromPhone || msg.senderPhone || '');
            
            // ✅ FROM numarası eşleşiyorsa göster
            if (msgFrom === cleanFilterFromPhone) {
                return true;
            }
            
            // ✅ FROM numarası eşleşmiyorsa gösterme (farklı numaradan gönderilmiş)
            return false;
        });
        
        console.log(`🔍 [BACKEND] Mesaj FROM filtreleme: ${finalMessages.length} mesaj bulundu (fromPhone: ${cleanFilterFromPhone}, toplam: ${allMessages.length})`);
    }

    // ✅ Zaman sırasına göre sırala (EN ESKİ EN ÜSTTE, EN YENİ EN ALTTA) - Normal chat gibi
    finalMessages.sort((a, b) => {
        // Timestamp parse fonksiyonu
        const parseTime = (msg) => {
            // Önce timestamp'e bak
            if (msg.timestamp) {
                if (typeof msg.timestamp === 'number') {
                    // Unix timestamp (saniye veya milisaniye)
                    return msg.timestamp < 10000000000 ? msg.timestamp * 1000 : msg.timestamp;
                } else if (typeof msg.timestamp === 'string') {
                    const parsed = new Date(msg.timestamp).getTime();
                    if (!isNaN(parsed)) return parsed;
                }
            }
            
            // Timestamp yoksa createdAt'e bak
            if (msg.createdAt) {
                const parsed = new Date(msg.createdAt).getTime();
                if (!isNaN(parsed)) return parsed;
            }
            
            // Hiçbiri yoksa veya geçersizse, çok eski bir tarih döndür
            return 0;
        };
        
        const timeA = parseTime(a);
        const timeB = parseTime(b);
        
        // Eğer her ikisi de 0 ise (geçersiz), sırayı koru
        if (timeA === 0 && timeB === 0) {
            return 0;
        }
        
        // ✅ EN ESKİ EN ÜSTTE, EN YENİ EN ALTTA (normal chat sıralaması)
        return timeA - timeB;
    });

    logger.info('Tüm mesajlar çekildi', { 
        conversationId: id, 
        totalMessages: finalMessages.length,
        totalFetched,
        filterChannel: filterChannel || 'yok'
    });

    res.json({ 
        messages: finalMessages,
        total: finalMessages.length,
        fetched: totalFetched
    });
}));

/**
 * POST /api/sleekflow/conversations/:id/messages
 * Mesaj gönder
 */
router.post('/conversations/:id/messages', upload.array('files', 10), asyncHandler(async (req, res, next) => {
    let { id } = req.params;
    
    // ✅ KRITIK: Conversation ID mapping - Eğer ID'de _vip veya _hamzah varsa, orijinal ID'yi al
    // ✅ Frontend'den gelen mapped ID'yi orijinal ID'ye çevir
    let originalConversationId = id;
    if (id.includes('_vip') || id.includes('_hamzah') || (id.includes('_') && id.split('_').length > 1)) {
        // ✅ Mapped ID'den orijinal ID'yi çıkar
        const parts = id.split('_');
        originalConversationId = parts[0]; // ✅ İlk kısım orijinal ID
        console.log(`✅ [BACKEND] Conversation ID mapping (POST messages): ${id} -> ${originalConversationId}`);
    }
    
    // ✅ Orijinal conversation ID'sini kullan
    id = originalConversationId;
    
    // ✅ BACKEND YETKİ KONTROLÜ: Kullanıcı bilgisini al ve yetkilerini kontrol et
    const { userEmail, userId } = req.query; // Query parametrelerinden al
    const userEmailFromBody = req.body.userEmail; // Body'den de al (fallback)
    const userIdFromBody = req.body.userId; // Body'den de al (fallback)
    
    const finalUserEmail = userEmail || userEmailFromBody;
    const finalUserId = userId || userIdFromBody;
    
    let allowedSenders = ['*']; // Default: Tüm sender'lar
    if (finalUserEmail || finalUserId) {
        try {
            const userSenderPermissions = require('../config/userSenderPermissions');
            const userKey = finalUserEmail || finalUserId;
            allowedSenders = userSenderPermissions[userKey] || userSenderPermissions.default || ['*'];
            logger.info('✅ [BACKEND YETKİ] Kullanıcı yetkileri kontrol edildi (mesaj gönderme)', { 
                userEmail: finalUserEmail, 
                userId: finalUserId, 
                allowedSenders 
            });
        } catch (permError) {
            logger.warn('⚠️ [BACKEND YETKİ] Yetki kontrolü hatası, default yetkiler kullanılıyor', { error: permError.message });
            allowedSenders = ['*'];
        }
    }
    
    // ✅ BULK-MESSAGE FIX: Conversation ID yoksa (telefon numarası gönderilmişse), telefon numarasından conversation bul
    // ✅ Normal UI mantığı bozulmadan, sadece conversation ID bulunamazsa telefon numarasından ara
    let conversationId = id;
    
    // Eğer ID telefon numarası gibi görünüyorsa (sadece rakamlar, 10+ karakter), conversation bul
    if (id && /^\d{10,}$/.test(id)) {
        try {
            const { apiKey: reqApiKey, baseUrl: reqBaseUrl } = req.body;
            const apiKeyToUse = reqApiKey || sleekflowApiKey;
            const baseUrlToUse = (reqBaseUrl && typeof reqBaseUrl === 'string' && reqBaseUrl.trim() && reqBaseUrl.trim() !== 'undefined')
                ? reqBaseUrl.trim()
                : (sleekflowBaseUrl || 'https://api.sleekflow.io');
            
            if (apiKeyToUse) {
                sleekflowService.setCredentials(apiKeyToUse, baseUrlToUse);
                const foundConvId = await findConversationByPhone(id, apiKeyToUse, baseUrlToUse);
                if (foundConvId) {
                    conversationId = foundConvId;
                    logger.info('✅ Conversation ID telefon numarasından bulundu', { phone: id, conversationId });
                } else {
                    logger.warn('⚠️ Conversation ID telefon numarasından bulunamadı, ID olarak kullanılacak', { phone: id });
                }
            }
        } catch (convFindError) {
            logger.warn('⚠️ Conversation ID bulma hatası, ID olarak kullanılacak', { phone: id, error: convFindError.message });
        }
    }
    const text = req.body.text || '';
    const files = req.files || [];
    
    // ✅ Template mesaj kontrolü
    const isTemplate = req.body.isTemplate === true || req.body.isTemplate === 'true' || req.body.isTemplate === 'true';
    const templateId = req.body.templateId || req.body.templateName || '';
    
    // ✅ Template parametrelerini parse et (JSON string olabilir)
    let templateParams = {};
    if (req.body.templateParams) {
        try {
            templateParams = typeof req.body.templateParams === 'string' ? JSON.parse(req.body.templateParams) : req.body.templateParams;
        } catch (e) {
            templateParams = req.body.templateParams;
        }
    }
    
    // ✅ Template parametre tiplerini parse et
    let templateParamTypes = {};
    if (req.body.templateParamTypes) {
        try {
            templateParamTypes = typeof req.body.templateParamTypes === 'string' ? JSON.parse(req.body.templateParamTypes) : req.body.templateParamTypes;
        } catch (e) {
            templateParamTypes = req.body.templateParamTypes;
        }
    }
    
    // ✅ Template parametre dosyalarını topla (multer'dan gelen dosyalar)
    const templateParamFiles = {};
    if (req.files && req.files.length > 0) {
        // ✅ Multer dosyaları req.files array'inde
        // Field name'e göre eşleştir (templateParamFile_1, templateParamFile_2, vb.)
        req.files.forEach(file => {
            // Multer field name'i dosya field'ından al
            const fieldName = file.fieldname || '';
            if (fieldName && fieldName.startsWith('templateParamFile_')) {
                const varNum = fieldName.replace('templateParamFile_', '');
                templateParamFiles[varNum] = file;
                logger.info('✅ Template parametre dosyası bulundu', {
                    varNum: varNum,
                    fileName: file.originalname,
                    fieldName: fieldName
                });
            }
        });
    }
    
    // ✅ API key ve baseUrl'i query parametrelerinden veya body'den al
    const apiKeyFromQuery = req.query.apiKey;
    const baseUrlFromQuery = req.query.baseUrl;
    const apiKeyFromBody = req.body.apiKey;
    const baseUrlFromBody = req.body.baseUrl;
    
    const apiKeyToUse = apiKeyFromQuery || apiKeyFromBody || sleekflowApiKey;
    const baseUrlToUse = baseUrlFromQuery || baseUrlFromBody || sleekflowBaseUrl;

    if (!apiKeyToUse) {
        if (files.length > 0) {
            files.forEach(file => {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            });
        }
        return res.status(401).json({ 
            error: 'Sleekflow bağlantısı yok'
        });
    }

    if (!text.trim() && files.length === 0) {
        return res.status(400).json({ 
            error: 'Mesaj metni veya dosya gerekli'
        });
    }

    // ✅ KRITIK: baseUrl null/undefined/boş string kontrolü
        let finalBaseUrl = 'https://api.sleekflow.io';
        if (baseUrlToUse && typeof baseUrlToUse === 'string' && baseUrlToUse.trim() && baseUrlToUse.trim() !== 'undefined' && baseUrlToUse.trim() !== 'null') {
            finalBaseUrl = baseUrlToUse.trim();
        }
        
        // ✅ Service'e credentials'ı set et
        try {
            sleekflowService.setCredentials(apiKeyToUse, finalBaseUrl);
        } catch (credError) {
            logger.error('Mesaj gönderme credentials hatası', {
                error: credError.message,
                apiKey: apiKeyToUse ? `${apiKeyToUse.substring(0, 10)}...` : 'yok',
                baseUrl: finalBaseUrl
            });
            if (files.length > 0) {
                files.forEach(file => {
                    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                });
            }
            return res.status(400).json({ 
                error: 'Geçersiz API anahtarı veya base URL'
            });
        }

        // ✅ PERFORMANS: Conversation bilgisini al
        let conversationData = null;
        try {
            // Önce conversation'ı direkt almayı dene
            try {
                const convResponse = await sleekflowService.call('get', `/api/conversation/${conversationId}`);
                const conv = Array.isArray(convResponse) ? convResponse[0] : (convResponse.data || convResponse);
                if (conv) {
                    // ✅ DEBUG: Conversation'dan gelen TÜM alanları logla - INSTAGRAM İÇİN KRİTİK
                    logger.info('🔍🔍🔍 Conversation API response - TÜM ALANLAR (INSTAGRAM İÇİN)', {
                        conversationId: id,
                        allFields: Object.keys(conv),
                        channel: conv.channel,
                        lastMessageChannel: conv.lastMessageChannel,
                        channelIdentityId: conv.channelIdentityId,
                        channelIdentity: conv.channelIdentity,
                        receiverId: conv.receiverId,
                        facebookReceiverId: conv.facebookReceiverId,
                        instagramReceiverId: conv.instagramReceiverId,
                        instagramReceiver: conv.instagramReceiver, // ✅ Instagram receiver object'i
                        userProfile: conv.userProfile,
                        companyId: conv.companyId,
                        messageGroupName: conv.messageGroupName,
                        // ✅ TÜM olası Instagram/Facebook ID alanları
                        possibleInstagramIds: {
                            channelIdentityId: conv.channelIdentityId,
                            facebookReceiverId: conv.facebookReceiverId,
                            instagramReceiverId: conv.instagramReceiverId,
                            receiverId: conv.receiverId,
                            userProfileFacebookId: conv.userProfile?.facebookId,
                            userProfileInstagramId: conv.userProfile?.instagramId,
                            userProfileInstagramUsername: conv.userProfile?.instagramUsername,
                            userProfileUsername: conv.userProfile?.username,
                            channelIdentityReceiverId: conv.channelIdentity?.receiverId,
                            channelIdentityFacebookReceiverId: conv.channelIdentity?.facebookReceiverId,
                            channelIdentityInstagramReceiverId: conv.channelIdentity?.instagramReceiverId,
                            channelIdentityId: conv.channelIdentity?.id,
                            // ✅ Instagram receiver object'inden
                            instagramReceiverChannelIdentityId: conv.instagramReceiver?.channelIdentityId,
                            instagramReceiverUserIdentityId: conv.instagramReceiver?.userIdentityId,
                            instagramReceiverInstagramId: conv.instagramReceiver?.instagramId,
                            instagramReceiverInstagramPageId: conv.instagramReceiver?.instagramPageId,
                            instagramReceiverPageId: conv.instagramReceiver?.pageId
                        },
                        fullConversation: JSON.stringify(conv, null, 2) // ✅ TÜM conversation'ı JSON olarak logla
                    });
                    
                    // ✅ AYRI BİR LOG: Instagram receiver ve channelIdentityId için özel log
                    logger.info('🔍🔍🔍 INSTAGRAM RECEIVER VE CHANNELIDENTITYID DETAYLARI', {
                        conversationId: id,
                        hasInstagramReceiver: !!conv.instagramReceiver,
                        instagramReceiver: conv.instagramReceiver || 'YOK',
                        channelIdentityId_direct: conv.channelIdentityId || 'YOK',
                        channelIdentityId_fromChannelIdentity: conv.channelIdentity?.id || 'YOK',
                        channelIdentityId_fromInstagramReceiver: conv.instagramReceiver?.channelIdentityId || 'YOK',
                        userIdentityId_fromInstagramReceiver: conv.instagramReceiver?.userIdentityId || 'YOK',
                        instagramId_fromInstagramReceiver: conv.instagramReceiver?.instagramId || 'YOK',
                        allFields: Object.keys(conv),
                        channelIdentityKeys: conv.channelIdentity ? Object.keys(conv.channelIdentity) : 'YOK',
                        instagramReceiverKeys: conv.instagramReceiver ? Object.keys(conv.instagramReceiver) : 'YOK'
                    });
                    
                    // ✅ TÜM olası receiver ID alanlarını kontrol et
                    // ✅ Instagram receiver object'inden de ID al
                    const instagramReceiverId = conv.instagramReceiver?.channelIdentityId || 
                                               conv.instagramReceiver?.userIdentityId ||
                                               conv.instagramReceiver?.instagramId ||
                                               conv.instagramReceiver?.instagramPageId ||
                                               conv.instagramReceiver?.pageId;
                    
                    const allPossibleReceiverIds = [
                        conv.lastChannelIdentityId, // ✅ KRITIK: lastChannelIdentityId - SleekFlow'un kullandığı ID!
                        conv.channelIdentityId,
                        instagramReceiverId, // ✅ Instagram receiver'dan gelen ID
                        conv.facebookReceiverId,
                        conv.instagramReceiverId,
                        conv.receiverId,
                        conv.userProfile?.facebookId,
                        conv.userProfile?.instagramId,
                        conv.userProfile?.instagramUsername,
                        conv.userProfile?.username,
                        conv.channelIdentity?.receiverId,
                        conv.channelIdentity?.facebookReceiverId,
                        conv.channelIdentity?.instagramReceiverId,
                        conv.channelIdentity?.id,
                        // ✅ Instagram receiver nested object'inden
                        conv.instagramReceiver?.channelIdentityId,
                        conv.instagramReceiver?.userIdentityId,
                        conv.instagramReceiver?.instagramId,
                        conv.instagramReceiver?.instagramPageId,
                        conv.instagramReceiver?.pageId
                    ].filter(id => id && typeof id === 'string' && id.trim().length > 0);
                    
                    const primaryReceiverId = allPossibleReceiverIds[0] || '';
                    
                    // ✅ channelIdentityId'yi bul - önce lastChannelIdentityId (SleekFlow'un kullandığı), sonra diğerleri
                    const channelIdentityId = conv.lastChannelIdentityId || // ✅ KRITIK: lastChannelIdentityId - SleekFlow'un kullandığı ID!
                                             conv.channelIdentityId || 
                                             conv.channelIdentity?.id || 
                                             conv.channelIdentity?.receiverId ||
                                             conv.channelIdentity?.instagramReceiverId ||
                                             conv.channelIdentity?.facebookReceiverId ||
                                             // ✅ Instagram receiver object'inden
                                             conv.instagramReceiver?.channelIdentityId ||
                                             conv.instagramReceiver?.userIdentityId ||
                                             conv.instagramReceiver?.instagramId ||
                                             conv.instagramReceiver?.instagramPageId ||
                                             conv.instagramReceiver?.pageId ||
                                             primaryReceiverId ||
                                             '';
                    
                    conversationData = {
                        channel: conv.channel || conv.lastMessageChannel || 'whatsapp',
                        lastMessageChannel: conv.channel || conv.lastMessageChannel || 'whatsapp',
                        fromPhone: conv.fromPhone || conv.from || '',
                        toPhone: conv.toPhone || conv.to || '',
                        userProfile: conv.userProfile || {},
                        facebookReceiverId: primaryReceiverId,
                        receiverId: primaryReceiverId,
                        companyId: conv.companyId || conv.company_id || conv.accountId || conv.account_id || '',
                        lastChannelIdentityId: conv.lastChannelIdentityId || '', // ✅ KRITIK: lastChannelIdentityId - SleekFlow'un kullandığı ID!
                        channelIdentityId: channelIdentityId, // ✅ Tüm olası kaynaklardan alınan ID
                        channelIdentity: conv.channelIdentity || {},
                        instagramReceiver: conv.instagramReceiver || {}, // ✅ Instagram receiver object'i
                        instagramReceiverId: instagramReceiverId || conv.instagramReceiverId || conv.channelIdentity?.instagramReceiverId || '',
                        facebookPSId: conv.facebookPSId || conv.channelIdentity?.facebookReceiverId || '',
                        instagramUsername: conv.userProfile?.instagramUsername || conv.userProfile?.username || conv.instagramUsername || conv.instagramReceiver?.username || '',
                        allPossibleReceiverIds: allPossibleReceiverIds // Debug için
                    };
                }
            } catch (convErr) {
                // Conversation endpoint'i yoksa mesajlardan al
                const messagesResponse = await sleekflowService.call('get', `/api/conversation/message/${conversationId}`, {
                    params: { limit: 10, offset: 0 }
                });
                const messages = Array.isArray(messagesResponse) ? messagesResponse : (messagesResponse.data || messagesResponse.messages || []);
                if (messages.length > 0) {
                    const firstMessage = messages[0];
                    
                    // ✅ Instagram/Facebook için receiver ID'yi mesajlardan çıkar
                    const facebookReceiverId = firstMessage.facebookReceiverId || firstMessage.receiverId || firstMessage.to || firstMessage.toPhone || firstMessage.facebookId || firstMessage.instagramId || '';
                    
                    // ✅ Instagram receiver object'inden channelIdentityId al
                    const instagramReceiver = firstMessage.instagramReceiver || firstMessage.instagramReceiver || {};
                    const channelIdentityIdFromMessage = instagramReceiver.channelIdentityId || 
                                                         instagramReceiver.userIdentityId ||
                                                         instagramReceiver.instagramId ||
                                                         instagramReceiver.instagramPageId ||
                                                         instagramReceiver.pageId ||
                                                         firstMessage.channelIdentityId ||
                                                         firstMessage.userIdentityId ||
                                                         '';
                    
                    logger.info('🔍 Mesajlardan conversation data alınıyor', {
                        conversationId: id,
                        messageCount: messages.length,
                        firstMessageKeys: Object.keys(firstMessage),
                        instagramReceiver: instagramReceiver,
                        channelIdentityIdFromMessage: channelIdentityIdFromMessage
                    });
                    
                    conversationData = {
                        channel: firstMessage.channel || 'whatsapp',
                        lastMessageChannel: firstMessage.channel || 'whatsapp',
                        fromPhone: firstMessage.from || firstMessage.fromPhone || '',
                        toPhone: firstMessage.to || firstMessage.toPhone || '',
                        userProfile: firstMessage.userProfile || {},
                        facebookReceiverId: facebookReceiverId,
                        receiverId: facebookReceiverId,
                        companyId: firstMessage.companyId || firstMessage.company_id || firstMessage.accountId || firstMessage.account_id || '',
                        channelIdentityId: channelIdentityIdFromMessage, // ✅ Mesajlardan alınan channelIdentityId
                        instagramReceiver: instagramReceiver, // ✅ Instagram receiver object'i
                        allPossibleReceiverIds: [channelIdentityIdFromMessage, facebookReceiverId].filter(id => id && id.trim().length > 0)
                    };
                }
            }
            
            // ✅ Template mesajı ise conversation bulunamasa bile devam et (yeni conversation oluşturulacak)
            // ✅ Normal mesaj ise conversation bulunamazsa hata ver
            if (!conversationData) {
                // ✅ ÇÖZÜM 3: Conversation yoksa ve id geçerli bir telefon numarasıysa (10+ rakam), template kontrolü yapmadan devam et
                // ✅ Bu hem normal UI hem bulk mesaj için çalışır
                const cleanPhone = (phone) => {
                    return String(phone || '').replace(/\+/g, '').replace(/\s/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '').trim();
                };
                
                const cleanedId = cleanPhone(id);
                const isPhoneNumber = /^\d{10,}$/.test(cleanedId); // 10+ rakam ise telefon numarası
                
                if (isPhoneNumber) {
                    // ✅ Geçerli telefon numarası → Template kontrolü yapmadan devam et
                    logger.info('✅ Conversation bulunamadı ama geçerli telefon numarası, devam ediliyor', { 
                        conversationId: id,
                        cleanedId,
                        note: 'Template kontrolü yapılmadan devam ediliyor - yeni conversation oluşturulacak'
                    });
                    // conversationData null kalacak, ama devam edeceğiz
                } else {
                    // ✅ Telefon numarası değil → Template mesajı kontrolü yap
                    const hasTemplate = templateId || req.body.templateName || isTemplate;
                    
                    if (!hasTemplate) {
                        // ✅ Normal mesaj ama conversation yok ve telefon numarası değil → Hata ver
                        return res.status(404).json({ 
                            error: 'Conversation bulunamadı',
                            conversationId: id
                        });
                    } else {
                        // ✅ Template mesajı → Conversation bulunamasa bile devam et (SleekFlow yeni conversation oluşturacak)
                        logger.info('⚠️ Conversation bulunamadı ama template mesajı, yeni conversation oluşturulacak', { 
                            conversationId: id,
                            templateId: templateId || req.body.templateName,
                            note: 'conversationData null, channel ve telefon numarası id\'den alınacak'
                        });
                        // conversationData null kalacak, ama devam edeceğiz
                    }
                }
            }
        } catch (msgErr) {
            logger.error('Conversation bilgisi alınamadı', {
                error: msgErr.message,
                conversationId: id,
                response: msgErr.response?.data
            });
            return res.status(500).json({ 
                error: 'Conversation bilgisi alınamadı: ' + (msgErr.message || 'Bilinmeyen hata')
            });
        }

        // ✅ Conversation bulunamadıysa (template mesajı için), channel ve telefon numarası bilgilerini id'den al
        let channel = 'whatsappcloudapi'; // ✅ Default channel (template mesajı için)
        let originalChannel = channel;
        
        if (conversationData) {
            // ✅ Conversation varsa, channel'ı conversation'dan al
            channel = (conversationData.channel || conversationData.lastMessageChannel || 'whatsapp').toLowerCase();
            originalChannel = channel;
            
            if (channel.includes('whatsapp')) {
                if (channel === 'whatsapp' || channel === 'whatsappcloudapi') {
                    channel = 'whatsappcloudapi';
                } else if (channel === 'whatsapp360dialog') {
                    channel = 'whatsapp360dialog';
                } else if (channel === 'whatsapptwilio') {
                    channel = 'whatsapp';
                } else {
                    channel = 'whatsappcloudapi';
                }
            } else if (channel.includes('instagram')) {
                channel = 'facebook'; // ✅ Instagram için 'facebook' channel kullan (Instagram Facebook'un bir parçası)
            } else if (!['sms', 'facebook', 'line', 'wechat', 'web', 'note', 'instagram'].includes(channel)) {
                channel = 'whatsappcloudapi';
            }
        } else {
            // ✅ Conversation yoksa (template mesajı için), default channel kullan
            channel = 'whatsappcloudapi';
            originalChannel = 'whatsappcloudapi';
        }
        
        const cleanPhone = (phone) => {
            return String(phone || '').replace(/\+/g, '').replace(/\s/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '').trim();
        };
        
        // ✅ Instagram ve Facebook için telefon numarası gerekmez - direkt conversation ID ile gönder
        // ✅ Orijinal channel'ı kontrol et (Instagram için)
        const isSocialMedia = originalChannel.includes('instagram') || originalChannel.includes('facebook') || channel.includes('instagram') || channel.includes('facebook');
        
        let fromPhone = null;
        let toPhone = null;
        
        if (!isSocialMedia) {
            // ✅ Sadece WhatsApp, SMS gibi telefon tabanlı channel'lar için telefon numarası kontrolü
            let customerPhone = '';
            
            if (conversationData) {
                // ✅ Conversation varsa, telefon numarasını conversation'dan al
                const userProfile = conversationData.userProfile || {};
                customerPhone = cleanPhone(userProfile.phoneNumber || userProfile.phone || userProfile.mobile || '');
                
                // ✅ Eğer customerPhone boşsa, conversation'dan diğer field'ları kontrol et
                if (!customerPhone) {
                    customerPhone = cleanPhone(conversationData.toPhone || conversationData.to || conversationData.receiverPhone || conversationData.phoneNumber || '');
                }
                
                // ✅ KRITIK: Eğer customerPhone hala boşsa veya business numarasına eşitse, mesajlardan TO bul
                // ✅ Business numarası: 908505327532 veya 905421363421
                const businessNumbers = ['908505327532', '905421363421'];
                if (!customerPhone || businessNumbers.includes(customerPhone)) {
                    // ✅ Mesajlardan incoming mesajların FROM'unu al (müşterinin numarası)
                    try {
                        const messagesResponse = await sleekflowService.call('get', `/api/conversation/message/${conversationId}`, {
                            params: { limit: 10, offset: 0 }
                        });
                        const messages = Array.isArray(messagesResponse) ? messagesResponse : (messagesResponse.data || messagesResponse.messages || []);
                        
                        // ✅ Incoming mesajlardan FROM bul (müşterinin numarası)
                        for (const msg of messages) {
                            const msgDirection = (msg.direction || (msg.isSentFromSleekflow ? 'sent' : 'received')).toLowerCase();
                            const isIncoming = msgDirection === 'received' || msg.isSentFromSleekflow === false;
                            
                            if (isIncoming) {
                                const msgFrom = cleanPhone(msg.from || msg.fromPhone || msg.senderPhone || '');
                                // ✅ Business numarası değilse, müşterinin numarasıdır
                                if (msgFrom && !businessNumbers.includes(msgFrom)) {
                                    customerPhone = msgFrom;
                                    console.log('✅ [BACKEND] customerPhone mesajlardan bulundu (incoming):', customerPhone);
                                    break;
                                }
                            }
                        }
                    } catch (msgErr) {
                        console.log('⚠️ [BACKEND] Mesajlardan customerPhone bulunamadı:', msgErr.message);
                    }
                }
            } else {
                // ✅ Conversation yoksa (template mesajı için), telefon numarasını id'den al (id telefon numarası olabilir)
                customerPhone = cleanPhone(id);
            }
            
            toPhone = customerPhone;
            
            // ✅ KRITIK: TO ve FROM aynı numara ise, hata logla
            if (toPhone && fromPhone && toPhone === fromPhone) {
                console.error('❌ [BACKEND] TO ve FROM aynı numara!', {
                    toPhone,
                    fromPhone,
                    customerPhone,
                    conversationId: id
                });
                logger.error('❌ TO ve FROM aynı numara!', {
                    toPhone,
                    fromPhone,
                    customerPhone,
                    conversationId: id
                });
            }
            
            // ✅ ÖNCE: Frontend'den gelen fromPhone'u kontrol et (seçili sender numarası)
            const requestedFromPhone = req.body.fromPhone ? cleanPhone(req.body.fromPhone) : null;
            
            // ✅ BACKEND YETKİ KONTROLÜ: Mesaj göndermek istediği sender numarasına yetkisi var mı?
            if (requestedFromPhone) {
                // ✅ Admin değilse ve requestedFromPhone yetkili değilse, erişim reddedilir
                if (!allowedSenders.includes('*') && !allowedSenders.includes(requestedFromPhone)) {
                    logger.warn('❌ [BACKEND YETKİ] Kullanıcının bu sender\'dan mesaj gönderme yetkisi yok', { 
                        userEmail: finalUserEmail, 
                        userId: finalUserId, 
                        requestedFromPhone, 
                        allowedSenders 
                    });
                    
                    // ✅ Dosyaları temizle
                    if (files.length > 0) {
                        files.forEach(file => {
                            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                        });
                    }
                    
                    return res.status(403).json({ 
                        error: 'Bu sender numarasından mesaj gönderme yetkiniz yok',
                        conversationId: id
                    });
                }
                
                // ✅ Frontend'den FROM numarası gönderilmiş (seçili sender) - direkt kullan
                fromPhone = requestedFromPhone;
                logger.info('✅ Frontend\'den FROM numarası alındı (seçili sender):', { fromPhone, toPhone: customerPhone });
                // ✅ toPhone zaten customerPhone olarak set edilmiş (1116. satır), değiştirme
                // ✅ Eğer customerPhone boşsa, normal UI mantığı devreye girecek (aşağıdaki else if bloğu)
            } else if (conversationData) {
                // ✅ Conversation varsa, FROM'u mesajlardan bul
                try {
                    const messagesResponse = await sleekflowService.call('get', `/api/conversation/message/${conversationId}`, {
                        params: { limit: 10, offset: 0 }
                    });
                    const messages = Array.isArray(messagesResponse) ? messagesResponse : (messagesResponse.data || messagesResponse.messages || []);
                    
                    // ✅ FROM bulma: Sadece outgoing (bizden gönderilen) mesajların FROM'unu kullan
                    // ✅ Bu şekilde FROM business numarası (+90 850 532 7532) olacak
                    const outgoingFromNumbers = new Set();
                    const allPhoneNumbers = new Set();
                    
                    for (const msg of messages) {
                        const msgDirection = (msg.direction || (msg.isSentFromSleekflow ? 'sent' : 'received')).toLowerCase();
                        const isOutgoing = msgDirection === 'sent' || msg.isSentFromSleekflow === true;
                        
                        const msgFrom = cleanPhone(msg.from || msg.fromPhone || msg.senderPhone || '');
                        const msgTo = cleanPhone(msg.to || msg.toPhone || msg.receiverPhone || '');
                        
                        // Tüm numaraları topla (fallback için)
                        if (msgFrom) allPhoneNumbers.add(msgFrom);
                        if (msgTo) allPhoneNumbers.add(msgTo);
                        
                        // ✅ Sadece outgoing mesajların FROM'unu al (business numarası)
                        if (isOutgoing && msgFrom) {
                            outgoingFromNumbers.add(msgFrom);
                        }
                    }
                    
                    const outgoingFromArray = Array.from(outgoingFromNumbers);
                    const allPhoneArray = Array.from(allPhoneNumbers);
                    
                    // ✅ ÖNCE: Outgoing mesajlardan FROM bul (business numarası)
                    if (outgoingFromArray.length > 0) {
                        // Outgoing mesajlardan FROM bulundu (business numarası)
                        fromPhone = outgoingFromArray[0]; // İlk outgoing FROM'u kullan
                        // ✅ TO'yu bul: customerPhone varsa onu kullan, yoksa FROM olmayan numarayı bul
                        toPhone = customerPhone || allPhoneArray.find(p => p !== fromPhone) || '';
                        
                        // ✅ Eğer hala toPhone boşsa, incoming mesajlardan TO bul
                        if (!toPhone) {
                            for (const msg of messages) {
                                const msgDirection = (msg.direction || (msg.isSentFromSleekflow ? 'sent' : 'received')).toLowerCase();
                                const isIncoming = msgDirection === 'received' || msg.isSentFromSleekflow === false;
                                if (isIncoming) {
                                    const msgFrom = cleanPhone(msg.from || msg.fromPhone || msg.senderPhone || '');
                                    if (msgFrom && msgFrom !== fromPhone) {
                                        toPhone = msgFrom;
                                        break;
                                    }
                                }
                            }
                        }
                    } else if (customerPhone && allPhoneArray.length >= 2) {
                        // ✅ Outgoing FROM bulunamadı, fallback: customer numarası olmayan numarayı bul
                        toPhone = customerPhone;
                        fromPhone = allPhoneArray.find(p => p !== customerPhone) || allPhoneArray[0];
                    } else if (allPhoneArray.length >= 2) {
                        // ✅ İki numara varsa, ilkini TO, ikincisini FROM yap
                        toPhone = allPhoneArray[0];
                        fromPhone = allPhoneArray[1];
                    } else if (allPhoneArray.length === 1) {
                        // ✅ Tek numara varsa, FROM olarak kullan, TO customer numarası
                        fromPhone = allPhoneArray[0];
                        toPhone = customerPhone || '';
                        
                        // ✅ Eğer hala toPhone boşsa, incoming mesajlardan TO bul
                        if (!toPhone) {
                            for (const msg of messages) {
                                const msgDirection = (msg.direction || (msg.isSentFromSleekflow ? 'sent' : 'received')).toLowerCase();
                                const isIncoming = msgDirection === 'received' || msg.isSentFromSleekflow === false;
                                if (isIncoming) {
                                    const msgFrom = cleanPhone(msg.from || msg.fromPhone || msg.senderPhone || '');
                                    if (msgFrom && msgFrom !== fromPhone) {
                                        toPhone = msgFrom;
                                        break;
                                    }
                                }
                            }
                        }
                    } else {
                        // ✅ Mesajlardan numara bulunamadıysa, conversationData'dan al
                        const convFrom = cleanPhone(conversationData.fromPhone || conversationData.from || conversationData.senderPhone || '');
                        const convTo = cleanPhone(conversationData.toPhone || conversationData.to || conversationData.receiverPhone || '');
                        if (convFrom && convTo) {
                            fromPhone = convFrom;
                            toPhone = convTo;
                        } else if (customerPhone) {
                            toPhone = customerPhone;
                            fromPhone = convFrom || convTo || '';
                        }
                        
                        // ✅ Eğer hala fromPhone yoksa veya customer numarasına eşitse, null yap (SleekFlow default kullanacak)
                        if (!fromPhone || (customerPhone && fromPhone === customerPhone)) {
                            fromPhone = null; // ✅ SleekFlow default channel kullanacak
                            logger.info('✅ FROM bulunamadı veya customer numarası, null yapılıyor (SleekFlow default kullanılacak)');
                        }
                    }
                } catch (msgErr) {
                    const convFrom = cleanPhone(conversationData.fromPhone || conversationData.from || conversationData.senderPhone || '');
                    const convTo = cleanPhone(conversationData.toPhone || conversationData.to || conversationData.receiverPhone || '');
                    if (convFrom && convTo) {
                        fromPhone = convFrom;
                        toPhone = convTo;
                    } else if (customerPhone) {
                        toPhone = customerPhone;
                        fromPhone = convFrom || convTo || '';
                    } else if (convTo) {
                        // ✅ customerPhone yoksa ama convTo varsa, onu kullan
                        toPhone = convTo;
                        fromPhone = convFrom || '';
                    }
                    
                    // ✅ Eğer hala fromPhone yoksa veya customer numarasına eşitse, null yap (SleekFlow default kullanacak)
                    if (!fromPhone || (customerPhone && fromPhone === customerPhone)) {
                        fromPhone = null; // ✅ SleekFlow default channel kullanacak
                        logger.info('✅ FROM bulunamadı veya customer numarası (catch), null yapılıyor (SleekFlow default kullanılacak)');
                    }
                }
            } else {
                // ✅ Conversation yoksa (template mesajı için)
                // ✅ SADECE BULK MESAJ İÇİN: FROM sabit numara: +90 850 532 7532
                // ✅ Normal UI için: FROM null (SleekFlow default kullanacak)
                const isBulkMessage = req.body.isBulkMessage === true || req.body.isBulkMessage === 'true';
                
                if (isBulkMessage) {
                    // ✅ BULK MESAJ: FROM sabit numara
                    fromPhone = '908505327532'; // ✅ Sabit FROM numarası: +90 850 532 7532
                    logger.info('✅ BULK MESAJ - Template mesajı için FROM sabit numara kullanılıyor', { 
                        fromPhone: '908505327532',
                        toPhone,
                        conversationId: id
                    });
                } else {
                    // ✅ NORMAL UI: FROM null (SleekFlow default kullanacak)
                    fromPhone = null;
                    logger.info('✅ NORMAL UI - Template mesajı için FROM null (SleekFlow default channel kullanılacak)', { 
                        toPhone,
                        conversationId: id
                    });
                }
            }
            
            // ✅ WhatsApp için FROM kontrolü: Eğer FROM customer'ın numarası ise null yap
            // ✅ NOT: Frontend'den gelen fromPhone'u kontrol etme (zaten doğru business numarası)
            // ✅ NOT: Outgoing mesajlardan FROM bulduğumuz için genelde business numarası olmalı
            if (channel.includes('whatsapp') && fromPhone && !requestedFromPhone) {
                // ✅ SADECE mesajlardan FROM bulduğumuzda kontrol et (frontend'den gelmediyse)
                // Eğer bulunan FROM customer'ın numarası ise (TO ile aynı), bu yanlış!
                if (fromPhone === toPhone || fromPhone === customerPhone) {
                    // FROM customer'ın numarası, bu yanlış! FROM'u null yap, SleekFlow default kullanacak
                    logger.warn('⚠️ WhatsApp FROM: Customer numarası FROM olarak bulundu, null yapılıyor', { 
                        fromPhone,
                        toPhone,
                        customerPhone
                    });
                    
                    fromPhone = null;
                    logger.info('✅ WhatsApp FROM: null yapıldı, SleekFlow default kullanılacak');
                } else {
                    logger.info('✅ WhatsApp FROM bulundu (outgoing mesajlardan):', { 
                        fromPhone,
                        toPhone,
                        customerPhone
                    });
                }
            } else if (channel.includes('whatsapp') && fromPhone && requestedFromPhone) {
                // ✅ Frontend'den fromPhone geldi - direkt kullan (kontrol yapma)
                logger.info('✅ WhatsApp FROM: Frontend\'den gelen fromPhone kullanılıyor (kontrol atlandı):', { 
                    fromPhone,
                    toPhone,
                    customerPhone
                });
            }
            
            // ✅ Telefon tabanlı channel'lar için telefon numarası kontrolü
            // ✅ WhatsApp için FROM null olabilir (SleekFlow default kullanacak), sadece TO gerekli
            if (!toPhone) {
                if (files.length > 0) {
                    files.forEach(file => {
                        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                    });
                }
                
                logger.error('Telefon numarası bulunamadı', {
                    conversationId: id,
                    channel,
                    fromPhone,
                    toPhone,
                    conversationData: {
                        fromPhone: conversationData.fromPhone,
                        toPhone: conversationData.toPhone,
                        userProfile: conversationData.userProfile
                    }
                });
                
                return res.status(400).json({ 
                    error: 'Gönderici veya alıcı telefon numarası bulunamadı',
                    conversationId: id,
                    channel: channel,
                    details: 'Conversation\'dan telefon numarası çıkarılamadı. Lütfen conversation bilgilerini kontrol edin.'
                });
            }
        }

        let payload;
        
        // ✅ Template dosyaları varsa text'i güncelle (caption olarak)
        const messageText = (req.body.text || text || '').trim();
        
        if (files.length > 0) {
            // ✅ Instagram/Facebook için conversationId ile direkt dosya gönder
            if (isSocialMedia) {
                try {
                    // ✅ Instagram dosyası için conversationId yeterli, pageId gerekmez
                    const FormData = require('form-data');
                    const formData = new FormData();
                    
                    // ✅ conversationId kullan
                    formData.append('conversationId', id); // ✅ ConversationId kullan
                    formData.append('messageType', 'file');
                    if (messageText) {
                        formData.append('messageContent', messageText);
                    }
                    
                    logger.info('✅ Instagram dosya payload (conversationId)', {
                        conversationId: id
                    });
                    
                    for (const file of files) {
                        const fileStream = fs.createReadStream(file.path);
                        formData.append('files', fileStream, {
                            filename: file.originalname || 'file',
                            contentType: file.mimetype || 'application/octet-stream'
                        });
                    }
                    
                    const axios = require('axios');
                    const base = finalBaseUrl;
                    const url = `${base}/api/message/send`;
                    
                    const result = await axios.post(url, formData, {
                        headers: {
                            ...formData.getHeaders(),
                            'X-Sleekflow-Api-Key': apiKeyToUse
                        },
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity
                    });
                    
                    files.forEach(file => {
                        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                    });
                    
                    return res.json({ 
                        success: true,
                        message: 'Dosya ve mesaj gönderildi',
                        data: result.data
                    });
                } catch (fileError) {
                    files.forEach(file => {
                        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                    });
                    
                    logger.error('Instagram/Facebook dosya gönderme hatası', { 
                        error: fileError.message,
                        response: fileError.response?.data,
                        status: fileError.response?.status,
                        channel,
                        conversationId: id
                    });
                    
                    if (res.headersSent) {
                        return;
                    }
                    
                    const errorMsg = fileError.response?.data?.message || fileError.response?.data?.error || fileError.message || 'Dosya gönderilemedi';
                    const statusCode = fileError.response?.status || 500;
                    
                    return res.status(statusCode).json({ 
                        error: errorMsg
                    });
                }
            } else {
                // ✅ WhatsApp/SMS gibi telefon tabanlı channel'lar için eski format
                try {
                    const FormData = require('form-data');
                    const formData = new FormData();
                    
                    formData.append('channel', channel);
                    // ✅ FROM null ise ekleme (SleekFlow default kullanacak)
                    if (fromPhone) {
                        formData.append('from', fromPhone);
                    }
                    formData.append('to', toPhone);
                    formData.append('messageType', 'file');
                    if (messageText) {
                        formData.append('messageContent', messageText);
                    }
                    
                    for (const file of files) {
                        const fileStream = fs.createReadStream(file.path);
                        formData.append('files', fileStream, {
                            filename: file.originalname || 'file',
                            contentType: file.mimetype || 'application/octet-stream'
                        });
                    }
                    
                    const axios = require('axios');
                    const base = finalBaseUrl;
                    const url = `${base}/api/message/send`;
                    
                    const result = await axios.post(url, formData, {
                        headers: {
                            ...formData.getHeaders(),
                            'X-Sleekflow-Api-Key': apiKeyToUse
                        },
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity
                    });
                    
                    files.forEach(file => {
                        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                    });
                    
                    return res.json({ 
                        success: true,
                        message: 'Dosya ve mesaj gönderildi',
                        data: result.data
                    });
                } catch (fileError) {
                    files.forEach(file => {
                        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                    });
                    
                    logger.error('Dosya gönderme hatası', { 
                        error: fileError.message,
                        response: fileError.response?.data,
                        status: fileError.response?.status,
                        channel,
                        fromPhone,
                        toPhone
                    });
                    
                    if (res.headersSent) {
                        return;
                    }
                    
                    const errorMsg = fileError.response?.data?.message || fileError.response?.data?.error || fileError.message || 'Dosya gönderilemedi';
                    const statusCode = fileError.response?.status || 500;
                    
                    return res.status(statusCode).json({ 
                        error: errorMsg
                    });
                }
            }
        } else {
            // ✅ Instagram/Facebook için mesaj gönder
            if (isSocialMedia) {
                const isInstagram = originalChannel && originalChannel.includes('instagram');
                
                if (isInstagram) {
                    // ✅ Instagram mesajı için channelIdentityId bul (sadeleştirilmiş - en önemli kaynaklar)
                    const channelIdentityId = conversationData.lastChannelIdentityId || 
                                             conversationData.channelIdentityId || 
                                             (conversationData.instagramReceiver && conversationData.instagramReceiver.channelIdentityId) ||
                                             conversationData.facebookReceiverId;
                    
                    if (!channelIdentityId) {
                        logger.error('❌ Instagram mesajı için channelIdentityId bulunamadı', {
                            conversationId: id,
                            lastChannelIdentityId: conversationData.lastChannelIdentityId,
                            channelIdentityId: conversationData.channelIdentityId
                        });
                        
                        return res.status(400).json({ 
                            error: 'Instagram mesajı için channelIdentityId bulunamadı',
                            conversationId: id
                        });
                    }
                    
                    // ✅ 1. DENEME: SleekFlow public API (channel: instagram)
                    try {
                        const sleekflowPayload = {
                            channel: 'instagram',
                            conversationId: id,
                            channelIdentityId: channelIdentityId,
                            messageType: 'text',
                            messageContent: messageText || text.trim()
                        };
                        
                        const result = await sleekflowService.call('post', '/api/message/send/json', {
                            data: sleekflowPayload
                        });
                        
                        logger.info('✅ Instagram mesaj başarıyla gönderildi (SleekFlow API)', {
                            conversationId: id
                        });
                        
                        return res.json({
                            success: true,
                            message: 'Instagram mesajı gönderildi',
                            conversationId: id,
                            data: result,
                            source: 'sleekflow_api'
                        });
                    } catch (sleekflowError) {
                        // ✅ 2. DENEME: Meta Instagram Messaging API (fallback)
                        logger.warn('⚠️ SleekFlow API hatası, Meta API deneniyor', {
                            error: sleekflowError.response?.data?.message || sleekflowError.message,
                            status: sleekflowError.response?.status,
                            conversationId: id
                        });
                        
                        const metaPageAccessToken = process.env.META_PAGE_ACCESS_TOKEN;
                        const metaInstagramBusinessAccountId = process.env.META_INSTAGRAM_BUSINESS_ACCOUNT_ID;
                        
                        if (!metaPageAccessToken || !metaInstagramBusinessAccountId) {
                            const sleekflowErrorMsg = sleekflowError.response?.data?.message || sleekflowError.message || 'Internal Server Error';
                            return res.status(400).json({ 
                                error: `Instagram mesajı gönderilemedi. SleekFlow API: ${sleekflowErrorMsg}. Meta API credentials eksik.`,
                                conversationId: id,
                                sleekflowError: sleekflowErrorMsg,
                                solution: 'meta_api_credentials_required'
                            });
                        }
                        
                        try {
                            metaInstagramService.setCredentials(metaPageAccessToken, metaInstagramBusinessAccountId);
                            const metaResult = await metaInstagramService.sendMessage(channelIdentityId, messageText || text.trim());
                            
                            logger.info('✅ Instagram mesaj başarıyla gönderildi (Meta API)', {
                                conversationId: id,
                                messageId: metaResult.message_id
                            });
                            
                            return res.json({
                                success: true,
                                message: 'Instagram mesajı gönderildi (Meta API)',
                                conversationId: id,
                                messageId: metaResult.message_id,
                                source: 'meta_api'
                            });
                        } catch (metaError) {
                            const sleekflowErrorMsg = sleekflowError.response?.data?.message || sleekflowError.message || 'Internal Server Error';
                            const metaErrorMsg = metaError.response?.data?.error?.message || metaError.message || 'Unknown error';
                            
                            logger.error('❌ Meta API hatası', {
                                error: metaErrorMsg,
                                conversationId: id
                            });
                            
                            return res.status(400).json({ 
                                error: `Instagram mesajı gönderilemedi. SleekFlow API: ${sleekflowErrorMsg}. Meta API: ${metaErrorMsg}`,
                                conversationId: id,
                                sleekflowError: sleekflowErrorMsg,
                                metaError: metaErrorMsg
                            });
                        }
                    }
                }
                
                // ✅ Facebook için normal API denemesi (Instagram değilse)
                try {
                    payload = {
                        channel: 'facebook',
                        conversationId: id,
                        messageType: 'text',
                        messageContent: text.trim()
                    };
                    
                    logger.info('✅ Facebook mesaj payload', {
                        conversationId: id,
                        payload: payload
                    });
                } catch (payloadError) {
                    logger.error('❌ Facebook payload oluşturma hatası', {
                        error: payloadError.message,
                        conversationId: id
                    });
                    return res.status(500).json({ 
                        error: 'Facebook mesaj payload oluşturulamadı: ' + payloadError.message,
                        conversationId: id
                    });
                }
            } else {
                // ✅ WhatsApp için telefon numaralarını temizle (API dokümantasyonuna göre)
                // ✅ KRITIK: FROM null ise payload'a eklenmeyecek (SleekFlow default kullanacak)
                const cleanFromPhone = fromPhone ? cleanPhone(fromPhone) : null;
                const cleanToPhone = cleanPhone(toPhone);
                
                // ✅ WhatsApp için telefon numarası kontrolü
                // ✅ FROM null olabilir (SleekFlow default kullanacak), sadece TO gerekli
                if (!cleanToPhone) {
                    logger.error('WhatsApp mesaj gönderme hatası - alıcı telefon numarası eksik', {
                        conversationId: id,
                        channel,
                        fromPhone: cleanFromPhone,
                        toPhone: cleanToPhone,
                        originalFrom: fromPhone,
                        originalTo: toPhone
                    });
                    return res.status(400).json({ 
                        error: 'WhatsApp mesajı için alıcı telefon numarası gerekli',
                        conversationId: id,
                        channel: channel
                    });
                }
                
                // ✅ Template mesaj mı kontrol et - Parametreleri text içine yerleştir, normal mesaj gönder
                if (isTemplate && templateId && Object.keys(templateParams).length > 0) {
                    try {
                        // ✅ Template içeriğini olduğu gibi al (trim yok – boşluk/satır korunur)
                        let templateContent = (text || '');
                        
                        // ✅ Parametreleri template içeriğindeki {{1}}, {{2}} gibi yerlere yerleştir
                        const sortedParams = Object.keys(templateParams).sort((a, b) => parseInt(a) - parseInt(b));
                        
                        // ✅ Dosyaları topla (varsa)
                        const templateFiles = [];
                        
                        sortedParams.forEach(paramNum => {
                            try {
                                const paramType = templateParamTypes[paramNum] || 'text';
                                const paramValue = templateParams[paramNum] || '';
                                
                                if (paramType === 'text') {
                                    // ✅ Text parametresini template içeriğine yerleştir
                                    templateContent = templateContent.replace(new RegExp(`\\{\\{${paramNum}\\}\\}`, 'g'), paramValue);
                                } else if (paramType === 'url' || paramType === 'link') {
                                    // ✅ URL/Link parametresini template içeriğine yerleştir
                                    if (paramValue) {
                                        templateContent = templateContent.replace(new RegExp(`\\{\\{${paramNum}\\}\\}`, 'g'), paramValue);
                                        logger.info('✅ Template parametre URL eklendi', {
                                            paramNum: paramNum,
                                            paramType: paramType,
                                            url: paramValue
                                        });
                                    } else {
                                        // ✅ URL yoksa boş bırak
                                        templateContent = templateContent.replace(new RegExp(`\\{\\{${paramNum}\\}\\}`, 'g'), '');
                                        logger.warn('⚠️ Template parametre URL boş', {
                                            paramNum: paramNum,
                                            paramType: paramType
                                        });
                                    }
                                } else if (paramType === 'image' || paramType === 'video' || paramType === 'document') {
                                    // ✅ Dosya varsa files array'ine ekle
                                    const templateFile = templateParamFiles[paramNum];
                                    if (templateFile && templateFile.path) {
                                        // ✅ Dosya geçerliyse ekle
                                        templateFiles.push(templateFile);
                                        // ✅ Template içeriğinde {{X}} yerine boş bırak (dosya ayrı gönderilecek)
                                        templateContent = templateContent.replace(new RegExp(`\\{\\{${paramNum}\\}\\}`, 'g'), '');
                                        logger.info('✅ Template parametre dosyası eklendi', {
                                            paramNum: paramNum,
                                            paramType: paramType,
                                            fileName: templateFile.originalname || 'unknown',
                                            filePath: templateFile.path
                                        });
                                    } else if (paramValue && paramValue.startsWith('http')) {
                                        // ✅ URL varsa template içeriğine ekle
                                        templateContent = templateContent.replace(new RegExp(`\\{\\{${paramNum}\\}\\}`, 'g'), paramValue);
                                    } else {
                                        // ✅ Dosya yoksa boş bırak
                                        templateContent = templateContent.replace(new RegExp(`\\{\\{${paramNum}\\}\\}`, 'g'), '');
                                        logger.warn('⚠️ Template parametre dosyası bulunamadı', {
                                            paramNum: paramNum,
                                            paramType: paramType,
                                            hasTemplateFile: !!templateFile
                                        });
                                    }
                                }
                            } catch (paramError) {
                                logger.error('❌ Template parametre işleme hatası (param)', {
                                    error: paramError.message,
                                    paramNum: paramNum,
                                    stack: paramError.stack
                                });
                                // Hata olsa bile devam et
                            }
                        });
                        
                        // ✅ Template içeriği OLDUĞU GİBİ kalsın – boşluk/satır sonu değiştirme
                        // (Eski: replace(/\s+/g,' ').trim() karakter ve boşlukları bozuyordu)
                        
                        // ✅ Normal text mesaj olarak gönder (template formatı değil)
                        if (templateFiles.length > 0) {
                            // ✅ Dosya varsa file mesajı olarak gönder
                            // Template dosyalarını files array'ine ekle (normal dosyalarla birleştir)
                            templateFiles.forEach(file => {
                                files.push(file);
                            });
                            
                            // ✅ Text'i güncelle (template içeriği - caption olarak kullanılacak)
                            // text değişkeni const olduğu için req.body.text'i güncelle
                            req.body.text = templateContent;
                            
                            logger.info('✅ Template mesaj - Parametreler yerleştirildi, dosyalarla gönderiliyor', {
                                conversationId: id,
                                templateId: templateId,
                                finalText: templateContent.substring(0, 100),
                                fileCount: templateFiles.length,
                                totalFileCount: files.length
                            });
                            
                            // ✅ Payload oluşturma - dosyalar files array'inde, normal dosya gönderme mantığı kullanılacak
                            // Bu bloktan sonraki kod dosyaları işleyecek, payload = null yapıyoruz
                            payload = null; // Dosyalar varsa payload burada oluşturulmayacak, aşağıdaki files.length > 0 bloğu kullanılacak
                        } else {
                            // ✅ Sadece text mesaj
                            logger.info('✅ Template mesaj - Parametreler yerleştirildi, normal text mesaj olarak gönderiliyor', {
                                conversationId: id,
                                templateId: templateId,
                                finalText: templateContent.substring(0, 100)
                            });
                            
                            // ✅ Normal text mesaj payload'ı oluştur (template formatı değil)
                            payload = {
                                channel: channel,
                                to: cleanToPhone,
                                messageType: 'text',
                                messageContent: templateContent
                            };
                            // ✅ FROM null değilse payload'a ekle (null ise eklenmeyecek, SleekFlow default kullanacak)
                            if (cleanFromPhone) {
                                payload.from = cleanFromPhone;
                            }
                        }
                    } catch (templateError) {
                        // ✅ Template dosyalarını temizle
                        if (templateFiles && templateFiles.length > 0) {
                            templateFiles.forEach(file => {
                                if (file && file.path && fs.existsSync(file.path)) {
                                    try {
                                        fs.unlinkSync(file.path);
                                    } catch (unlinkError) {
                                        logger.error('Template dosya silme hatası', { error: unlinkError.message });
                                    }
                                }
                            });
                        }
                        
                        logger.error('❌ Template parametre işleme hatası', {
                            error: templateError.message,
                            stack: templateError.stack,
                            conversationId: id,
                            templateId: templateId,
                            templateFilesCount: templateFiles ? templateFiles.length : 0
                        });
                        return res.status(500).json({ 
                            error: 'Template parametreleri işlenirken hata oluştu: ' + templateError.message,
                            conversationId: id
                        });
                    }
                } else {
                    // ✅ Normal text mesaj
                    payload = {
                        channel: channel,
                        to: cleanToPhone,
                        messageType: 'text',
                        messageContent: text.trim()
                    };
                    // ✅ FROM null değilse payload'a ekle (null ise eklenmeyecek, SleekFlow default kullanacak)
                    if (cleanFromPhone) {
                        payload.from = cleanFromPhone;
                    }
                }
            }
            
            // ✅ DEBUG: Payload'ı logla (HAMZAH DESTEĞİ İÇİN DETAYLI)
            const cleanedFrom = isSocialMedia ? 'N/A (social media)' : cleanPhone(fromPhone);
            logger.info('Mesaj gönderme payload', {
                conversationId: id,
                payload: payload,
                originalFrom: fromPhone,
                originalTo: toPhone,
                cleanedFrom: cleanedFrom,
                cleanedTo: isSocialMedia ? 'N/A (social media)' : cleanPhone(toPhone),
                isSocialMedia: isSocialMedia,
                hasFromInPayload: !!payload.from, // ✅ HAMZAH DESTEĞİ: Payload'da from var mı?
                fromInPayload: payload.from // ✅ HAMZAH DESTEĞİ: Payload'daki from değeri
            });
            console.log('🔍 [BACKEND] Mesaj gönderme payload detayları:', {
                conversationId: id,
                payload: JSON.stringify(payload),
                fromPhone: fromPhone,
                cleanedFrom: cleanedFrom,
                hasFromInPayload: !!payload.from,
                fromInPayload: payload.from
            });

            try {
                // ✅ DEBUG: Mesaj gönderme öncesi log
                console.log('🚀 [BACKEND] Mesaj gönderme başlatılıyor:', {
                    conversationId: id,
                    channel,
                    fromPhone: isSocialMedia ? 'N/A (social media)' : fromPhone,
                    toPhone: isSocialMedia ? 'N/A (social media)' : toPhone,
                    messageLength: text.trim().length,
                    apiKeySet: !!apiKeyToUse,
                    baseUrl: finalBaseUrl,
                    payload: JSON.stringify(payload),
                    isSocialMedia: isSocialMedia
                });
                logger.info('Mesaj gönderiliyor', {
                    conversationId: id,
                    channel,
                    fromPhone: isSocialMedia ? 'N/A (social media)' : fromPhone,
                    toPhone: isSocialMedia ? 'N/A (social media)' : toPhone,
                    messageLength: text.trim().length,
                    apiKeySet: !!apiKeyToUse,
                    baseUrl: finalBaseUrl,
                    payload: payload,
                    isSocialMedia: isSocialMedia
                });
                
                // ✅ KRITIK: Payload'ı doğrula
                // ✅ WhatsApp için FROM gerekmez (null ise SleekFlow default kullanacak), sadece TO gerekli
                if (!isSocialMedia && !payload.to) {
                    logger.error('WhatsApp payload hatası - to eksik', {
                        conversationId: id,
                        channel,
                        payload: payload
                    });
                    return res.status(400).json({ 
                        error: 'WhatsApp mesajı için alıcı telefon numarası gerekli',
                        conversationId: id,
                        channel: channel,
                        payload: payload
                    });
                }
                
                // ✅ Mesaj gönder - RETRY MEKANİZMASI ile (Render.com free instance spin down için)
                let result;
                let lastError = null;
                const maxRetries = 3;
                const retryDelay = 2000; // 2 saniye bekle
                
                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    try {
                        logger.info(`📤 WhatsApp mesaj gönderiliyor (deneme ${attempt}/${maxRetries})`, {
                            conversationId: id,
                            channel,
                            attempt: attempt
                        });
                        
                        console.log(`🚀 [BACKEND] SleekFlow API'ye istek gönderiliyor (deneme ${attempt}/${maxRetries}):`, {
                            conversationId: id,
                            payload: JSON.stringify(payload),
                            baseUrl: finalBaseUrl
                        });
                        
                        result = await sleekflowService.call('post', '/api/message/send/json', {
                            data: payload
                        });
                        
                        console.log(`✅ [BACKEND] SleekFlow API response alındı (deneme ${attempt}):`, {
                            conversationId: id,
                            result: JSON.stringify(result),
                            resultType: typeof result
                        });
                        
                        // ✅ Başarılı - döngüden çık
                        logger.info(`✅ WhatsApp mesaj başarıyla gönderildi (deneme ${attempt})`, {
                            conversationId: id
                        });
                        break;
                    } catch (apiError) {
                        lastError = apiError;
                        
                        // ✅ KRITIK: 400 Bad Request gibi hataları hemen yakala - retry yapma!
                        const statusCode = apiError.status || apiError.response?.status;
                        if (statusCode === 400 || statusCode === 401 || statusCode === 403 || statusCode === 404) {
                            // ✅ 400/401/403/404 hataları retry yapılamaz - hemen durdur
                            logger.error(`❌ WhatsApp mesaj gönderme hatası (${statusCode}) - retry yapılmayacak`, {
                                conversationId: id,
                                error: apiError.message,
                                status: statusCode,
                                response: apiError.response?.data,
                                payload: payload,
                                attempt: attempt
                            });
                            break; // Hemen durdur
                        }
                        
                        // ✅ Timeout veya network hatası ise retry yap
                        const isRetryable = apiError.code === 'TIMEOUT' || 
                                          apiError.code === 'ECONNABORTED' || 
                                          apiError.code === 'NETWORK_ERROR' ||
                                          statusCode === 504 || 
                                          statusCode === 503 ||
                                          apiError.message?.includes('timeout') ||
                                          apiError.message?.includes('zaman aşımı') ||
                                          apiError.message?.includes('bağlanılamadı');
                        
                        if (isRetryable && attempt < maxRetries) {
                            logger.warn(`⚠️ WhatsApp mesaj gönderme hatası (deneme ${attempt}/${maxRetries}), ${retryDelay}ms sonra tekrar denenecek`, {
                                conversationId: id,
                                error: apiError.message,
                                attempt: attempt
                            });
                            
                            // Retry delay bekle
                            await new Promise(resolve => setTimeout(resolve, retryDelay));
                            continue; // Tekrar dene
                        } else {
                            // Son deneme veya retry yapılamaz hata - hata fırlat
                            break;
                        }
                    }
                }
                
                // ✅ Eğer hala hata varsa, son hatayı işle
                if (!result && lastError) {
                    const apiError = lastError;
                    // ✅ API hatasını detaylı logla - CIRCULAR REFERENCE ÖNLEME
                    const errorMessage = apiError.response?.data?.message || apiError.response?.data?.error || apiError.message;
                    const errorDetails = apiError.response?.data ? JSON.parse(JSON.stringify(apiError.response.data)) : null;
                    const statusCode = apiError.status || apiError.response?.status || 400;
                    
                    logger.error('❌ Mesaj gönderme API hatası', {
                        conversationId: id,
                        error: errorMessage,
                        status: statusCode,
                        response: errorDetails,
                        payload: payload
                    });
                    
                    // ✅ Hata mesajını kullanıcıya döndür - CIRCULAR REFERENCE ÖNLEME
                    return res.status(statusCode).json({ 
                        error: errorMessage || 'Mesaj gönderilemedi',
                        details: errorDetails,
                        conversationId: id
                    });
                }
                
                // ✅ KRITIK: SleekFlow API response'unu detaylı kontrol et
                console.log('🔍 [BACKEND] SleekFlow API response kontrol ediliyor:', {
                    conversationId: id,
                    result: JSON.stringify(result),
                    resultType: typeof result,
                    isArray: Array.isArray(result),
                    keys: result && typeof result === 'object' ? Object.keys(result) : 'N/A'
                });
                logger.info('SleekFlow API response', {
                    conversationId: id,
                    result: result,
                    resultType: typeof result,
                    isArray: Array.isArray(result),
                    keys: result && typeof result === 'object' ? Object.keys(result) : 'N/A'
                });
                
                // ✅ KRITIK: Result'un gerçekten başarılı olup olmadığını kontrol et
                let isActuallySuccess = true;
                let actualError = null;
                
                if (result && typeof result === 'object') {
                    // Array kontrolü
                    if (Array.isArray(result) && result.length > 0) {
                        const firstItem = result[0];
                        if (firstItem.error || firstItem.success === false || firstItem.status === 'failed' || firstItem.status === 'error' || firstItem.status === 'Failed') {
                            isActuallySuccess = false;
                            actualError = firstItem.error || firstItem.message || firstItem.channelStatusMessage || firstItem.status || 'Mesaj SleekFlow API tarafından reddedildi';
                        }
                        // ✅ Array'de messageId yoksa veya boşsa, mesaj gönderilmemiş demektir
                        if (isActuallySuccess && !firstItem.messageId && !firstItem.id && !firstItem.message_id) {
                            isActuallySuccess = false;
                            actualError = 'SleekFlow API mesaj ID döndürmedi - mesaj gönderilmemiş olabilir';
                        }
                    } else if (!Array.isArray(result)) {
                        // ✅ KRITIK: SleekFlow API response'unda status kontrolü
                        // SleekFlow API başarılı response döndürse bile, status: "Failed" olabilir!
                        if (result.status === 'Failed' || result.status === 'failed' || result.status === 'error' || result.status === 'Error') {
                            isActuallySuccess = false;
                            // ✅ channelStatusMessage varsa onu kullan, yoksa metadata.errors'dan al
                            actualError = result.channelStatusMessage || 
                                         (result.metadata?.errors && result.metadata.errors.length > 0 ? result.metadata.errors[0].message : null) ||
                                         result.message || 
                                         'Mesaj SleekFlow API tarafından reddedildi (status: Failed)';
                            
                            console.log('❌ [BACKEND] SleekFlow API mesaj gönderme başarısız (status: Failed):', {
                                conversationId: id,
                                status: result.status,
                                channelStatusMessage: result.channelStatusMessage,
                                metadataErrors: result.metadata?.errors,
                                result: JSON.stringify(result)
                            });
                        }
                        
                        // Object kontrolü - Daha kapsamlı hata kontrolü
                        const hasError = result.error || 
                                       result.success === false || 
                                       (result.message && (result.message.toLowerCase().includes('error') || result.message.toLowerCase().includes('failed') || result.message.toLowerCase().includes('not found'))) ||
                                       (result.code && result.code >= 400);
                        
                        if (hasError && isActuallySuccess) {
                            isActuallySuccess = false;
                            actualError = result.error || result.message || result.status || 'Mesaj SleekFlow API tarafından reddedildi';
                        }
                        
                        // ✅ metadata.errors kontrolü
                        if (isActuallySuccess && result.metadata && result.metadata.errors && Array.isArray(result.metadata.errors) && result.metadata.errors.length > 0) {
                            isActuallySuccess = false;
                            const firstError = result.metadata.errors[0];
                            actualError = firstError.message || firstError.code || 'Mesaj SleekFlow API tarafından reddedildi (metadata.errors)';
                            
                            console.log('❌ [BACKEND] SleekFlow API metadata.errors bulundu:', {
                                conversationId: id,
                                errors: result.metadata.errors,
                                result: JSON.stringify(result)
                            });
                        }
                    }
                } else if (!result) {
                    // Result null veya undefined ise hata
                    isActuallySuccess = false;
                    actualError = 'SleekFlow API yanıt vermedi';
                } else if (typeof result === 'string') {
                    // ✅ String response - hata mesajı olabilir
                    if (result.toLowerCase().includes('error') || result.toLowerCase().includes('failed') || result.toLowerCase().includes('not found')) {
                        isActuallySuccess = false;
                        actualError = result;
                    }
                }
                
                // ✅ Eğer gerçekten hata varsa, frontend'e hata döndür
                if (!isActuallySuccess) {
                    logger.error('❌ SleekFlow API mesaj gönderme hatası döndü', {
                        conversationId: id,
                        result: result,
                        payload: payload,
                        error: actualError
                    });
                    return res.status(400).json({ 
                        error: actualError || 'Mesaj SleekFlow API tarafından reddedildi',
                        details: result,
                        conversationId: id
                    });
                }
                
                // ✅ DEBUG: Başarılı mesaj gönderme log
                console.log('✅ [BACKEND] Mesaj başarıyla gönderildi (SleekFlow API onayladı):', {
                    conversationId: id,
                    result: JSON.stringify(result),
                    payload: JSON.stringify(payload)
                });
                logger.info('✅ Mesaj başarıyla gönderildi (SleekFlow API onayladı)', {
                    conversationId: id,
                    result: result,
                    payload: payload
                });
                
                return res.json({ 
                    success: true,
                    message: 'Mesaj gönderildi',
                    data: result
                });
            } catch (apiError) {
                if (res.headersSent) {
                    return;
                }
                
                // ✅ CIRCULAR REFERENCE ÖNLEME - response.data'yı güvenli şekilde al
                let errorResponseData = null;
                try {
                    errorResponseData = apiError.response?.data ? JSON.parse(JSON.stringify(apiError.response.data)) : null;
                } catch (e) {
                    // JSON.stringify başarısız olursa sadece message al
                    errorResponseData = { message: apiError.response?.data?.message || apiError.message };
                }
                
                const errorMsg = errorResponseData?.message || errorResponseData?.error || apiError.message || 'Mesaj gönderilemedi';
                const statusCode = apiError.response?.status || apiError.status || 500;
                
                logger.error('Mesaj gönderme hatası', {
                    error: errorMsg,
                    response: errorResponseData,
                    status: statusCode,
                    payload: payload,
                    channel,
                    fromPhone: isSocialMedia ? 'N/A' : fromPhone,
                    toPhone: isSocialMedia ? 'N/A' : toPhone,
                    apiKeySet: !!apiKeyToUse,
                    baseUrl: finalBaseUrl
                });
                
                return res.status(statusCode).json({ 
                    error: errorMsg,
                    details: errorResponseData || { message: apiError.message }
                });
            }
        }
}));

/**
 * GET /api/sleekflow/quick-replies
 * SleekFlow'dan saved replies (quick-replies) çek
 */
router.get('/quick-replies', asyncHandler(async (req, res, next) => {
    const { apiKey, baseUrl, limit = 10, offset = 0 } = req.query;
    
    // ✅ KRITIK: API key kontrolü
    if (!apiKey && !sleekflowApiKey) {
        return res.status(401).json({ 
            error: 'Sleekflow bağlantısı yok. Lütfen API anahtarınızı girin ve bağlanın.',
            templates: []
        });
    }
    
    try {
        const apiKeyToUse = apiKey || sleekflowApiKey;
        
        if (!apiKeyToUse || typeof apiKeyToUse !== 'string' || apiKeyToUse.trim().length < 10) {
            return res.status(400).json({ 
                error: 'Geçersiz API anahtarı. Lütfen doğru API anahtarını girin.',
                templates: []
            });
        }
        
        // ✅ KRITIK: baseUrl null/undefined/boş string kontrolü
        let finalBaseUrl = 'https://api.sleekflow.io'; // Default
        if (baseUrl && typeof baseUrl === 'string' && baseUrl.trim() && baseUrl.trim() !== 'undefined') {
            finalBaseUrl = baseUrl.trim();
        } else if (sleekflowBaseUrl && typeof sleekflowBaseUrl === 'string' && sleekflowBaseUrl.trim() && sleekflowBaseUrl.trim() !== 'undefined') {
            finalBaseUrl = sleekflowBaseUrl.trim();
        }
        
        // ✅ Service'e credentials'ı set et
        try {
            sleekflowService.setCredentials(apiKeyToUse, finalBaseUrl);
        } catch (credError) {
            logger.error('Quick-replies credentials hatası', {
                error: credError.message,
                apiKey: apiKeyToUse ? `${apiKeyToUse.substring(0, 10)}...` : 'yok',
                baseUrl: finalBaseUrl
            });
            return res.status(400).json({ 
                error: 'Geçersiz API anahtarı veya base URL',
                templates: []
            });
        }
        
        // ✅ Quick-replies API çağrısı
        const limitNum = parseInt(limit, 10) || 10;
        const offsetNum = parseInt(offset, 10) || 0;
        
        const result = await sleekflowService.call('get', `/api/quick-replies?limit=${limitNum}&offset=${offsetNum}`);
        
        // ✅ Response formatını düzenle (templates formatına çevir)
        const templates = (result || []).map(template => ({
            id: template.id?.toString() || '',
            name: template.name || 'Unnamed Template',
            content: template.text || '',
            order: template.order || 0
        }));
        
        return res.json({ 
            success: true,
            templates: templates,
            total: templates.length
        });
        
    } catch (apiError) {
        if (res.headersSent) {
            return;
        }
        
        logger.error('Quick-replies çekme hatası', {
            error: apiError.message,
            response: apiError.response?.data,
            status: apiError.response?.status,
            apiKey: apiKey ? `${apiKey.substring(0, 10)}...` : 'yok',
            baseUrl: baseUrl || sleekflowBaseUrl
        });
        
        const errorMsg = apiError.response?.data?.message || apiError.response?.data?.error || apiError.message || 'Quick-replies çekilemedi';
        const statusCode = apiError.response?.status || 500;
        
        return res.status(statusCode).json({ 
            error: errorMsg,
            templates: []
        });
    }
}));

/**
 * POST /api/sleekflow/quick-replies
 * SleekFlow'a yeni quick-reply (saved reply) ekle
 */
router.post('/quick-replies', asyncHandler(async (req, res, next) => {
    const { apiKey, baseUrl, name, text, order } = req.body || req.query || {};
    
    // ✅ KRITIK: API key kontrolü
    if (!apiKey && !sleekflowApiKey) {
        return res.status(401).json({ 
            error: 'Sleekflow bağlantısı yok. Lütfen API anahtarınızı girin ve bağlanın.'
        });
    }
    
    if (!name || !text) {
        return res.status(400).json({ 
            error: 'name ve text parametreleri gerekli'
        });
    }
    
    try {
        const apiKeyToUse = apiKey || sleekflowApiKey;
        
        if (!apiKeyToUse || typeof apiKeyToUse !== 'string' || apiKeyToUse.trim().length < 10) {
            return res.status(400).json({ 
                error: 'Geçersiz API anahtarı. Lütfen doğru API anahtarını girin.'
            });
        }
        
        // ✅ KRITIK: baseUrl null/undefined/boş string kontrolü
        let finalBaseUrl = 'https://api.sleekflow.io'; // Default
        if (baseUrl && typeof baseUrl === 'string' && baseUrl.trim() && baseUrl.trim() !== 'undefined') {
            finalBaseUrl = baseUrl.trim();
        } else if (sleekflowBaseUrl && typeof sleekflowBaseUrl === 'string' && sleekflowBaseUrl.trim() && sleekflowBaseUrl.trim() !== 'undefined') {
            finalBaseUrl = sleekflowBaseUrl.trim();
        }
        
        // ✅ Service'e credentials'ı set et
        try {
            sleekflowService.setCredentials(apiKeyToUse, finalBaseUrl);
        } catch (credError) {
            logger.error('Quick-reply create credentials hatası', {
                error: credError.message,
                apiKey: apiKeyToUse ? `${apiKeyToUse.substring(0, 10)}...` : 'yok',
                baseUrl: finalBaseUrl
            });
            return res.status(400).json({ 
                error: 'Geçersiz API anahtarı veya base URL'
            });
        }
        
        // ✅ Quick-reply oluşturma payload'ı
        const payload = {
            name: name.trim(),
            text: text.trim()
        };
        
        if (order !== undefined && order !== null) {
            payload.order = parseInt(order, 10) || 0;
        }
        
        logger.info('Quick-reply oluşturuluyor', { name: payload.name });
        
        // ✅ SleekFlow API'ye POST isteği
        const result = await sleekflowService.call('post', '/api/quick-replies', {
            data: payload
        });
        
        logger.info('Quick-reply oluşturuldu', { id: result.id, name: result.name });
        
        return res.json({ 
            success: true,
            message: 'Quick-reply başarıyla oluşturuldu',
            template: {
                id: result.id?.toString() || '',
                name: result.name || payload.name,
                content: result.text || payload.text,
                order: result.order || payload.order || 0,
                type: 'quick-reply'
            }
        });
        
    } catch (apiError) {
        if (res.headersSent) {
            return;
        }
        
        logger.error('Quick-reply oluşturma hatası', {
            error: apiError.message,
            response: apiError.response?.data,
            status: apiError.response?.status,
            apiKey: apiKey ? `${apiKey.substring(0, 10)}...` : 'yok',
            baseUrl: baseUrl || sleekflowBaseUrl
        });
        
        const errorMsg = apiError.response?.data?.message || apiError.response?.data?.error || apiError.message || 'Quick-reply oluşturulamadı';
        const statusCode = apiError.response?.status || 500;
        
        return res.status(statusCode).json({ 
            error: errorMsg
        });
    }
}));

/**
 * DELETE /api/sleekflow/quick-replies/:id
 * SleekFlow'dan quick-reply (saved reply) sil
 */
router.delete('/quick-replies/:id', asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const { apiKey, baseUrl } = req.query || req.body || {};
    
    // ✅ KRITIK: API key kontrolü
    if (!apiKey && !sleekflowApiKey) {
        return res.status(401).json({ 
            error: 'Sleekflow bağlantısı yok. Lütfen API anahtarınızı girin ve bağlanın.'
        });
    }
    
    if (!id) {
        return res.status(400).json({ 
            error: 'Template ID gerekli'
        });
    }
    
    try {
        const apiKeyToUse = apiKey || sleekflowApiKey;
        
        if (!apiKeyToUse || typeof apiKeyToUse !== 'string' || apiKeyToUse.trim().length < 10) {
            return res.status(400).json({ 
                error: 'Geçersiz API anahtarı. Lütfen doğru API anahtarını girin.'
            });
        }
        
        // ✅ KRITIK: baseUrl null/undefined/boş string kontrolü
        let finalBaseUrl = 'https://api.sleekflow.io'; // Default
        if (baseUrl && typeof baseUrl === 'string' && baseUrl.trim() && baseUrl.trim() !== 'undefined') {
            finalBaseUrl = baseUrl.trim();
        } else if (sleekflowBaseUrl && typeof sleekflowBaseUrl === 'string' && sleekflowBaseUrl.trim() && sleekflowBaseUrl.trim() !== 'undefined') {
            finalBaseUrl = sleekflowBaseUrl.trim();
        }
        
        // ✅ Service'e credentials'ı set et
        try {
            sleekflowService.setCredentials(apiKeyToUse, finalBaseUrl);
        } catch (credError) {
            logger.error('Quick-reply delete credentials hatası', {
                error: credError.message,
                apiKey: apiKeyToUse ? `${apiKeyToUse.substring(0, 10)}...` : 'yok',
                baseUrl: finalBaseUrl
            });
            return res.status(400).json({ 
                error: 'Geçersiz API anahtarı veya base URL'
            });
        }
        
        logger.info('Quick-reply siliniyor', { id });
        
        // ✅ SleekFlow API'ye DELETE isteği
        await sleekflowService.call('delete', `/api/quick-replies/${id}`);
        
        logger.info('Quick-reply silindi', { id });
        
        return res.json({ 
            success: true,
            message: 'Quick-reply başarıyla silindi'
        });
        
    } catch (apiError) {
        if (res.headersSent) {
            return;
        }
        
        logger.error('Quick-reply silme hatası', {
            error: apiError.message,
            response: apiError.response?.data,
            status: apiError.response?.status,
            apiKey: apiKey ? `${apiKey.substring(0, 10)}...` : 'yok',
            baseUrl: baseUrl || sleekflowBaseUrl,
            id: id
        });
        
        const errorMsg = apiError.response?.data?.message || apiError.response?.data?.error || apiError.message || 'Quick-reply silinemedi';
        const statusCode = apiError.response?.status || 500;
        
        return res.status(statusCode).json({ 
            error: errorMsg
        });
    }
}));

/**
 * GET /api/sleekflow/whatsapp-templates
 * SleekFlow'dan WhatsApp Business API template'lerini çek
 */
router.get('/whatsapp-templates', asyncHandler(async (req, res, next) => {
    const { apiKey, baseUrl, limit = 100, offset = 0 } = req.query;
    
    // ✅ KRITIK: API key kontrolü
    if (!apiKey && !sleekflowApiKey) {
        return res.status(401).json({ 
            error: 'Sleekflow bağlantısı yok. Lütfen API anahtarınızı girin ve bağlanın.',
            templates: []
        });
    }
    
    try {
        const apiKeyToUse = apiKey || sleekflowApiKey;
        
        if (!apiKeyToUse || typeof apiKeyToUse !== 'string' || apiKeyToUse.trim().length < 10) {
            return res.status(400).json({ 
                error: 'Geçersiz API anahtarı. Lütfen doğru API anahtarını girin.',
                templates: []
            });
        }
        
        // ✅ KRITIK: baseUrl null/undefined/boş string kontrolü
        let finalBaseUrl = 'https://api.sleekflow.io'; // Default
        if (baseUrl && typeof baseUrl === 'string' && baseUrl.trim() && baseUrl.trim() !== 'undefined') {
            finalBaseUrl = baseUrl.trim();
        } else if (sleekflowBaseUrl && typeof sleekflowBaseUrl === 'string' && sleekflowBaseUrl.trim() && sleekflowBaseUrl.trim() !== 'undefined') {
            finalBaseUrl = sleekflowBaseUrl.trim();
        }
        
        // ✅ Service'e credentials'ı set et
        try {
            sleekflowService.setCredentials(apiKeyToUse, finalBaseUrl);
        } catch (credError) {
            logger.error('WhatsApp templates credentials hatası', {
                error: credError.message,
                apiKey: apiKeyToUse ? `${apiKeyToUse.substring(0, 10)}...` : 'yok',
                baseUrl: finalBaseUrl
            });
            return res.status(400).json({ 
                error: 'Geçersiz API anahtarı veya base URL',
                templates: []
            });
        }
        
        // ✅ WhatsApp templates API çağrısı
        const limitNum = parseInt(limit, 10) || 100;
        const offsetNum = parseInt(offset, 10) || 0;
        
        // ✅ WhatsApp Business API template'leri için endpoint (standart)
        const result = await sleekflowService.call('get', `/api/whatsapp/templates?limit=${limitNum}&offset=${offsetNum}`);
        const rawTemplates = Array.isArray(result) ? result : (result.data || result.items || result.templates || []);
        
        // ✅ Response formatını düzenle (templates formatına çevir)
        const templates = rawTemplates.map(template => {
            // WhatsApp template formatından standart formata çevir
            // Template title, body, category, language, status alanlarını kontrol et
            const templateName = template.name || template.templateTitle || template.title || template.template_name || 'Unnamed Template';
            const templateContent = template.body || template.text || template.content || template.template_body || template.message || '';
            const templateId = template.id?.toString() || template.templateId?.toString() || template.template_id?.toString() || '';
            const category = template.category || template.template_category || '';
            const language = template.language || template.template_language || template.lang || '';
            const status = template.status || template.template_status || template.state || '';
            
            return {
                id: templateId,
                name: templateName,
                content: templateContent,
                category: category,
                language: language,
                status: status,
                order: template.order || 0,
                type: 'whatsapp' // WhatsApp template olduğunu belirt
            };
        });
        
        return res.json({ 
            success: true,
            templates: templates,
            total: templates.length
        });
        
    } catch (apiError) {
        if (res.headersSent) {
            return;
        }
        
        logger.error('WhatsApp templates çekme hatası', {
            error: apiError.message,
            response: apiError.response?.data,
            status: apiError.response?.status,
            apiKey: apiKey ? `${apiKey.substring(0, 10)}...` : 'yok',
            baseUrl: baseUrl || sleekflowBaseUrl
        });
        
        const errorMsg = apiError.response?.data?.message || apiError.response?.data?.error || apiError.message || 'WhatsApp templates çekilemedi';
        const statusCode = apiError.response?.status || 500;
        
        return res.status(statusCode).json({ 
            error: errorMsg,
            templates: []
        });
    }
}));

/**
 * POST /api/sleekflow/cloudapi-templates
 * SleekFlow'a yeni Cloud API template ekle
 */
router.post('/cloudapi-templates', asyncHandler(async (req, res, next) => {
    const { apiKey, baseUrl, channelNumber, name, content, category, language } = req.body || req.query || {};
    
    // ✅ KRITIK: API key ve channelNumber kontrolü
    if (!apiKey && !sleekflowApiKey) {
        return res.status(401).json({ 
            error: 'Sleekflow bağlantısı yok. Lütfen API anahtarınızı girin ve bağlanın.'
        });
    }
    
    if (!channelNumber || !name || !content) {
        return res.status(400).json({ 
            error: 'channelNumber, name ve content parametreleri gerekli'
        });
    }
    
    try {
        const apiKeyToUse = apiKey || sleekflowApiKey;
        
        if (!apiKeyToUse || typeof apiKeyToUse !== 'string' || apiKeyToUse.trim().length < 10) {
            return res.status(400).json({ 
                error: 'Geçersiz API anahtarı. Lütfen doğru API anahtarını girin.'
            });
        }
        
        // ✅ KRITIK: baseUrl null/undefined/boş string kontrolü
        let finalBaseUrl = 'https://api.sleekflow.io'; // Default
        if (baseUrl && typeof baseUrl === 'string' && baseUrl.trim() && baseUrl.trim() !== 'undefined') {
            finalBaseUrl = baseUrl.trim();
        } else if (sleekflowBaseUrl && typeof sleekflowBaseUrl === 'string' && sleekflowBaseUrl.trim() && sleekflowBaseUrl.trim() !== 'undefined') {
            finalBaseUrl = sleekflowBaseUrl.trim();
        }
        
        // ✅ Service'e credentials'ı set et
        try {
            sleekflowService.setCredentials(apiKeyToUse, finalBaseUrl);
        } catch (credError) {
            logger.error('Cloud API template create credentials hatası', {
                error: credError.message,
                apiKey: apiKeyToUse ? `${apiKeyToUse.substring(0, 10)}...` : 'yok',
                baseUrl: finalBaseUrl
            });
            return res.status(400).json({ 
                error: 'Geçersiz API anahtarı veya base URL'
            });
        }
        
        // ✅ Cloud API template oluşturma payload'ı
        // WhatsApp Cloud API template formatına göre düzenle
        const payload = {
            name: name.trim(),
            language: (language || 'en_US').trim(),
            category: (category || 'UTILITY').trim().toUpperCase(),
            components: [
                {
                    type: 'BODY',
                    text: content.trim()
                }
            ]
        };
        
        logger.info('Cloud API template oluşturuluyor', { name: payload.name, channelNumber });
        
        // ✅ SleekFlow API'ye POST isteği - Cloud API template oluşturma
        // Not: SleekFlow API'sinde bu endpoint olmayabilir, Meta üzerinden yönetilmesi gerekebilir
        try {
            const result = await sleekflowService.call('post', `/api/cloudapi/template?channelNumber=${encodeURIComponent(channelNumber)}`, {
                data: payload
            });
            
            logger.info('Cloud API template oluşturuldu', { id: result.id, name: result.name });
            
            return res.json({ 
                success: true,
                message: 'Cloud API template başarıyla oluşturuldu (onay bekliyor)',
                template: {
                    id: result.id?.toString() || result.name || '',
                    name: result.name || payload.name,
                    content: content.trim(),
                    category: result.category || payload.category,
                    language: result.language || payload.language,
                    status: result.status || 'PENDING',
                    type: 'cloudapi'
                }
            });
        } catch (apiError) {
            // ✅ Eğer endpoint yoksa veya hata verirse, kullanıcıya bilgi ver
            logger.warn('Cloud API template oluşturma hatası (Meta üzerinden yönetilmesi gerekebilir)', {
                error: apiError.message,
                response: apiError.response?.data,
                status: apiError.response?.status
            });
            
            // ✅ Alternatif: Quick-reply olarak kaydet (her zaman çalışır)
            const quickReplyPayload = {
                name: name.trim(),
                text: content.trim(),
                order: 0
            };
            
            try {
                const quickReplyResult = await sleekflowService.call('post', '/api/quick-replies', {
                    data: quickReplyPayload
                });
                
                logger.info('Cloud API template quick-reply olarak kaydedildi', { id: quickReplyResult.id });
                
                return res.json({ 
                    success: true,
                    message: 'Cloud API template\'leri Meta üzerinden yönetilir. Template quick-reply olarak kaydedildi.',
                    template: {
                        id: quickReplyResult.id?.toString() || '',
                        name: quickReplyResult.name || quickReplyPayload.name,
                        content: quickReplyResult.text || quickReplyPayload.text,
                        type: 'quick-reply',
                        order: quickReplyResult.order || 0
                    }
                });
            } catch (quickReplyError) {
                const errorMsg = apiError.response?.data?.message || apiError.response?.data?.error || apiError.message || 'Template oluşturulamadı';
                const statusCode = apiError.response?.status || 500;
                
                return res.status(statusCode).json({ 
                    error: errorMsg + ' (Not: Cloud API template\'leri Meta Business Manager üzerinden oluşturulmalıdır)'
                });
            }
        }
        
    } catch (error) {
        if (res.headersSent) {
            return;
        }
        
        logger.error('Cloud API template oluşturma genel hatası', {
            error: error.message,
            stack: error.stack
        });
        
        return res.status(500).json({ 
            error: 'Template oluşturulamadı: ' + error.message
        });
    }
}));

/**
 * GET /api/sleekflow/cloudapi-templates
 * SleekFlow'dan WhatsApp Cloud API template'lerini çek
 */
router.get('/cloudapi-templates', asyncHandler(async (req, res, next) => {
    const { apiKey, baseUrl, channelNumber } = req.query;
    
    // ✅ KRITIK: API key ve channelNumber kontrolü
    if (!apiKey && !sleekflowApiKey) {
        return res.status(401).json({ 
            error: 'Sleekflow bağlantısı yok. Lütfen API anahtarınızı girin ve bağlanın.',
            templates: []
        });
    }
    
    if (!channelNumber) {
        return res.status(400).json({ 
            error: 'channelNumber parametresi gerekli',
            templates: []
        });
    }
    
    try {
        const apiKeyToUse = apiKey || sleekflowApiKey;
        
        if (!apiKeyToUse || typeof apiKeyToUse !== 'string' || apiKeyToUse.trim().length < 10) {
            return res.status(400).json({ 
                error: 'Geçersiz API anahtarı. Lütfen doğru API anahtarını girin.',
                templates: []
            });
        }
        
        // ✅ KRITIK: baseUrl null/undefined/boş string kontrolü
        let finalBaseUrl = 'https://api.sleekflow.io'; // Default
        if (baseUrl && typeof baseUrl === 'string' && baseUrl.trim() && baseUrl.trim() !== 'undefined') {
            finalBaseUrl = baseUrl.trim();
        } else if (sleekflowBaseUrl && typeof sleekflowBaseUrl === 'string' && sleekflowBaseUrl.trim() && sleekflowBaseUrl.trim() !== 'undefined') {
            finalBaseUrl = sleekflowBaseUrl.trim();
        }
        
        // ✅ Service'e credentials'ı set et
        try {
            sleekflowService.setCredentials(apiKeyToUse, finalBaseUrl);
        } catch (credError) {
            logger.error('Cloud API templates credentials hatası', {
                error: credError.message,
                apiKey: apiKeyToUse ? `${apiKeyToUse.substring(0, 10)}...` : 'yok',
                baseUrl: finalBaseUrl
            });
            return res.status(400).json({ 
                error: 'Geçersiz API anahtarı veya base URL',
                templates: []
            });
        }
        
        // ✅ Cloud API template'leri için endpoint
        logger.info('Cloud API templates çekiliyor', { channelNumber });
        const result = await sleekflowService.call('get', `/api/cloudapi/template?channelNumber=${encodeURIComponent(channelNumber)}`);
        
        // ✅ Response formatını düzenle
        // API response: { whatsappTemplates: [...] }
        const rawTemplates = result.whatsappTemplates || result.templates || [];
        
        logger.info('Cloud API templates alındı', { count: rawTemplates.length });
        
        const templates = rawTemplates.map(template => {
            // Components array'inden BODY text'ini bul
            let bodyText = '';
            const bodyComponent = template.components?.find(c => c.type === 'BODY');
            if (bodyComponent && bodyComponent.text) {
                bodyText = bodyComponent.text;
            }
            
        
    
            if (!bodyText && template.components) {
                const textComponents = template.components
                    .filter(c => c.text)
                    .map(c => c.text)
                    .join('\n');
                bodyText = textComponents;
            }
            
            return {
                id: template.id?.toString() || template.name || '',
                name: template.name || 'Unnamed Template',
                content: bodyText || '',
                category: template.category || '',
                language: template.language || '',
                status: template.status || '',
                order: 0,
                type: 'cloudapi', // Cloud API template olduğunu belirt
                components: template.components || [] // Components array'ini sakla (medya için)
            };
        });
        
        return res.json({ 
            success: true,
            templates: templates,
            whatsappTemplates: templates, // API formatı için
            total: templates.length
        });
        
    } catch (apiError) {
        if (res.headersSent) {
            return;
        }
        
        logger.error('Cloud API templates çekme hatası', {
            error: apiError.message,
            response: apiError.response?.data,
            status: apiError.response?.status,
            apiKey: apiKey ? `${apiKey.substring(0, 10)}...` : 'yok',
            baseUrl: baseUrl || sleekflowBaseUrl,
            channelNumber: channelNumber
        });
        
        const errorMsg = apiError.response?.data?.message || apiError.response?.data?.error || apiError.message || 'Cloud API templates çekilemedi';
        const statusCode = apiError.response?.status || 500;
        
        return res.status(statusCode).json({ 
            error: errorMsg,
            templates: []
        });
    }
}));

/**
 * GET /api/sleekflow/conversation/:id
 * Conversation detayları - 24 saat kuralı kontrolü için
 */
router.get('/conversation/:id', asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const { apiKey, baseUrl } = req.query;

    const sleekflowApiKey = apiKey || process.env.SLEEKFLOW_API_KEY;
    const sleekflowBaseUrl = baseUrl || process.env.SLEEKFLOW_BASE_URL;

    if (!sleekflowApiKey) {
        return res.status(401).json({
            error: 'Sleekflow bağlantısı yok. Lütfen API anahtarınızı girin ve bağlanın.',
            conversation: null
        });
    }

    try {
        const finalBaseUrl = (sleekflowBaseUrl && typeof sleekflowBaseUrl === 'string' && sleekflowBaseUrl.trim())
            ? sleekflowBaseUrl.trim()
            : 'https://api.sleekflow.io';
        sleekflowService.setCredentials(sleekflowApiKey, finalBaseUrl);

        const convResponse = await sleekflowService.call('get', `/api/conversation/${id}`);
        const conversation = Array.isArray(convResponse) ? convResponse[0] : (convResponse.data || convResponse);

        if (!conversation) {
            return res.status(404).json({ error: 'Conversation bulunamadı', conversation: null });
        }

        res.json({ conversation });
    } catch (error) {
        logger.error('Conversation detayları çekilirken hata:', {
            conversationId: id,
            error: error.message,
            status: error.response?.status,
            response: error.response?.data
        });
        res.status(error.response?.status || 500).json({
            error: 'Conversation detayları çekilemedi: ' + (error.response?.data?.message || error.message),
            conversation: null
        });
    }
}));

/**
 * Helper function: reply-window-status ile toplu kontrol
 */
async function checkReplyWindowStatus(conversationIds, apiKey, baseUrl) {
    const payload = {};
    if (conversationIds && conversationIds.length > 0) {
        payload.conversationIds = conversationIds;
    }

    if (Object.keys(payload).length === 0) {
        logger.warn('checkReplyWindowStatus: conversationIds boş');
        return [];
    }

    try {
        sleekflowService.setCredentials(apiKey, baseUrl);
        const result = await sleekflowService.call('post', '/api/whatsapp/reply-window-status', { data: payload });
        return result || [];
    } catch (error) {
        logger.error('checkReplyWindowStatus API hatası', {
            error: error.message,
            response: error.response?.data,
            status: error.response?.status
        });
        return [];
    }
}

/**
 * Helper function: Telefon numarasından conversation ID bul
 */
async function findConversationByPhone(phoneNumber, apiKey, baseUrl) {
    try {
        const finalBaseUrl = (baseUrl && typeof baseUrl === 'string' && baseUrl.trim() && baseUrl.trim() !== 'undefined')
            ? baseUrl.trim()
            : 'https://api.sleekflow.io';
        
        sleekflowService.setCredentials(apiKey, finalBaseUrl);
        
        // Conversation'ları ara (phone number ile)
        const conversations = await sleekflowService.call('get', '/api/conversation', {
            params: { limit: 100 }
        });
        
        const convList = Array.isArray(conversations) ? conversations : (conversations.data || conversations.conversations || []);
        
        // Telefon numarasını temizle
        const cleanPhone = (phone) => {
            if (!phone) return '';
            return phone.toString().replace(/\D/g, '');
        };
        
        const cleanTargetPhone = cleanPhone(phoneNumber);
        
        // Conversation'ları ara
        for (const conv of convList) {
            const convPhone = cleanPhone(conv.toPhone || conv.to || conv.receiverPhone || conv.userProfile?.phoneNumber || '');
            if (convPhone === cleanTargetPhone) {
                return conv.id || conv.conversationId;
            }
        }
        
        return null; // Conversation bulunamadı
    } catch (error) {
        logger.error('Conversation arama hatası', {
            phoneNumber,
            error: error.message
        });
        return null;
    }
}

/**
 * POST /api/sleekflow/bulk-send
 * Toplu mesaj gönderme - Zoho CRM'den lead'ler seçilerek toplu mesaj gönderme
 */
router.post('/bulk-send', asyncHandler(async (req, res, next) => {
    const { phoneNumbers, messageContent, templateId, templateName, templateLanguage, apiKey, baseUrl, channel = 'whatsappcloudapi', fromPhone } = req.body;
    
    // ✅ Validasyon
    if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
        return res.status(400).json({
            error: 'Telefon numaraları gerekli (array)',
            success: false
        });
    }
    
    if (!messageContent && !templateId && !templateName) {
        return res.status(400).json({
            error: 'Mesaj içeriği veya template ID/name gerekli',
            success: false
        });
    }
    
    // Maximum 100 telefon numarası (rate limiting için)
    if (phoneNumbers.length > 100) {
        return res.status(400).json({
            error: 'Maksimum 100 telefon numarası gönderebilirsiniz',
            success: false
        });
    }
    
    // ✅ API key kontrolü
    const apiKeyToUse = apiKey || sleekflowApiKey;
    if (!apiKeyToUse) {
        return res.status(401).json({
            error: 'Sleekflow bağlantısı yok. Lütfen API anahtarınızı girin ve bağlanın.',
            success: false
        });
    }
    
    const finalBaseUrl = (baseUrl && typeof baseUrl === 'string' && baseUrl.trim() && baseUrl.trim() !== 'undefined')
        ? baseUrl.trim()
        : (sleekflowBaseUrl || 'https://api.sleekflow.io');
    
    try {
        sleekflowService.setCredentials(apiKeyToUse, finalBaseUrl);
        
        // ✅ Telefon numaralarını temizle
        const cleanPhone = (phone) => {
            if (!phone) return '';
            return phone.toString().replace(/\D/g, '');
        };
        
        const cleanedPhones = phoneNumbers.map(phone => cleanPhone(phone)).filter(phone => phone.length > 0);
        
        if (cleanedPhones.length === 0) {
            return res.status(400).json({
                error: 'Geçerli telefon numarası bulunamadı',
                success: false
            });
        }
        
        logger.info('📤 Toplu mesaj gönderme başlatıldı', {
            phoneCount: cleanedPhones.length,
            hasTemplate: !!templateId || !!templateName,
            channel
        });
        
        // ✅ 1. ADIM: Her telefon numarası için conversation ID bul ve fromPhone'u al
        const conversationMap = {}; // { phoneNumber: conversationId }
        const conversationDataMap = {}; // { phoneNumber: { conversationId, fromPhone, toPhone } }
        const conversationIds = [];
        
        for (const phone of cleanedPhones) {
            const convId = await findConversationByPhone(phone, apiKeyToUse, finalBaseUrl);
            if (convId) {
                conversationMap[phone] = convId;
                conversationIds.push(convId);
                
                // Conversation detaylarını al (fromPhone için)
                try {
                    const convData = await sleekflowService.call('get', `/api/conversation/${convId}`);
                    const cleanPhoneFunc = (p) => p ? p.toString().replace(/\D/g, '') : '';
                    
                    // ✅ AYNI MANTIK: Outgoing mesajlardan FROM bul (normal UI'daki gibi)
                    let foundFromPhone = null;
                    const customerPhone = cleanPhoneFunc(convData.userProfile?.phoneNumber || convData.userProfile?.phone || convData.userProfile?.mobile || '');
                    
                    try {
                        // Mesajları çek ve outgoing mesajlardan FROM bul
                        const messagesResponse = await sleekflowService.call('get', `/api/conversation/message/${convId}`, {
                            params: { limit: 10, offset: 0 }
                        });
                        const messages = Array.isArray(messagesResponse) ? messagesResponse : (messagesResponse.data || messagesResponse.messages || []);
                        
                        // ✅ Sadece outgoing (sent) mesajların FROM'unu kullan
                        const outgoingFromNumbers = new Set();
                        for (const msg of messages) {
                            const msgDirection = (msg.direction || (msg.isSentFromSleekflow ? 'sent' : 'received')).toLowerCase();
                            const isOutgoing = msgDirection === 'sent' || msg.isSentFromSleekflow === true;
                            
                            if (isOutgoing) {
                                const msgFrom = cleanPhoneFunc(msg.from || msg.fromPhone || msg.senderPhone || '');
                                if (msgFrom) {
                                    outgoingFromNumbers.add(msgFrom);
                                }
                            }
                        }
                        
                        const outgoingFromArray = Array.from(outgoingFromNumbers);
                        if (outgoingFromArray.length > 0) {
                            foundFromPhone = outgoingFromArray[0]; // İlk outgoing FROM'u kullan (business numarası)
                        }
                    } catch (msgErr) {
                        // Mesajlardan bulunamadıysa, conversationData'dan al (fallback)
                        logger.warn('⚠️ Mesajlardan FROM bulunamadı, conversationData kullanılıyor', { convId, error: msgErr.message });
                    }
                    
                    // ✅ Fallback: Eğer outgoing mesajlardan bulunamadıysa, conversationData'dan al
                    if (!foundFromPhone) {
                        const convFrom = cleanPhoneFunc(convData.fromPhone || convData.from || convData.senderPhone || '');
                        // ✅ ÖNEMLİ: ConversationData'dan alınan FROM customer numarası olabilir, kontrol et
                        if (convFrom && convFrom !== customerPhone) {
                            foundFromPhone = convFrom;
                        } else {
                            // ✅ FROM customer numarası veya boş, null yap (SleekFlow default kullanacak)
                            foundFromPhone = null;
                            logger.warn('⚠️ Bulk-send: ConversationData FROM customer numarası veya boş, null yapılıyor', { 
                                convFrom,
                                customerPhone
                            });
                        }
                    }
                    
                    // ✅ WhatsApp için FROM kontrolü: Eğer FROM customer'ın numarası ise null yap
                    if (foundFromPhone && (foundFromPhone === customerPhone)) {
                        logger.warn('⚠️ Bulk-send: FROM customer numarası, null yapılıyor', { 
                            fromPhone: foundFromPhone,
                            customerPhone
                        });
                        foundFromPhone = null;
                    }
                    
                    // ✅ Eğer FROM hala null değilse, logla
                    if (foundFromPhone) {
                        logger.info('✅ Bulk-send: FROM bulundu (outgoing mesajlardan veya conversationData)', { 
                            fromPhone: foundFromPhone,
                            customerPhone,
                            phone
                        });
                    } else {
                        logger.info('✅ Bulk-send: FROM null, SleekFlow default kullanılacak', { 
                            customerPhone,
                            phone
                        });
                    }
                    
                    conversationDataMap[phone] = {
                        conversationId: convId,
                        fromPhone: foundFromPhone || '', // null ise boş string
                        toPhone: cleanPhoneFunc(convData.toPhone || convData.to || convData.receiverPhone || '')
                    };
                } catch (convError) {
                    logger.warn('⚠️ Conversation detayları alınamadı', { convId, error: convError.message });
                    conversationDataMap[phone] = { conversationId: convId, fromPhone: '', toPhone: '' };
                }
            }
        }
        
        logger.info('✅ Conversation ID\'leri bulundu', {
            found: conversationIds.length,
            total: cleanedPhones.length
        });
        
        // ✅ 2. ADIM: reply-window-status ile toplu kontrol (eğer conversation ID'ler varsa)
        const windowStatusMap = {}; // { conversationId: { isTemplateMessageRequired: true/false } }
        
        if (conversationIds.length > 0) {
            try {
                const statusResults = await checkReplyWindowStatus(conversationIds, apiKeyToUse, finalBaseUrl);
                
                for (const status of statusResults) {
                    if (status.conversationId) {
                        windowStatusMap[status.conversationId] = {
                            isTemplateMessageRequired: status.isTemplateMessageRequired || false,
                            lastClientMessageReceivedAt: status.lastClientMessageReceivedAt,
                            whatsappPhoneNumber: status.whatsappPhoneNumber
                        };
                    }
                }
                
                logger.info('✅ Window status kontrolü tamamlandı', {
                    checked: statusResults.length,
                    templateRequired: statusResults.filter(s => s.isTemplateMessageRequired).length
                });
            } catch (statusError) {
                logger.warn('⚠️ Window status kontrolü başarısız, devam ediliyor', {
                    error: statusError.message
                });
                // Hata olsa bile devam et, her mesajı template olarak göndermeyi dene
            }
        }
        
        // ✅ 3. ADIM: Her telefon numarası için mesaj gönder
        const results = [];
        const errors = [];
        
        for (const phone of cleanedPhones) {
            try {
                const convId = conversationMap[phone];
                const convData = conversationDataMap[phone] || {};
                const windowStatus = convId ? windowStatusMap[convId] : null;
                const needsTemplate = windowStatus?.isTemplateMessageRequired || false;
                
                // ✅ BULK-SEND İÇİN FROM: Eğer fromPhone parametresi gönderilmişse kullan (VIP veya Hamzah için)
                // ✅ Normal UI'daki gibi: fromPhone gönderilmişse kullan, yoksa null yap (SleekFlow default kullanacak)
                const cleanPhoneFunc = (p) => p ? p.toString().replace(/\D/g, '') : '';
                const requestedFromPhone = fromPhone ? cleanPhoneFunc(fromPhone) : null;
                const senderPhone = requestedFromPhone; // ✅ VIP veya Hamzah için fromPhone kullan
                
                if (senderPhone) {
                    logger.info('✅ Bulk-send: FROM kullanılıyor (VIP veya Hamzah)', { 
                        phone,
                        fromPhone: senderPhone,
                        note: 'Seçili sender numarası kullanılıyor'
                    });
                } else {
                logger.info('✅ Bulk-send: FROM null (SleekFlow default channel kullanılacak)', { 
                    phone,
                        note: 'FROM gönderilmedi, SleekFlow default channel otomatik seçilecek'
                });
                }
                
                // ✅ Mesaj tipini belirle
                let payload;
                
                if (needsTemplate || templateId || templateName) {
                    // Template mesaj gönder
                    if (!templateId && !templateName) {
                        errors.push({
                            phone,
                            error: 'Template mesaj gerekli ama template ID/name verilmemiş',
                            conversationId: convId
                        });
                        continue;
                    }
                    
                    // Template mesaj payload'ı oluştur
                    payload = {
                        channel: channel,
                        to: phone,
                        messageType: 'template',
                        extendedMessage: {
                            whatsappCloudApiTemplateMessageObject: {
                                templateName: templateName || templateId,
                                language: templateLanguage || 'tr',
                                components: [] // Parametreler varsa buraya eklenebilir
                            }
                        }
                    };
                    
                    // ✅ HAMZAH DESTEĞİ: FROM null değilse payload'a ekle (VIP veya Hamzah için)
                    // ✅ Normal UI'daki gibi: fromPhone gönderilmişse kullan
                    if (senderPhone) {
                        payload.from = senderPhone;
                        logger.info('✅ Bulk-send: FROM payload\'a eklendi (VIP veya Hamzah)', { phone, fromPhone: senderPhone });
                    } else {
                        logger.info('✅ Bulk-send: FROM payload\'a EKLENMEDI (SleekFlow default kullanılacak)', { phone });
                    }
                } else {
                    // Normal mesaj gönder
                    payload = {
                        channel: channel,
                        to: phone,
                        messageType: 'text',
                        messageContent: messageContent
                    };
                    
                    // ✅ HAMZAH DESTEĞİ: FROM null değilse payload'a ekle (VIP veya Hamzah için)
                    // ✅ Normal UI'daki gibi: fromPhone gönderilmişse kullan
                    if (senderPhone) {
                        payload.from = senderPhone;
                        logger.info('✅ Bulk-send: FROM payload\'a eklendi (VIP veya Hamzah)', { phone, fromPhone: senderPhone });
                    } else {
                        logger.info('✅ Bulk-send: FROM payload\'a EKLENMEDI (SleekFlow default kullanılacak)', { phone });
                    }
                }
                
                // ✅ KRITIK: conversationId varsa payload'a ekle (SleekFlow API FROM'u conversation'dan bulacak)
                // ✅ Normal UI'daki gibi conversation ID ile gönder
                if (convId) {
                    payload.conversationId = convId;
                    logger.info('✅ Bulk-send: conversationId payload\'a eklendi', { conversationId: convId, phone });
                } else {
                    logger.warn('⚠️ Bulk-send: conversationId yok, SleekFlow FROM bulamayabilir', { phone });
                }
                
                // ✅ Mesaj gönder
                const sendResult = await sleekflowService.call('post', '/api/message/send/json', {
                    data: payload
                });
                
                // ✅ KRITIK: SleekFlow API response'unu kontrol et (normal UI'daki gibi)
                let isActuallySuccess = true;
                let actualError = null;
                
                if (sendResult && typeof sendResult === 'object') {
                    // Array kontrolü
                    if (Array.isArray(sendResult) && sendResult.length > 0) {
                        const firstItem = sendResult[0];
                        if (firstItem.error || firstItem.success === false) {
                            isActuallySuccess = false;
                            actualError = firstItem.error || firstItem.message || 'Mesaj SleekFlow API tarafından reddedildi';
                        }
                    } else if (!Array.isArray(sendResult)) {
                        // Object kontrolü
                        if (sendResult.error || sendResult.success === false || (sendResult.message && sendResult.message.toLowerCase().includes('error'))) {
                            isActuallySuccess = false;
                            actualError = sendResult.error || sendResult.message || 'Mesaj SleekFlow API tarafından reddedildi';
                        }
                    }
                }
                
                if (isActuallySuccess) {
                    results.push({
                        phone,
                        conversationId: convId,
                        success: true,
                        messageType: needsTemplate || templateId || templateName ? 'template' : 'text',
                        result: sendResult
                    });
                    
                    logger.info('✅ Bulk-send: Mesaj başarıyla gönderildi', { phone, payload });
                } else {
                    // SleekFlow API hata döndü ama exception fırlatmadı
                    errors.push({
                        phone,
                        conversationId: convId,
                        error: actualError || 'Mesaj SleekFlow API tarafından reddedildi',
                        status: 400
                    });
                    
                    logger.error('❌ Bulk-send: SleekFlow API hata döndü (response içinde)', {
                        phone,
                        error: actualError,
                        result: sendResult,
                        payload: payload
                    });
                }
                
                // ✅ Rate limiting: Her mesaj arasında 100ms bekle (API rate limit'i aşmamak için)
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (sendError) {
                const errorMsg = sendError.response?.data?.message || sendError.response?.data?.error || sendError.message;
                errors.push({
                    phone,
                    conversationId: conversationMap[phone],
                    error: errorMsg,
                    status: sendError.response?.status
                });
                
                logger.error('❌ Toplu mesaj gönderme hatası (tek numara)', {
                    phone,
                    error: errorMsg
                });
            }
        }
        
        // ✅ Sonuçları döndür
        const successCount = results.length;
        const errorCount = errors.length;
        
        logger.info('✅ Toplu mesaj gönderme tamamlandı', {
            total: cleanedPhones.length,
            success: successCount,
            errors: errorCount
        });
        
        res.json({
            success: true,
            total: cleanedPhones.length,
            successCount,
            errorCount,
            results,
            errors: errors.length > 0 ? errors : undefined
        });
        
    } catch (error) {
        logger.error('❌ Toplu mesaj gönderme genel hatası', {
            error: error.message,
            status: error.response?.status,
            response: error.response?.data
        });
        
        return res.status(error.response?.status || 500).json({
            error: 'Toplu mesaj gönderme hatası: ' + (error.response?.data?.message || error.message),
            success: false
        });
    }
}));

module.exports = router;

