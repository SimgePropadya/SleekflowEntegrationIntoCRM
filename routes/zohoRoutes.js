// Zoho API route'ları

const express = require('express');
const router = express.Router();
const { zohoGet, zohoPost } = require('../zohoClient');
const { asyncHandler, createErrorResponse } = require('../utils/errorHandler');
const logger = require('../utils/logger');
const { isValidLeadId } = require('../utils/validation');

/**
 * GET /api/zoho/lead-info
 * Lead bilgilerini getir (Zoho CRM Get Records API v2: GET /crm/v2/Leads/{record_id})
 */
router.get('/lead-info', asyncHandler(async (req, res, next) => {
    const { id, widgetUrl, referrer: referrerQuery, parentUrl } = req.query;
    
    let leadId = id;
    
    // Eğer ID yoksa, referrer ve widgetUrl'den çıkar (AGRESİF PARSİNG)
    if (!leadId || !isValidLeadId(leadId)) {
        const headerReferer = req.get('referer') || req.get('referrer') || '';
        const referrer = referrerQuery || headerReferer || '';
        const allUrls = [
            referrer,
            widgetUrl || '',
            parentUrl || '',
            req.headers['x-forwarded-url'] || ''
        ].filter(Boolean).join(' ');
        
        logger.info('Lead ID aranıyor', { 
            hasId: !!id, 
            hasWidgetUrl: !!widgetUrl, 
            hasReferrer: !!referrer,
            hasParentUrl: !!parentUrl,
            allUrlsLength: allUrls.length 
        });
        
        // Pattern matching - TÜM PATTERN'LERİ DENE
        let leadIdMatch = null;
        
        // Pattern 1: /tab/Leads/3519633000086711022 (en yaygın)
        leadIdMatch = allUrls.match(/\/tab\/Leads\/(\d{10,})/);
        if (leadIdMatch && leadIdMatch[1]) {
            leadId = leadIdMatch[1];
            logger.info('Lead ID bulundu (pattern 1)', { leadId });
        } else {
            // Pattern 2: /crm/org675407911/tab/Leads/3519633000086711022
            leadIdMatch = allUrls.match(/\/crm\/[^\/]+\/tab\/Leads\/(\d{10,})/);
            if (leadIdMatch && leadIdMatch[1]) {
                leadId = leadIdMatch[1];
                logger.info('Lead ID bulundu (pattern 2)', { leadId });
            } else {
                // Pattern 3: /Leads/3519633000086711022
                leadIdMatch = allUrls.match(/\/Leads\/(\d{10,})/);
                if (leadIdMatch && leadIdMatch[1]) {
                    leadId = leadIdMatch[1];
                    logger.info('Lead ID bulundu (pattern 3)', { leadId });
                } else {
                    // Pattern 4: Herhangi bir yerde 15+ haneli sayı (Zoho lead ID formatı)
                    leadIdMatch = allUrls.match(/(\d{15,})/);
                    if (leadIdMatch && leadIdMatch[1]) {
                        leadId = leadIdMatch[1];
                        logger.info('Lead ID bulundu (pattern 4 - genel)', { leadId });
                    }
                }
            }
        }
    }
    
    // LeadId sadece rakam olsun (kesilme/encoding onleme)
    leadId = String(leadId || '').replace(/\D/g, '').trim();
    if (!leadId || leadId.length < 10) {
        logger.warn('Lead ID bulunamadı veya çok kısa', { id: req.query.id, leadIdLength: leadId.length });
        return res.json({ error: null, id: null, Full_Name: '', message: 'Lead ID bulunamadı' });
    }

    try {
        const lead = await zohoGet(`/crm/v2/Leads/${leadId}`);
        
        if (!lead || !lead.data || !Array.isArray(lead.data) || lead.data.length === 0) {
            logger.warn('Zoho lead kaydı boş', { leadId });
            return res.json({ id: leadId, Full_Name: '', First_Name: '', Last_Name: '', Phone: '', Email: '' });
        }

        const leadData = lead.data[0];
        const fullName = leadData.Full_Name != null ? String(leadData.Full_Name).trim() : '';
        const firstName = leadData.First_Name != null ? String(leadData.First_Name).trim() : '';
        const lastName = leadData.Last_Name != null ? String(leadData.Last_Name).trim() : '';
        const displayName = fullName || [firstName, lastName].filter(Boolean).join(' ').trim() || '';
        
        logger.info('Lead bilgisi alındı (Zoho v2)', { leadId, Full_Name: displayName || fullName });
        
        res.json({
            id: leadId,
            Full_Name: displayName || fullName,
            First_Name: leadData.First_Name || '',
            Last_Name: leadData.Last_Name || '',
            Phone: leadData.Phone || leadData.Mobile || '',
            Email: leadData.Email || '',
            ...leadData
        });
    } catch (error) {
        logger.error('Lead bilgisi Zoho hatası', { error: error.message, leadId, status: error.response?.status });
        // Zoho 400/404/500 dönse bile 200 + leadId dön ki widget kırılmasın ve conversations leadId ile filtrelensin
        res.status(200).json({
            id: leadId,
            Full_Name: '',
            First_Name: '',
            Last_Name: '',
            Phone: '',
            Email: '',
            message: 'Lead ismi Zoho\'dan alınamadı; filtreleme leadId ile yapılacak.'
        });
    }
}));

/**
 * GET /api/zoho/leads
 * Toplu lead bilgilerini getir (bulk message için)
 */
router.get('/leads', asyncHandler(async (req, res, next) => {
    const { leadIds } = req.query;
    
    if (!leadIds) {
        return res.status(400).json({
            error: 'leadIds parametresi gerekli (virgülle ayrılmış)',
            leads: []
        });
    }
    
    const leadIdArray = leadIds.split(',').map(id => id.trim()).filter(id => id && id.length >= 10);
    
    if (leadIdArray.length === 0) {
        return res.status(400).json({
            error: 'Geçerli lead ID bulunamadı',
            leads: []
        });
    }
    
    logger.info('Toplu lead bilgileri çekiliyor', { count: leadIdArray.length });
    
    try {
        // ✅ YÖNTEM 1: Query API (COQL) ile toplu çekme (TEK API ÇAĞRISI - DAHA HIZLI)
        try {
            // COQL sorgusu: Telefon numaraları dahil tüm önemli alanları çek
            // Not: Zoho CRM'de field isimleri büyük/küçük harf duyarlı olabilir
            const coqlQuery = `SELECT id, First_Name, Last_Name, Full_Name, Phone, Mobile, Secondary_Phone, Email FROM Leads WHERE id IN (${leadIdArray.map(id => `'${id}'`).join(',')})`;
            
            logger.info('COQL Query ile lead\'ler çekiliyor', { 
                query: coqlQuery,
                leadCount: leadIdArray.length 
            });
            
            const coqlResponse = await zohoPost('/crm/v2/coql', {
                select_query: coqlQuery
            });
            
            logger.info('COQL Response:', {
                hasData: !!coqlResponse?.data,
                dataLength: coqlResponse?.data?.length,
                firstRecord: coqlResponse?.data?.[0],
                fullResponse: coqlResponse
            });
            
            if (coqlResponse && coqlResponse.data && coqlResponse.data.length > 0) {
                // ✅ Telefon numaralarını kontrol et ve log'la
                const leadsWithPhones = coqlResponse.data.filter(lead => {
                    const hasPhone = lead.Phone || lead.Mobile || lead.Secondary_Phone || 
                                   lead.phone || lead.mobile || lead.secondary_phone;
                    if (!hasPhone) {
                        logger.warn('⚠️ Telefon numarası olmayan lead:', {
                            id: lead.id,
                            name: lead.Full_Name || lead.First_Name,
                            fields: Object.keys(lead)
                        });
                    }
                    return true; // Hepsini döndür, filtreleme yapma
                });
                
                logger.info('✅ COQL Query ile lead\'ler çekildi', { 
                    requested: leadIdArray.length,
                    found: coqlResponse.data.length,
                    withPhones: leadsWithPhones.length,
                    sampleLead: coqlResponse.data[0]
                });
                
                return res.json({
                    success: true,
                    leads: coqlResponse.data,
                    total: coqlResponse.data.length,
                    method: 'coql'
                });
            } else {
                logger.warn('⚠️ COQL Query sonuç döndürmedi, fallback yöntemine geçiliyor', {
                    response: coqlResponse
                });
            }
        } catch (coqlError) {
            logger.warn('⚠️ COQL Query hatası, fallback yöntemine geçiliyor', { 
                error: coqlError.message,
                response: coqlError.response?.data,
                status: coqlError.response?.status
            });
        }
        
        // ✅ YÖNTEM 2: Entity API ile tek tek çekme (FALLBACK - DAHA YAVAŞ AMA GÜVENİLİR)
        logger.info('Entity API ile lead\'ler çekiliyor (fallback)');
        const leadPromises = leadIdArray.map(async (leadId) => {
            try {
                const lead = await zohoGet(`/crm/v3/Leads/${leadId}`);
                if (lead && lead.data && lead.data.length > 0) {
                    return {
                        id: leadId,
                        ...lead.data[0]
                    };
                }
                return null;
            } catch (error) {
                logger.warn('Lead bilgisi çekilemedi', { leadId, error: error.message });
                return null;
            }
        });
        
        const leads = await Promise.all(leadPromises);
        const validLeads = leads.filter(lead => lead !== null);
        
        logger.info('Toplu lead bilgileri çekildi (Entity API)', { 
            requested: leadIdArray.length,
            found: validLeads.length 
        });
        
        res.json({
            success: true,
            leads: validLeads,
            total: validLeads.length,
            method: 'entity_api'
        });
    } catch (error) {
        logger.error('Toplu lead bilgisi çekme hatası', { error: error.message });
        
        const parsedError = require('../utils/errorHandler').parseApiError(error);
        return res.status(parsedError.status || 500).json({
            error: 'Toplu lead bilgileri çekilemedi: ' + (parsedError.message || error.message),
            leads: []
        });
    }
}));

/**
 * GET /api/zoho/selected-leads
 * Seçili lead'lerin telefon numaralarını getir (COQL Query ile - KESİN ÇÖZÜM)
 * URL parametresi: leadIds (virgülle ayrılmış lead ID'leri)
 */
router.get('/selected-leads', asyncHandler(async (req, res, next) => {
    const { leadIds } = req.query;
    
    if (!leadIds) {
        return res.status(400).json({
            error: 'leadIds parametresi gerekli (virgülle ayrılmış)',
            leads: []
        });
    }
    
    // ✅ $recordIds literal string kontrolü
    if (leadIds === '$recordIds' || leadIds.includes('$recordIds')) {
        logger.warn('⚠️ $recordIds literal string tespit edildi, boş döndürülüyor');
        return res.json({
            success: true,
            leads: [],
            total: 0,
            message: 'Zoho CRM\'den seçili lead ID\'leri alınamadı. Lütfen Zoho CRM\'de lead\'leri seçip tekrar deneyin.'
        });
    }
    
    const leadIdArray = leadIds.split(',').map(id => id.trim()).filter(id => id && id.length >= 10);
    
    if (leadIdArray.length === 0) {
        return res.status(400).json({
            error: 'Geçerli lead ID bulunamadı',
            leads: []
        });
    }
    
    logger.info('✅✅✅ Seçili lead\'ler COQL Query ile çekiliyor', { 
        count: leadIdArray.length,
        leadIds: leadIdArray.slice(0, 5) // İlk 5'ini logla
    });
    
    try {
        // ✅ YÖNTEM 1: Entity API ile ids parametresi kullanarak çek (KESİN ÇÖZÜM - TEK API ÇAĞRISI)
        // GET /crm/v3/Leads?ids=id1,id2,id3&fields=id,First_Name,Last_Name,Full_Name,Phone,Mobile,Secondary_Phone,Email
        const idsParam = leadIdArray.join(',');
        
        logger.info('✅✅✅ Entity API ile seçili lead\'ler çekiliyor (ids parametresi)', { 
            idsParam,
            count: leadIdArray.length
        });
        
        try {
            const entityResponse = await zohoGet('/crm/v3/Leads', {
                ids: idsParam,
                fields: 'id,First_Name,Last_Name,Full_Name,Phone,Mobile,Secondary_Phone,Email'
            });
            
            logger.info('✅✅✅ Entity API Response:', {
                hasData: !!entityResponse?.data,
                dataLength: entityResponse?.data?.length,
                firstRecord: entityResponse?.data?.[0]
            });
            
            if (entityResponse && entityResponse.data && entityResponse.data.length > 0) {
                // ✅ Telefon numaralarını kontrol et
                const leadsWithPhones = entityResponse.data.filter(lead => {
                    const hasPhone = lead.Phone || lead.Mobile || lead.Secondary_Phone || 
                                   lead.phone || lead.mobile || lead.secondary_phone;
                    return hasPhone;
                });
                
                logger.info('✅✅✅ Entity API ile seçili lead\'ler çekildi', { 
                    requested: leadIdArray.length,
                    found: entityResponse.data.length,
                    withPhones: leadsWithPhones.length
                });
                
                return res.json({
                    success: true,
                    leads: entityResponse.data,
                    total: entityResponse.data.length,
                    withPhones: leadsWithPhones.length,
                    method: 'entity_api_ids'
                });
            } else {
                logger.warn('⚠️ Entity API sonuç döndürmedi');
                // Fallback'e geç
            }
        } catch (entityError) {
            logger.error('❌ Entity API hatası (ids parametresi)', { 
                error: entityError.message,
                response: entityError.response?.data,
                status: entityError.response?.status
            });
            // Fallback'e geç
        }
        
        // ✅ YÖNTEM 2: COQL Query ile çek (FALLBACK)
        logger.info('⚠️ Entity API başarısız, COQL Query ile çekiliyor (fallback)');
        const idsString = leadIdArray.map(id => `'${id}'`).join(',');
        const coqlQuery = `SELECT id, First_Name, Last_Name, Full_Name, Phone, Mobile, Secondary_Phone, Email FROM Leads WHERE id IN (${idsString})`;
        
        try {
            const coqlResponse = await zohoPost('/crm/v2/coql', {
                select_query: coqlQuery
            });
            
            if (coqlResponse && coqlResponse.data && coqlResponse.data.length > 0) {
                const leadsWithPhones = coqlResponse.data.filter(lead => {
                    const hasPhone = lead.Phone || lead.Mobile || lead.Secondary_Phone || 
                                   lead.phone || lead.mobile || lead.secondary_phone;
                    return hasPhone;
                });
                
                logger.info('✅✅✅ COQL Query ile seçili lead\'ler çekildi (fallback)', { 
                    requested: leadIdArray.length,
                    found: coqlResponse.data.length,
                    withPhones: leadsWithPhones.length
                });
                
                return res.json({
                    success: true,
                    leads: coqlResponse.data,
                    total: coqlResponse.data.length,
                    withPhones: leadsWithPhones.length,
                    method: 'coql_fallback'
                });
            }
        } catch (coqlError) {
            logger.error('❌ COQL Query hatası (fallback)', { 
                error: coqlError.message
            });
        }
        
        // ✅ YÖNTEM 3: Entity API ile tek tek çek (SON ÇARE)
        logger.info('⚠️ COQL Query başarısız, Entity API ile tek tek çekiliyor (son çare)');
        const leadPromises = leadIdArray.map(async (leadId) => {
            try {
                const lead = await zohoGet(`/crm/v3/Leads/${leadId}`);
                if (lead && lead.data && lead.data.length > 0) {
                    return lead.data[0];
                }
                return null;
            } catch (error) {
                logger.warn('Lead bilgisi çekilemedi', { leadId, error: error.message });
                return null;
            }
        });
        
        const leads = await Promise.all(leadPromises);
        const validLeads = leads.filter(lead => lead !== null);
        
        return res.json({
            success: true,
            leads: validLeads,
            total: validLeads.length,
            method: 'entity_api_individual'
        });
    } catch (error) {
        logger.error('❌ Seçili lead\'ler çekme hatası', { error: error.message });
        const parsedError = require('../utils/errorHandler').parseApiError(error);
        return res.status(parsedError.status || 500).json({
            error: 'Seçili lead\'ler çekilemedi: ' + (parsedError.message || error.message),
            leads: []
        });
    }
}));

/**
 * GET /api/zoho/all-leads
 * Tüm lead'leri getir (checkbox seçimi için)
 */
router.get('/all-leads', asyncHandler(async (req, res, next) => {
    const { page = 1, perPage = 200, search } = req.query;
    const pageNum = parseInt(page) || 1;
    const perPageNum = parseInt(perPage) || 200;
    
    logger.info('Tüm lead\'ler çekiliyor', { page: pageNum, perPage: perPageNum, search });
    
    try {
        // ✅ COQL Query ile tüm lead'leri çek (telefon numaraları dahil)
        const coqlQuery = search && search.trim()
            ? `SELECT id, First_Name, Last_Name, Full_Name, Phone, Mobile, Secondary_Phone, Email FROM Leads WHERE (First_Name LIKE '%${search.trim()}%' OR Last_Name LIKE '%${search.trim()}%' OR Full_Name LIKE '%${search.trim()}%' OR Phone LIKE '%${search.trim()}%' OR Mobile LIKE '%${search.trim()}%') ORDER BY Created_Time DESC LIMIT ${perPageNum} OFFSET ${(pageNum - 1) * perPageNum}`
            : `SELECT id, First_Name, Last_Name, Full_Name, Phone, Mobile, Secondary_Phone, Email FROM Leads ORDER BY Created_Time DESC LIMIT ${perPageNum} OFFSET ${(pageNum - 1) * perPageNum}`;
        
        logger.info('COQL Query ile tüm lead\'ler çekiliyor', { 
            query: coqlQuery,
            page: pageNum,
            perPage: perPageNum
        });
        
        try {
            const coqlResponse = await zohoPost('/crm/v2/coql', {
                select_query: coqlQuery
            });
            
            if (coqlResponse && coqlResponse.data) {
                logger.info('✅ Tüm lead\'ler çekildi (COQL)', { 
                    count: coqlResponse.data.length,
                    page: pageNum
                });
                
                return res.json({
                    success: true,
                    leads: coqlResponse.data || [],
                    total: coqlResponse.data?.length || 0,
                    page: pageNum,
                    perPage: perPageNum,
                    method: 'coql'
                });
            }
        } catch (coqlError) {
            // ✅ COQL hatası varsa (scope mismatch gibi), Entity API'ye geç
            logger.warn('⚠️ COQL Query hatası, Entity API\'ye geçiliyor', {
                error: coqlError.message,
                code: coqlError.response?.data?.code,
                status: coqlError.response?.status
            });
        }
        
        // ✅ Fallback: Entity API ile çek (COQL scope hatası varsa)
        logger.info('Entity API ile tüm lead\'ler çekiliyor (fallback)');
        try {
            const entityResponse = await zohoGet('/crm/v3/Leads', {
                page: pageNum,
                per_page: perPageNum,
                fields: 'id,First_Name,Last_Name,Full_Name,Phone,Mobile,Secondary_Phone,Email'
            });
            
            if (entityResponse && entityResponse.data) {
                logger.info('✅ Tüm lead\'ler çekildi (Entity API)', { 
                    count: entityResponse.data.length,
                    page: pageNum
                });
                
                return res.json({
                    success: true,
                    leads: entityResponse.data || [],
                    total: entityResponse.data?.length || 0,
                    page: pageNum,
                    perPage: perPageNum,
                    method: 'entity_api'
                });
            }
        } catch (entityError) {
            logger.error('❌ Entity API de başarısız oldu', {
                error: entityError.message,
                status: entityError.response?.status
            });
            throw entityError;
        }
        
        return res.json({
            success: true,
            leads: [],
            total: 0,
            page: pageNum,
            perPage: perPageNum
        });
    } catch (error) {
        logger.error('Tüm lead\'ler çekme hatası', { error: error.message });
        
        const parsedError = require('../utils/errorHandler').parseApiError(error);
        return res.status(parsedError.status || 500).json({
            error: 'Lead\'ler çekilemedi: ' + (parsedError.message || error.message),
            leads: []
        });
    }
}));

/**
 * GET /api/zoho/user-permissions
 * Kullanıcının görebileceği sender numaralarını getir
 * Frontend'den kullanıcı email'i veya Zoho user ID'si gönderilir
 */
router.get('/user-permissions', asyncHandler(async (req, res, next) => {
    const { userEmail, userId } = req.query;
    
    // Kullanıcı bilgisi yoksa default (tüm sender'lar) döndür
    if (!userEmail && !userId) {
        const userSenderPermissions = require('../config/userSenderPermissions');
        const defaultPermissions = userSenderPermissions.default || ['*'];
        
        // ✅ ESKİ/YENİ FORMAT kontrolü
        let allowedSenders = ['*'];
        let allowedChannels = ['*'];
        if (Array.isArray(defaultPermissions)) {
            allowedSenders = defaultPermissions;
            allowedChannels = ['*'];
        } else if (defaultPermissions && typeof defaultPermissions === 'object') {
            allowedSenders = defaultPermissions.senders || ['*'];
            allowedChannels = defaultPermissions.channels || ['*'];
        }
        
        return res.json({
            success: true,
            allowedSenders,
            allowedChannels,
            userEmail: null,
            userId: null
        });
    }
    
    try {
        const userSenderPermissions = require('../config/userSenderPermissions');
        
        // Kullanıcı email'ine göre yetkileri bul
        const userKey = userEmail || userId;
        const userPermissions = userSenderPermissions[userKey] || userSenderPermissions.default || ['*'];
        
        // ✅ ESKİ FORMAT (Array): Sadece sender array'i
        let allowedSenders = ['*'];
        let allowedChannels = ['*'];
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
        
        logger.info('Kullanıcı yetkileri getirildi', { 
            userEmail, 
            userId, 
            allowedSenders,
            allowedChannels,
            format: Array.isArray(userPermissions) ? 'eski (array)' : 'yeni (object)'
        });
        
        res.json({
            success: true,
            allowedSenders,
            allowedChannels,
            userEmail: userEmail || null,
            userId: userId || null
        });
    } catch (error) {
        logger.error('Kullanıcı yetkileri getirme hatası', { error: error.message });
        
        // Hata durumunda default (tüm sender'lar ve kanallar) döndür
        res.json({
            success: true,
            allowedSenders: ['*'],
            allowedChannels: ['*'],
            userEmail: userEmail || null,
            userId: userId || null,
            error: 'Yetki bilgisi alınamadı, tüm sender\'lar ve kanallar gösteriliyor'
        });
    }
}));

module.exports = router;

