// API Base URL - Dinamik olarak belirlenir
const API_BASE_URL = (typeof window !== 'undefined' && window.location.origin) 
    ? `${window.location.origin}/api`
    : 'http://localhost:3000/api';

// State Management
const state = {
    sleekflow: {
        connected: false,
        apiKey: '',
        baseUrl: 'https://api.sleekflow.io'
    },
    zoho: {
        connected: false,
        clientId: '',
        clientSecret: '',
        redirectUri: 'http://localhost:3000/callback',
        region: 'com'
    },
    conversations: [],
    allConversations: [], // Tüm konuşmalar
    currentConversation: null,
    messages: {},
    selectedChannelFilter: '', // Kanal filtreleme için
    showAllConversations: false // Tüm konuşmaları göster
};

// DOM Elements
const elements = {
    // Sidebar
    sidebar: document.getElementById('sidebar'),
    toggleSidebar: document.getElementById('toggleSidebar'),
    openSidebar: document.getElementById('openSidebar'),
    sleekflowApiKey: document.getElementById('sleekflowApiKey'),
    sleekflowBaseUrl: document.getElementById('sleekflowBaseUrl'),
    connectSleekflow: document.getElementById('connectSleekflow'),
    zohoClientId: document.getElementById('zohoClientId'),
    zohoClientSecret: document.getElementById('zohoClientSecret'),
    zohoRedirectUri: document.getElementById('zohoRedirectUri'),
    zohoRegion: document.getElementById('zohoRegion'),
    connectZoho: document.getElementById('connectZoho'),
    
    // Chat
    conversationsList: document.getElementById('conversationsList'),
    searchConversations: document.getElementById('searchConversations'),
    refreshConversations: document.getElementById('refreshConversations'),
    chatView: document.getElementById('chatView'),
    chatEmpty: document.querySelector('.chat-empty'),
    chatActive: document.getElementById('chatActive'),
    messagesList: document.getElementById('messagesList'),
    messageInput: document.getElementById('messageInput'),
    sendMessage: document.getElementById('sendMessage'),
    fileInput: document.getElementById('fileInput'),
    attachFile: document.getElementById('attachFile'),
    selectedFilesContainer: document.getElementById('selectedFilesContainer'),
    chatContactName: document.getElementById('chatContactName'),
    chatMeta: document.getElementById('chatMeta'),
    chatAvatar: document.getElementById('chatAvatar'),
    channelFilter: document.getElementById('channelFilter'), // Kanal filtreleme dropdown'u
    
    // Loading
    loadingOverlay: document.getElementById('loadingOverlay')
};

// Utility Functions
function normalizeName(name) {
    if (!name) return '';
    return String(name)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // aksan vs sil
        .replace(/ı/g, 'i')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .replace(/\s+/g, ' ') // fazla boşlukları tekle
        .trim();
}

function showLoading() {
    elements.loadingOverlay.style.display = 'flex';
}

function hideLoading() {
    elements.loadingOverlay.style.display = 'none';
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    }[type] || 'ℹ️';
    
    toast.innerHTML = `<span>${icon} ${message}</span>`;
    
    const container = document.getElementById('toastContainer');
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// API Functions
async function apiRequest(endpoint, method = 'GET', data = null) {
    try {
        const fullUrl = `${API_BASE_URL}${endpoint}`;
        console.log(`🔍 API Request: ${method} ${fullUrl}`, data ? { body: data } : '');
        
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        if (data) {
            options.body = JSON.stringify(data);
        }
        
        const response = await fetch(fullUrl, options);
        console.log(`📡 Response Status: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Error Response:`, errorText);
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch (e) {
                errorData = { error: errorText || `HTTP ${response.status}` };
            }
            
            // If endpoint was found but auth failed, include that info
            if (errorData.endpointFound) {
                const error = new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
                error.endpointFound = true;
                error.details = errorData.details;
                throw error;
            }
            
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log(`✅ Success Response:`, result);
        return result;
    } catch (error) {
        console.error('❌ API Error:', error);
        throw error;
    }
}

// ✅ WINDOW ÜZERİNDEN ERİŞİLEBİLİR YAP - HEMEN TANIMLA (fonksiyon tanımlanmadan önce placeholder)
if (typeof window !== 'undefined') {
    // Placeholder - gerçek fonksiyon tanımlanınca değiştirilecek
    window.connectSleekflow = function() {
        console.error('❌ connectSleekflow henüz yüklenmedi! Lütfen bekleyin...');
        alert('Lütfen sayfanın tamamen yüklenmesini bekleyin ve tekrar deneyin.');
    };
}

// Sleekflow Functions
async function connectSleekflow() {
    // ✅ Eğer input boşsa, state'den veya localStorage'dan al
    let apiKey = elements.sleekflowApiKey ? elements.sleekflowApiKey.value.trim() : '';
    if (!apiKey || apiKey === '') {
        apiKey = state.sleekflow.apiKey || localStorage.getItem('sleekflowApiKey') || '';
    }
    
    let baseUrl = elements.sleekflowBaseUrl ? elements.sleekflowBaseUrl.value.trim() : '';
    if (!baseUrl || baseUrl === '') {
        baseUrl = state.sleekflow.baseUrl || localStorage.getItem('sleekflowBaseUrl') || 'https://api.sleekflow.io';
    }
    
    // Clean API key - only remove whitespace and non-printable characters
    const originalApiKey = apiKey;
    
    // Remove leading/trailing whitespace
    apiKey = apiKey.trim();
    
    // Remove any invisible characters (non-printable)
    apiKey = apiKey.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
    
    // Remove newlines and tabs but keep spaces if any (unlikely for API key)
    apiKey = apiKey.replace(/[\r\n\t]/g, '');
    
    // Basic validation - just check length
    if (!apiKey || apiKey.length < 10) {
        showToast('❌ API anahtarı çok kısa. En az 10 karakter olmalı.', 'error');
        return;
    }
    
    // Only check for obvious wrong content (HTML tags, URLs, etc)
    // Don't block valid API keys that might contain words like "http" in them
    const obviousWrongContent = ['<html', '<div', '<script', 'document.getElementById'];
    const hasObviousWrong = obviousWrongContent.some(pattern => 
        apiKey.toLowerCase().includes(pattern.toLowerCase())
    );
    
    if (hasObviousWrong) {
        showToast('❌ Yanlış içerik algılandı. Lütfen sadece API anahtarını girin.', 'error');
        elements.sleekflowApiKey.value = '';
        return;
    }
    
    // If cleaned version is different, update the field
    if (apiKey !== originalApiKey && apiKey.length > 0) {
        elements.sleekflowApiKey.value = apiKey;
    }
    
    // Debug: Log API key before sending
    console.log(`\n🔍 === Frontend: Sending API Key ===`);
    console.log(`   API Key type: ${typeof apiKey}`);
    console.log(`   API Key length: ${apiKey.length}`);
    console.log(`   API Key preview: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 5)}`);
    console.log(`   Base URL: ${baseUrl}`);
    
    showLoading();
    
    try {
        const requestData = {
            apiKey: apiKey,
            baseUrl: baseUrl
        };
        
        console.log(`   Request data keys:`, Object.keys(requestData));
        console.log(`   Request apiKey length: ${requestData.apiKey ? requestData.apiKey.length : 'NULL'}`);
        
        const result = await apiRequest('/sleekflow/connect', 'POST', requestData);
        
        // ✅ ÖNCE BAĞLANTIYI KONTROL ET - result.error varsa bağlantı başarısız
        // Check if there's an error response FIRST
        if (result.error) {
            let errorMsg = '';
            
            if (result.endpointFound === false) {
                // Endpoint bulunamadı
                errorMsg = `❌ Endpoint bulunamadı!\n\n` +
                          `URL: ${result.url || 'N/A'}\n` +
                          `Hata: ${result.details || result.error}\n\n` +
                          `💡 ${result.suggestion || 'Base URL\'i kontrol edin'}`;
            } else if (result.status === 401 || result.status === 403) {
                // API anahtarı geçersiz
                errorMsg = `✅ Endpoint bulundu! ❌ Ancak API anahtarı geçersiz.\n\n` +
                          `📋 YAPILMASI GEREKEN:\n` +
                          `1. Sleekflow hesabınıza giriş yapın\n` +
                          `2. Channels > Add integrations > API bölümüne gidin\n` +
                          `3. YENİ bir API key oluşturun\n` +
                          `4. Yeni key'i kopyalayıp buraya yapıştırın\n\n` +
                          `⚠️ Not: Eski key geçersiz görünüyor. Yeni key oluşturmanız gerekiyor.`;
            } else if (result.status === 500) {
                // Sunucu hatası
                errorMsg = `❌ Sleekflow sunucu hatası!\n\n` +
                          `Status: ${result.status}\n` +
                          `URL: ${result.url || 'N/A'}\n` +
                          `Hata: ${result.details?.message || result.details || result.error}\n\n` +
                          `💡 ${result.suggestion || 'Lütfen daha sonra tekrar deneyin'}`;
            } else {
                // Diğer hatalar
                errorMsg = `❌ Bağlantı hatası!\n\n` +
                          `Hata: ${result.error}\n` +
                          (result.details ? `Detay: ${JSON.stringify(result.details).substring(0, 200)}\n` : '') +
                          (result.suggestion ? `\n💡 ${result.suggestion}` : '');
            }
            
            showToast(errorMsg, 'error');
            console.error('❌ SLEEKFLOW BAĞLANTI HATASI!');
            console.error('   Status:', result.status || 'N/A');
            console.error('   Endpoint found:', result.endpointFound || false);
            console.error('   URL:', result.url || 'N/A');
            console.error('   Error:', result.error);
            console.error('   Details:', result.details);
            
            // Mark as not connected - don't try to load conversations
            state.sleekflow.connected = false;
            updateSleekflowStatus(false);
            
            // ✅ BAĞLANTI KOPTU - localStorage'dan sleekflowConnected'ı kaldır
            localStorage.removeItem('sleekflowConnected');
            
            // ✅ SIDEBAR'I AÇ - Bağlantı koptu, API key tekrar alınmalı
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.add('open');
                sidebar.style.setProperty('left', '0', 'important');
                sidebar.style.setProperty('opacity', '1', 'important');
                sidebar.style.setProperty('visibility', 'visible', 'important');
                sidebar.style.setProperty('pointer-events', 'auto', 'important');
                sidebar.style.setProperty('display', 'flex', 'important');
                sidebar.style.setProperty('z-index', '10000', 'important');
                console.log('✅ Sidebar açıldı (bağlantı koptu)');
            }
            
            // Don't try to load conversations with invalid key
            return;
        } else {
            // ✅ BAĞLANTI BAŞARILI - State ve localStorage'ı güncelle
            showToast('✅ Sleekflow bağlantısı başarılı!', 'success');
            state.sleekflow.connected = true;
            state.sleekflow.apiKey = apiKey;
            state.sleekflow.baseUrl = baseUrl;
            
            // ✅ KRİTİK: localStorage'a kaydet (otomatik bağlantı için)
            localStorage.setItem('sleekflowApiKey', apiKey);
            localStorage.setItem('sleekflowBaseUrl', baseUrl);
            localStorage.setItem('sleekflowConnected', 'true');
            
            updateSleekflowStatus(true);
            
            // ✅ SIDEBAR'I KAPAT - Bağlantı başarılı olduğunda kapat (ZORLA)
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                sidebar.classList.remove('open');
                sidebar.style.setProperty('left', '-320px', 'important');
                sidebar.style.setProperty('opacity', '0', 'important');
                sidebar.style.setProperty('visibility', 'hidden', 'important');
                sidebar.style.setProperty('pointer-events', 'none', 'important');
                sidebar.style.setProperty('display', 'none', 'important');
                sidebar.style.setProperty('z-index', '-1', 'important');
                document.body.style.overflow = '';
                console.log('✅ Sidebar kapatıldı (Sleekflow bağlantısı başarılı)');
            }
            
            // Start polling
            await apiRequest('/polling/start', 'POST');
            startMessagePolling();
            
            // Load conversations after connection
            await loadConversations();
            
            // ✅ Leads Follow-Up grubunu yükle
            loadLeadsFollowUpGroup();
            
            // ✅ Sender'ları yükle (bağlantı başarılı olduğunda) - BİRAZ GECİKME İLE
            setTimeout(() => {
                console.log('🔄 Sender\'lar yükleniyor (connectSleekflow sonrası)...');
            }, 1000); // 1 saniye bekle (API hazır olsun)
        }
    } catch (error) {
        // Check if endpoint was found but API key is invalid
        if (error.endpointFound) {
            showToast('✅ Endpoint bulundu! Ancak API anahtarı geçersiz. Lütfen Sleekflow hesabınızdan doğru API anahtarını alın.', 'warning');
            console.log('✅ Endpoint bulundu:', error.details?.triedUrl || 'https://api.sleekflow.io/api/contact');
            console.log('❌ API anahtarı geçersiz:', error.details);
        } else if (error.message.includes('endpointFound') || error.message.includes('Endpoint bulundu')) {
            showToast('✅ Endpoint bulundu! Ancak API anahtarı geçersiz. Lütfen doğru API anahtarını girin.', 'warning');
        } else {
            showToast(`Bağlantı hatası: ${error.message}`, 'error');
        }
        updateSleekflowStatus(false);
    } finally {
        hideLoading();
    }
}

function updateSleekflowStatus(connected) {
    // Status is now hidden, just update state
    state.sleekflow.connected = connected;
}

// ✅ WINDOW ÜZERİNDEN ERİŞİLEBİLİR YAP (fonksiyon tanımlandıktan sonra - GERÇEK FONKSİYON)
if (typeof window !== 'undefined') {
    window.connectSleekflow = connectSleekflow;
    console.log('✅✅✅ window.connectSleekflow GERÇEK FONKSİYON İLE TANIMLANDI!');
} else {
    console.error('❌❌❌ window TANIMLI DEĞİL!');
}

// Zoho Functions
async function connectZoho() {
    const clientId = elements.zohoClientId.value.trim();
    const clientSecret = elements.zohoClientSecret.value.trim();
    const redirectUri = elements.zohoRedirectUri.value.trim();
    const region = elements.zohoRegion.value;
    
    if (!clientId || !clientSecret) {
        showToast('❌ Lütfen Client ID ve Client Secret girin', 'error');
        return;
    }
    
    // Validate Client ID format (usually starts with 1000.)
    if (!clientId.startsWith('1000.')) {
        showToast('⚠️ Client ID formatı hatalı görünüyor. Zoho Client ID genellikle "1000." ile başlar.', 'warning');
    }
    
    showLoading();
    
    try {
        // Save credentials to localStorage
        localStorage.setItem('zohoClientId', clientId);
        localStorage.setItem('zohoClientSecret', clientSecret);
        localStorage.setItem('zohoRegion', region);
        
        const result = await apiRequest('/zoho/connect', 'POST', {
            clientId,
            clientSecret,
            redirectUri,
            region
        });
        
        if (result.authUrl) {
            // Store state
            state.zoho.clientId = clientId;
            state.zoho.clientSecret = clientSecret;
            state.zoho.region = region;
            
            showToast('✅ Zoho yetkilendirme penceresi açılıyor...', 'info');
            window.open(result.authUrl, '_blank', 'width=600,height=700');
            
            // OAuth callback is handled by existing message listener below
        }
    } catch (error) {
        showToast(`❌ Bağlantı hatası: ${error.message}`, 'error');
        console.error('Zoho connection error:', error);
    } finally {
        hideLoading();
    }
}

function updateZohoStatus(connected) {
    // Status is now hidden, just update state
    state.zoho.connected = connected;
}

async function testZoho() {
    showLoading();
    try {
        const result = await apiRequest('/zoho/test', 'GET');
        showToast('✅ Zoho bağlantısı başarılı!', 'success');
        updateZohoStatus(true);
        console.log('✅ Zoho test başarılı:', result);
    } catch (error) {
        const errorMsg = error.message || 'Bilinmeyen hata';
        
        // Check for specific error messages
        if (errorMsg.includes('OAuth bağlantısı yok') || errorMsg.includes('hasCredentials')) {
            showToast('ℹ️ Lütfen önce Zoho OAuth bağlantısı yapın (Bağlan butonuna tıklayın)', 'info');
        } else if (errorMsg.includes('Client ID')) {
            showToast('ℹ️ Lütfen Zoho Client ID ve Client Secret girin', 'info');
        } else {
            showToast(`❌ Zoho bağlantı hatası: ${errorMsg}`, 'error');
        }
        
        updateZohoStatus(false);
        console.error('❌ Zoho test hatası:', error);
    } finally {
        hideLoading();
    }
}

// Conversations Functions
async function loadConversations(silent = false) {
    console.log('🔍🔍🔍 loadConversations çağrıldı:', {
        connected: state.sleekflow.connected,
        hasApiKey: !!(state.sleekflow.apiKey || localStorage.getItem('sleekflowApiKey')),
        silent: silent,
        leadName: window.leadName || 'YOK',
        leadId: window.leadId || 'YOK'
    });

    // ✅ KRİTİK: Eğer connected false ama API key varsa, yine de dene!
    if (!state.sleekflow.connected) {
        const savedApiKey = localStorage.getItem('sleekflowApiKey');
        if (savedApiKey && savedApiKey.trim() !== '') {
            console.log('⚠️ State\'de connected=false ama API key var, yine de deniyoruz...');
            // API key varsa yine de dene
        } else {
            console.error('❌❌❌ SleekFlow bağlantısı YOK ve API key de YOK!');
            console.error('💡 Çözüm: Lütfen API anahtarınızı girin ve "SleekFlow\'a Bağlan" butonuna basın.');
            if (!silent) {
                showToast('⚠️ SleekFlow bağlantısı yok! Lütfen API anahtarınızı girin.', 'warning');
            }
            return;
        }
    }

    if (!silent) {
        console.log('📥 Konuşmalar yükleniyor...');
        showLoading();
    }

    try {
        // ✅ KRİTİK: showAllConversations false ise (butona basılmadıysa) her zaman filtrele
        // Sadece butona basıldığında true olur
        const shouldShowAll = state.showAllConversations;
        
        // ✅ FULL_NAME'E GÖRE FİLTRELEME - Backend'den gelen Full_Name kullanılacak
        const leadName = window.leadName || '';
        
        console.log('🔍 Filtreleme için kullanılacak bilgiler (FULL_NAME):', {
            leadName: leadName || 'YOK',
            leadId: window.leadId || 'YOK',
            showAll: shouldShowAll,
            source: 'Full_Name field from Zoho'
        });

        // ✅ KRİTİK: Lead filtreleme yapılırken TÜM kanalları çek (channel parametresi gönderme)
        // Sadece kullanıcı manuel olarak kanal seçtiyse ve "Tüm Konuşmaları Göster" butonuna basmadıysa kanal filtresi uygula
        let url;
        if (shouldShowAll && state.selectedChannelFilter && state.selectedChannelFilter !== 'all') {
            // Kullanıcı "Tüm Konuşmaları Göster" butonuna bastı VE bir kanal seçtiyse, o kanalı filtrele
            url = `/sleekflow/conversations?channel=${encodeURIComponent(state.selectedChannelFilter)}`;
        } else {
            // Lead filtreleme yapılırken veya "Tüm Kanallar" seçiliyse, TÜM kanalları çek
            url = '/sleekflow/conversations';
        }

        console.log('🌐🌐🌐 API çağrısı yapılıyor:', url);
        
        // Her zaman normal liste çek
        const result = await apiRequest(url, 'GET');
        console.log('✅✅✅ API yanıtı geldi:', {
            hasResult: !!result,
            hasConversations: !!(result && result.conversations),
            conversationsCount: (result && result.conversations) ? result.conversations.length : 0,
            resultKeys: result ? Object.keys(result) : []
        });
        
        const all = (result && result.conversations) ? result.conversations : [];
        console.log(`📊📊📊 Toplam ${all.length} konuşma çekildi`);
        
        if (all.length === 0) {
            console.warn('⚠️⚠️⚠️ API\'den 0 konuşma geldi! Bu normal olabilir (henüz konuşma yok) veya bir sorun olabilir.');
        }

        state.allConversations = all;

        // ✅ KANAL FİLTRELEME: Önce kanal filtresini uygula
        let filteredByChannel = all;
        if (state.selectedChannelFilter && state.selectedChannelFilter !== 'all') {
            filteredByChannel = all.filter(conv => {
                const convChannel = (conv.channel || conv.rawChannel || conv.lastMessageChannel || '').toLowerCase();
                const selectedChannel = state.selectedChannelFilter.toLowerCase();
                
                if (selectedChannel === 'whatsapp') {
                    return convChannel.includes('whatsapp');
                } else if (selectedChannel === 'instagram') {
                    return convChannel.includes('instagram') || convChannel.includes('facebook');
                } else if (selectedChannel === 'sms') {
                    return convChannel.includes('sms');
                } else if (selectedChannel === 'messenger') {
                    return convChannel.includes('messenger') || convChannel.includes('facebook');
                }
                return convChannel.includes(selectedChannel);
            });
            console.log(`📺 Kanal filtresi uygulandı: ${filteredByChannel.length}/${all.length} konuşma (Kanal: ${state.selectedChannelFilter})`);
        } else {
            console.log(`📺 Kanal filtresi yok, tüm kanallar gösteriliyor: ${all.length} konuşma`);
        }

        // ✅ ESKİ MANTIK: ÖNCE TÜM KONUŞMALARI GÖSTER, SONRA FİLTRELE
        // 1. Eğer "Tüm Konuşmaları Göster" butonuna basıldıysa, tümünü göster
        if (shouldShowAll) {
            if (!state.selectedChannelFilter || state.selectedChannelFilter === 'all') {
                state.conversations = all; // Tüm kanallar
                console.log(`📋 Tüm konuşmalar gösteriliyor (butona basıldı): ${all.length} konuşma`);
            } else {
                state.conversations = filteredByChannel; // Sadece seçili kanal
                console.log(`📋 Tüm konuşmalar gösteriliyor (kanal filtresi: ${state.selectedChannelFilter}): ${filteredByChannel.length}/${all.length} konuşma`);
            }
        } 
        // 2. Lead name varsa filtrele, YOKSA TÜMÜNÜ GÖSTER
        else if (leadName && leadName.trim() !== '') {
            // Hem tam isim hem de ön ekleri temizlenmiş versiyonu ile ara
            const originalLeadName = leadName.trim();
            const cleanLeadName = originalLeadName.replace(/^(mr\.?|mrs\.?|ms\.?|miss|dr\.?|prof\.?)\s+/i, '').trim();
            
            // Her iki versiyonu da normalize et (büyük küçük harf duyarsız - toLowerCase içerir)
            const normalizedOriginal = normalizeName(originalLeadName);
            const normalizedClean = normalizeName(cleanLeadName);
            
            console.log('🔍 Filtreleme detayları:', {
                originalLeadName: originalLeadName,
                cleanLeadName: cleanLeadName,
                normalizedOriginal: normalizedOriginal,
                normalizedClean: normalizedClean,
                filteredByChannelLength: filteredByChannel.length,
                allChannels: filteredByChannel.map(c => ({ name: c.contactName, channel: c.channel || c.rawChannel })).slice(0, 10)
            });
            
            const filtered = filteredByChannel.filter(conv => {
                // ✅ 1. İSİM KONTROLÜ - DAHA ESNEK
                let nameMatch = false;
                
                // Tüm olası isim alanlarını kontrol et
                const contactName = conv.contactName || conv.name || '';
                const userProfile = conv.userProfile || {};
                const firstName = userProfile.firstName || '';
                const lastName = userProfile.lastName || '';
                const fullNameFromProfile = `${firstName} ${lastName}`.trim();
                const convChannel = (conv.channel || conv.rawChannel || conv.lastMessageChannel || '').toLowerCase();
                
                // Tüm isim kombinasyonlarını dene
                const allNames = [
                    contactName,
                    fullNameFromProfile,
                    `${firstName} ${lastName}`.trim(),
                    firstName,
                    lastName
                ].filter(Boolean);
                
                // Her isim kombinasyonunu kontrol et - matchNames utility fonksiyonunu kullan
                for (const name of allNames) {
                    if (!name) continue;
                    
                    // ✅ matchNames utility fonksiyonunu kullan (daha güvenilir)
                    if (typeof window.matchNames === 'function') {
                        if (window.matchNames(originalLeadName, name) || window.matchNames(cleanLeadName, name)) {
                            nameMatch = true;
                            break;
                        }
                    } else {
                        // Fallback: Eski mantık
                        const normalizedConvName = normalizeName(name);
                        
                        // 1. Tam isim eşleşmesi
                        if (normalizedConvName === normalizedOriginal || normalizedConvName === normalizedClean) {
                            nameMatch = true;
                            break;
                        }
                        
                        // 2. Lead isminin tamamı conversation isminde geçiyorsa
                        if (normalizedConvName.includes(normalizedOriginal) && normalizedOriginal.length >= 3) {
                            nameMatch = true;
                            break;
                        }
                        if (normalizedConvName.includes(normalizedClean) && normalizedClean.length >= 3) {
                            nameMatch = true;
                            break;
                        }
                        
                        // 3. Kelime bazlı eşleşme - TÜM KELİMELER EŞLEŞMELİ
                        const leadWords = normalizedOriginal.split(' ').filter(w => w.length >= 2);
                        const convWords = normalizedConvName.split(' ').filter(w => w.length >= 2);
                        
                        if (leadWords.length > 0 && convWords.length > 0) {
                            const matchingWords = leadWords.filter(leadWord => 
                                convWords.some(convWord => convWord === leadWord)
                            );
                            
                            // TÜM kelimeler eşleşmeli
                            if (matchingWords.length === leadWords.length) {
                                if (leadWords.length >= 2 || (leadWords.length === 1 && leadWords[0].length >= 3)) {
                                    nameMatch = true;
                                    break;
                                }
                            }
                        }
                    }
                }
                
                // ✅ 2. SONUÇ: SADECE İSİM EŞLEŞMESİ (telefon kontrolü yok)
                const result = nameMatch;
                
                if (result) {
                    console.log('✅ Eşleşme bulundu:', {
                        contactName: contactName || fullNameFromProfile,
                        channel: convChannel,
                        nameMatch: nameMatch
                    });
                } else {
                    // Debug: WhatsApp konuşmaları neden filtreleniyor?
                    if (convChannel.includes('whatsapp')) {
                        console.log('❌ WhatsApp konuşması filtrelendi:', {
                            contactName: contactName || fullNameFromProfile,
                            channel: convChannel,
                            nameMatch: nameMatch,
                            leadName: leadName,
                            normalizedLeadName: normalizedOriginal,
                            normalizedConvName: normalizeName(contactName || fullNameFromProfile)
                        });
                    }
                }
                
                return result;
            });
            
            // ✅ KRİTİK: Eğer filtreleme sonucu boşsa, TÜM konuşmaları göster (eski mantık)
            if (filtered.length === 0) {
                console.log(`⚠️ Filtreleme sonucu boş, TÜM konuşmalar gösteriliyor (${filteredByChannel.length} konuşma)`);
                state.conversations = filteredByChannel; // Tüm konuşmaları göster
            } else {
                state.conversations = filtered; // Filtrelenmiş konuşmaları göster
                console.log(`👤 İsim filtreleme: ${filtered.length}/${filteredByChannel.length} konuşma bulundu (Lead: ${leadName})`);
            }
            
            console.log(`📊 Toplam konuşma: ${all.length}, Gösterilen: ${state.conversations.length}, Tüm konuşmalar: ${state.allConversations.length}`);
            
            // Debug: İlk 5 conversation'ın detaylarını göster ve neden eşleşmediğini analiz et
            if (filtered.length === 0 && filteredByChannel.length > 0) {
                console.group('⚠️ Eşleşme bulunamadı - Detaylı Analiz');
                console.log('🔍 Lead Bilgileri:', {
                    leadName: leadName,
                    normalizedLeadName: normalizedOriginal
                });
                console.log('📋 İlk 5 Conversation Detayları:');
                filteredByChannel.slice(0, 5).forEach((c, index) => {
                    const contactName = c.contactName || 'YOK';
                    const userProfile = c.userProfile || {};
                    const firstName = userProfile.firstName || '';
                    const lastName = userProfile.lastName || '';
                    const fullNameFromProfile = `${firstName} ${lastName}`.trim() || 'YOK';
                    const normalizedConvName = normalizeName(contactName || fullNameFromProfile);
                    
                    // İsim eşleşmesi detaylı kontrolü
                    const exactMatch = normalizedConvName === normalizedOriginal || normalizedConvName === normalizedClean;
                    const leadWords = normalizedOriginal.split(' ').filter(w => w.length >= 2);
                    const convWords = normalizedConvName.split(' ').filter(w => w.length >= 2);
                    const matchingWords = leadWords.filter(leadWord => 
                        convWords.some(convWord => convWord === leadWord)
                    );
                    // ✅ KRİTİK: En az 2 kelime eşleşmeli (soyisim de eşleşmeli)
                    const nameMatch = exactMatch || matchingWords.length >= 2 || 
                                     (leadWords.length === 1 && convWords.length === 1 && leadWords[0] === convWords[0] && leadWords[0].length >= 4);
                    
                    console.log(`\n📌 Conversation ${index + 1}:`, {
                        contactName: contactName,
                        firstName: firstName,
                        lastName: lastName,
                        fullNameFromProfile: fullNameFromProfile,
                        normalizedConvName: normalizedConvName,
                        leadWords: leadWords,
                        convWords: convWords,
                        matchingWords: matchingWords,
                        nameMatch: nameMatch,
                        nameMatchReason: exactMatch ? 'Tam isim eşleşmesi' : 
                                       matchingWords.length >= 1 ? `${matchingWords.length} kelime eşleşti: ${matchingWords.join(', ')}` : 
                                       'Eşleşme yok',
                        finalMatch: nameMatch
                    });
                });
                console.groupEnd();
            }
        } 
        // ✅ Lead name yoksa TÜM konuşmaları göster (filtreleme yok) - ESKİ MANTIK
        else {
            state.conversations = filteredByChannel; // Tüm konuşmaları göster (kanal filtresi varsa uygula)
            console.log(`📋 Lead isim bilgisi yok, TÜM konuşmalar gösteriliyor: ${filteredByChannel.length} konuşma`);
        }

        console.log('🎨🎨🎨 Render ediliyor...', {
            total: state.allConversations.length,
            toDisplay: state.conversations.length
        });
        
        renderConversations();
        updateChatEmptyView();
        
        console.log('✅✅✅ Konuşmalar başarıyla yüklendi ve render edildi:', {
            total: state.allConversations.length,
            displayed: state.conversations.length,
            filtered: state.allConversations.length !== state.conversations.length,
            conversationsListElement: !!elements.conversationsList,
            conversationsListChildren: elements.conversationsList ? elements.conversationsList.children.length : 0
        });
        
    } catch (error) {
        const errorMsg = error.message || 'Bilinmeyen hata';
        console.error('❌❌❌ KONUŞMALAR YÜKLENEMEDİ:', {
            error: errorMsg,
            stack: error.stack,
            endpointFound: error.endpointFound,
            details: error.details
        });

        if (!silent) {
            // ✅ HATA MESAJINI GÖSTER
            if (error.endpointFound === false) {
                showToast('❌ API endpoint bulunamadı! Lütfen API anahtarınızı kontrol edin.', 'error');
            } else if (error.message && error.message.includes('401') || error.message.includes('403')) {
                showToast('❌ API anahtarı geçersiz! Lütfen doğru API anahtarını girin.', 'error');
            } else {
                showToast(`❌ Konuşmalar yüklenemedi: ${errorMsg}`, 'error');
            }
        }
        
        // Hata durumunda boş liste göster
        state.conversations = [];
        state.allConversations = [];
        renderConversations();
        updateChatEmptyView();
    } finally {
        if (!silent) {
            hideLoading();
        }
    }
}

// Zoho lead telefon numarasına göre SleekFlow'da contact ara
async function findContactByPhone(phoneNumber) {
    if (!phoneNumber || !phoneNumber.trim()) {
        return null;
    }
    
    try {
        const cleanPhone = phoneNumber.replace(/^\+/, '').trim();
        const result = await apiRequest(`/sleekflow/contact?phoneNumber=${encodeURIComponent(cleanPhone)}`, 'GET');
        return result.contact || null;
    } catch (error) {
        console.error('❌ Contact arama hatası:', error);
        return null;
    }
}

// Chat view'ı güncelle
function updateChatEmptyView() {
    if (state.currentConversation) {
        return;
    }

    elements.chatEmpty.style.display = 'flex';
    elements.chatActive.style.display = 'none';
    
    if (!state.showAllConversations && state.conversations.length === 0 && state.allConversations.length > 0) {
        // Filtrelenmiş modda konuşma yok - ama tüm konuşmalar var
        const leadName = window.leadName || '';
        elements.chatEmpty.innerHTML = `
            <div class="empty-icon">💬</div>
            <h2>${leadName ? `"${leadName}" ile konuşma bulunamadı` : 'Konuşma bulunamadı'}</h2>
            <p>${leadName ? `Bu lead ile henüz bir konuşma yapılmamış. Tüm konuşmaları görmek için butona tıklayın.` : 'Henüz konuşma yok.'}</p>
            <button class="btn btn-primary" id="showAllConversationsFromChat" style="margin-top: 20px; padding: 12px 24px; font-weight: 600;">
                📋 Tüm Konuşmaları Göster (${state.allConversations.length} konuşma)
            </button>
        `;
        
        setTimeout(() => {
            const btn = document.getElementById('showAllConversationsFromChat');
            if (btn) {
                btn.onclick = async () => {
                    state.showAllConversations = true;
                    // Tüm konuşmaları yeniden yükle (filtreleme olmadan)
                    await loadConversations();
                };
            }
        }, 50);
    } else {
        elements.chatEmpty.innerHTML = `
            <div class="empty-icon">💬</div>
            <h2>Bir konuşma seçin</h2>
            <p>Sol taraftan bir konuşma seçerek mesajları görüntüleyin</p>
        `;
    }
}

function renderConversations() {
    const list = elements.conversationsList;
    if (!list) {
        console.error('❌ conversationsList elementi bulunamadı!');
        return;
    }
    
    const convs = state.conversations || [];

    // ✅ ESKİ HALİNE GERİ GETİR: Basit ve çalışan versiyon
    list.innerHTML = '';

    // ✅ ÖNCE: Conversation-item'ları ekle
    if (convs.length > 0) {
        console.log(`📋 ${convs.length} konuşma render ediliyor...`);
        convs.forEach(conv => {
            const item = document.createElement('div');
            item.className = 'conversation-item';
            if (state.currentConversation && state.currentConversation.id === conv.id) {
                item.classList.add('active');
            }

            const channel = conv.channel || conv.rawChannel || '';
            const channelIcon = getChannelIcon(channel);

            item.innerHTML = `
                <div class="conversation-avatar">
                    ${getInitials(conv.contactName || 'U')}
                    ${channelIcon ? `<span class="channel-icon">${channelIcon}</span>` : ''}
                </div>
                <div class="conversation-info">
                    <div class="conversation-name">${conv.contactName || 'Bilinmeyen'}</div>
                    <div class="conversation-preview">${conv.lastMessage || ''}</div>
                </div>
                <div class="conversation-time">${formatTime(conv.lastMessageTime)}</div>
            `;

            item.onclick = () => selectConversation(conv);
            list.appendChild(item);
        });
        console.log(`✅ ${convs.length} konuşma başarıyla render edildi!`);
    } else {
        // Eğer conversation yoksa empty-state göster
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        if (state.allConversations.length > 0) {
            emptyState.innerHTML = '<p>📭 Bu lead ile konuşma yok.</p>';
        } else {
            emptyState.innerHTML = '<p>📭 Henüz konuşma yok</p><p class="empty-hint">Sleekflow\'a bağlanın ve konuşmaları görüntüleyin</p>';
        }
        list.appendChild(emptyState);
    }

    // ✅ Tüm konuşmaları göster butonu - HER ZAMAN GÖSTER (filtrelenmiş modda)
    // Lead name'e göre filtrelenmiş konuşmalar varsa, altında bu buton görünür
    if (!state.showAllConversations && state.allConversations.length > 0 && state.conversations.length < state.allConversations.length) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-primary';
        btn.style.cssText = 'width: 100%; margin-top: 15px; padding: 12px; cursor: pointer; font-weight: 600;';
        btn.textContent = `📋 Tüm Konuşmaları Göster (${state.allConversations.length} konuşma)`;
        btn.onclick = async () => {
            state.showAllConversations = true;
            // Tüm konuşmaları yeniden yükle (filtreleme olmadan)
            await loadConversations();
        };
        list.appendChild(btn);
    }

    updateChatEmptyView();
}


function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function getChannelIcon(channel) {
    if (!channel) return '';
    
    const channelLower = channel.toLowerCase();
    
    if (channelLower.includes('whatsapp') || channelLower === 'whatsapp') {
        // WhatsApp SVG ikonu - Renkli ve opak
        return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="5" fill="#25D366"/>
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" fill="white"/>
        </svg>`;
    } else if (channelLower.includes('instagram') || channelLower === 'instagram') {
        // Instagram SVG ikonu - Renkli gradient
        return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="5" fill="url(#instagram-gradient)"/>
            <defs>
                <linearGradient id="instagram-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#833AB4;stop-opacity:1" />
                    <stop offset="50%" style="stop-color:#E1306C;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#FCAF45;stop-opacity:1" />
                </linearGradient>
            </defs>
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" fill="white"/>
        </svg>`;
    } else if (channelLower.includes('facebook') || channelLower === 'facebook') {
        return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="5" fill="#1877F2"/>
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="white"/>
        </svg>`;
    } else if (channelLower.includes('sms') || channelLower === 'sms') {
        return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="5" fill="#4CAF50"/>
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="white"/>
        </svg>`;
    } else if (channelLower.includes('line') || channelLower === 'line') {
        return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="5" fill="#00C300"/>
            <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.27l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.058.9l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" fill="white"/>
        </svg>`;
    } else if (channelLower.includes('wechat') || channelLower === 'wechat') {
        return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="5" fill="#09BB07"/>
            <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.597-6.348zM6.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 5.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.766 2.118c1.62 0 2.943 1.34 2.943 2.982 0 1.642-1.323 2.983-2.943 2.983a.59.59 0 0 1-.59-.59c0-.326.264-.59.59-.59 1.004 0 1.822-.83 1.822-1.803 0-.973-.818-1.802-1.822-1.802-.98 0-1.78.774-1.818 1.735a.59.59 0 0 1-1.177-.122c.064-1.52 1.328-2.733 2.995-2.733zm-1.71 2.733c.325 0 .59.264.59.59a.59.59 0 0 1-.59.59.59.59 0 0 1-.59-.59c0-.326.265-.59.59-.59zm-4.096.59c0 .326-.264.59-.59.59a.59.59 0 0 1-.59-.59.59.59 0 0 1 .59-.59c.326 0 .59.264.59.59zm8.637-2.733c1.62 0 2.943 1.34 2.943 2.982 0 1.642-1.323 2.983-2.943 2.983a.59.59 0 0 1-.59-.59c0-.326.264-.59.59-.59 1.004 0 1.822-.83 1.822-1.803 0-.973-.818-1.802-1.822-1.802-.98 0-1.78.774-1.818 1.735a.59.59 0 0 1-1.177-.122c.064-1.52 1.328-2.733 2.995-2.733zm-1.71 2.733c.325 0 .59.264.59.59a.59.59 0 0 1-.59.59.59.59 0 0 1-.59-.59c0-.326.265-.59.59-.59z" fill="white"/>
        </svg>`;
    } else if (channelLower.includes('web') || channelLower === 'web') {
        return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="5" fill="#2196F3"/>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="white"/>
        </svg>`;
    }
    
    return '';
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return 'Şimdi';
    if (minutes < 60) return `${minutes}dk`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}s`;
    return date.toLocaleDateString('tr-TR');
}

// Messages Functions
async function selectConversation(conversation) {
    console.log('📌 Konuşma seçildi:', {
        id: conversation.id,
        conversationId: conversation.conversationId,
        contactName: conversation.contactName,
        fullConversation: conversation
    });
    
    state.currentConversation = conversation;
    renderConversations();
    
    elements.chatEmpty.style.display = 'none';
    elements.chatActive.style.display = 'flex';
    
    // Display conversation name (no Zoho name matching - phone filtering only)
    const displayName = conversation.contactName || 'Bilinmeyen';
    elements.chatContactName.textContent = displayName;
    elements.chatMeta.textContent = conversation.channel || 'Sleekflow';
    elements.chatAvatar.textContent = getInitials(displayName || 'U');
    
    elements.messageInput.disabled = false;
    elements.sendMessage.disabled = false;
    
    // ✅ Sender seçimini göster ve yükle (top bar'da)
    
    // ✅ Yönlendirme butonunu göster (her zaman görünür)
    const forwardBtn = document.getElementById('forwardToLeadsFollowUp');
    if (forwardBtn) {
        forwardBtn.style.display = 'inline-block';
        forwardBtn.disabled = false;
    }
    
    // ✅ KRİTİK: conversationId veya id kullan (SleekFlow API formatına göre)
    const conversationId = conversation.conversationId || conversation.id;
    if (!conversationId) {
        console.error('❌ Conversation ID bulunamadı!', conversation);
        showToast('Konuşma ID bulunamadı', 'error');
        return;
    }
    
    console.log('📥 Mesajlar yükleniyor, conversation ID:', conversationId);
    await loadMessages(conversationId);
}

async function loadMessages(conversationId, silent = false) {
    // Bağlantı yoksa mesajları yükleme
    if (!state.sleekflow.connected) {
        if (!silent) {
            console.log('⚠️ SleekFlow bağlantısı yok, mesajlar yüklenmiyor');
        }
        return;
    }
    
    if (!conversationId) {
        console.error('❌ Conversation ID yok, mesajlar yüklenemiyor');
        if (!silent) {
            showToast('Conversation ID bulunamadı', 'error');
        }
        return;
    }
    
    if (!silent) {
        showLoading();
    }
    
    try {
        console.log(`📥 Mesajlar yükleniyor: /sleekflow/conversations/${conversationId}/messages`);
        const result = await apiRequest(`/sleekflow/conversations/${conversationId}/messages`, 'GET');
        
        console.log('📥 Mesaj response:', {
            hasMessages: !!(result && result.messages),
            isArray: Array.isArray(result),
            messageCount: result?.messages?.length || (Array.isArray(result) ? result.length : 0),
            result: result
        });
        
        if (result && result.messages && Array.isArray(result.messages)) {
            state.messages[conversationId] = result.messages;
            console.log(`✅ ${result.messages.length} mesaj yüklendi ve render ediliyor`);
            renderMessages(result.messages);
        } else if (result && Array.isArray(result)) {
            // Eğer direkt array döndüyse
            state.messages[conversationId] = result;
            console.log(`✅ ${result.length} mesaj yüklendi (array format) ve render ediliyor`);
            renderMessages(result);
        } else {
            console.warn('⚠️ Mesajlar boş veya beklenmeyen format:', result);
            renderMessages([]);
        }
    } catch (error) {
        console.error('❌ Mesaj yükleme hatası:', error);
        console.error('   Conversation ID:', conversationId);
        console.error('   Error details:', error.response || error.message);
        if (!silent) {
            showToast(`Mesajlar yüklenemedi: ${error.message}`, 'error');
        }
        renderMessages([]);
    } finally {
        if (!silent) {
            hideLoading();
        }
    }
}

function renderMessages(messages) {
    const list = elements.messagesList;
    if (!list) {
        console.error('❌ messagesList elementi bulunamadı');
        return;
    }

    console.log('📝 renderMessages çağrıldı, mesaj sayısı:', messages?.length || 0);

    list.innerHTML = '';

    if (!messages || messages.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>Henüz mesaj yok</p></div>';
        return;
    }

    messages.forEach((msg, index) => {
        try {
            const messageEl = document.createElement('div');
            messageEl.className = `message ${msg.direction || 'received'}`;
            messageEl.dataset.messageId = msg.id || `msg_${index}`;

            const messageTime = formatTime(
                msg.timestamp || msg.createdAt || msg.created_at || new Date()
            );

            const fileUrl = msg.fileUrl || null;
            const fileName = msg.fileName || '';
            const isStory = !!msg.isStory;
            const messageText = (msg.text || '').trim();
            
            // DEBUG: Backend'den gelen veriyi logla
            if (index < 5) { // İlk 5 mesajı logla
                console.log(`🔍 FRONTEND MSG[${index}]:`, {
                    id: msg.id,
                    text: msg.text?.substring(0, 100),
                    content: msg.content?.substring(0, 100),
                    fileUrl: msg.fileUrl?.substring(0, 100),
                    fileName: msg.fileName,
                    hasText: !!messageText,
                    hasFile: !!fileUrl
                });
            }

            // Hem text hem file tamamen boşsa hiç gösterme
            if (!fileUrl && !messageText) {
                console.warn(`⚠️ Boş mesaj (index ${index}) atlanıyor`);
                return;
            }

            let contentHtml = '';

            if (fileUrl) {
                const isVideo =
                    msg.type === 'video' ||
                    /\.(mp4|avi|mov|wmv|webm)$/i.test(fileUrl);
                const isImage =
                    msg.type === 'image' ||
                    /\.(jpg|jpeg|png|gif|webp|jfif)$/i.test(fileUrl);
                const isAudio = /\.(mp3|wav|ogg|m4a)$/i.test(fileUrl);
                
                // Conversation/... gibi path'leri kullanıcıya göstermeyelim
                const safeFileLabel =
                    fileName && !fileName.includes('Conversation/')
                        ? fileName
                        : (isVideo ? 'Video' : 'Dosya İndir');

                if (isStory) {
                    // Instagram story kartı
                    contentHtml += `
                        <div style="border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden; margin-bottom: 8px; background: #fff;">
                            <div style="padding: 12px; background: #f8f9fa; border-bottom: 1px solid #e0e0e0;">
                                <div style="font-weight: 600; color: #333; margin-bottom: 4px;">Replied to your story</div>
                            </div>
                    `;

                    if (isVideo) {
                        contentHtml += `
                            <video controls style="width: 100%; max-height: 500px; display: block;">
                                <source src="${escapeHtml(fileUrl)}" type="video/mp4">
                                Tarayıcınız video oynatmayı desteklemiyor.
                            </video>
                        `;
                    } else if (isImage) {
                        contentHtml += `
                            <img src="${escapeHtml(fileUrl)}" alt="Instagram Story" style="width: 100%; max-height: 500px; display: block; object-fit: contain;">
                        `;
                    }

                    contentHtml += `
                            <div style="padding: 8px 12px;">
                                <a href="${escapeHtml(fileUrl)}" target="_blank" style="color: #0066cc; text-decoration: none; font-size: 0.9em;">View story</a>
                            </div>
                        </div>
                    `;
                } else if (isVideo) {
                    contentHtml += `
                        <video controls style="max-width: 100%; max-height: 400px; border-radius: 8px; margin-bottom: 8px; background: #000;">
                            <source src="${escapeHtml(fileUrl)}" type="video/mp4">
                            Tarayıcınız video oynatmayı desteklemiyor.
                        </video>
                    `;
                } else if (isImage) {
                    contentHtml += `
                        <img src="${escapeHtml(fileUrl)}" alt="${escapeHtml(fileName || 'Resim')}" style="max-width: 100%; max-height: 400px; border-radius: 8px; margin-bottom: 8px; cursor: pointer; object-fit: contain;" onclick="window.open('${escapeHtml(fileUrl)}', '_blank')">
                    `;
                } else if (isAudio) {
                    contentHtml += `
                        <audio controls style="width: 100%; margin-bottom: 8px;">
                            <source src="${escapeHtml(fileUrl)}" type="audio/mpeg">
                            Tarayıcınız ses oynatmayı desteklemiyor.
                        </audio>
                    `;
                } else {
                    // DİĞER DOSYALAR İÇİN İNDİRME LİNKİ
                    // Conversation/... gibi path'leri kullanıcıya göstermeyelim
                    contentHtml += `
                        <a href="${escapeHtml(fileUrl)}" target="_blank" download="${escapeHtml(fileName || 'dosya')}" style="display: inline-block; padding: 10px 16px; background: #f0f0f0; border-radius: 8px; text-decoration: none; color: #333; margin-bottom: 8px; font-weight: 500;">
                            📎 ${escapeHtml(safeFileLabel)}
                        </a>
                    `;
                }
            }

            if (messageText) {
                // Eğer dosya da varsa altına küçük caption gibi koy
                const style = fileUrl
                    ? 'margin-top: 8px; font-size: 0.9em; color: #666;'
                    : 'white-space: pre-wrap; word-wrap: break-word;';
                contentHtml += `<div style="${style}">${escapeHtml(messageText)}</div>`;
            }

            // ✅ YÖNLENDİRME BUTONU: Sadece gelen mesajlar için (received)
            const forwardButton = msg.direction === 'received' ? `
                <button class="forward-message-btn" onclick="forwardMessageToLeadsFollowUp('${escapeHtml(msg.id || `msg_${index}`)}', ${JSON.stringify(messageText).replace(/"/g, '&quot;')}, ${JSON.stringify(fileUrl || '').replace(/"/g, '&quot;')}, ${JSON.stringify(fileName || '').replace(/"/g, '&quot;')})" 
                        title="Bu mesajı Leads Follow-Up grubuna yönlendir"
                        style="background: #3b82f6; color: white; border: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; margin-top: 6px; font-weight: 600; transition: all 0.2s; box-shadow: 0 2px 4px rgba(59,130,246,0.3);"
                        onmouseover="this.style.background='#2563eb'; this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 8px rgba(59,130,246,0.4)';" 
                        onmouseout="this.style.background='#3b82f6'; this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(59,130,246,0.3)';">
                    📤 Leads Follow-Up'a Yönlendir
                </button>
            ` : '';

            messageEl.innerHTML = `
                <div class="message-bubble">${contentHtml}${forwardButton}</div>
                <div class="message-time">${messageTime}</div>
            `;

            list.appendChild(messageEl);
        } catch (err) {
            console.error(`❌ Mesaj render hatası (index ${index}):`, err);
        }
    });
    
    console.log(`✅ ${list.children.length} mesaj render edildi`);
    
    // Scroll to bottom (en yeni mesajlar altta olduğu için)
    setTimeout(() => {
        const messagesArea = document.getElementById('messagesArea');
        if (messagesArea) {
            messagesArea.scrollTop = messagesArea.scrollHeight;
        } else {
            list.scrollTop = list.scrollHeight;
        }
    }, 100);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// File handling functions
let selectedFiles = [];

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    selectedFiles = [...selectedFiles, ...files];
    updateSelectedFiles();
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    updateSelectedFiles();
    // File input'u sıfırla
    if (elements.fileInput) {
        elements.fileInput.value = '';
    }
}

function updateSelectedFiles() {
    const container = elements.selectedFilesContainer;
    if (!container) return;
    
    if (selectedFiles.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    
    container.style.display = 'block';
    container.innerHTML = selectedFiles.map((file, index) => `
        <div class="selected-file-item" style="display: flex; align-items: center; gap: 8px; padding: 8px; background: #f3f4f6; border-radius: 6px; margin-top: 8px;">
            <span style="font-size: 0.875rem;">📎 ${file.name}</span>
            <button onclick="removeFile(${index})" style="background: #ef4444; color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 0.75rem;">✕</button>
        </div>
    `).join('');
}

// Make removeFile globally accessible
window.removeFile = removeFile;

// ✅ Sender yükleme fonksiyonu - API'den çek (TÜM SENDER'LARI GÖSTER)

async function sendMessage() {
    if (!state.currentConversation) {
        showToast('Lütfen bir konuşma seçin', 'warning');
        return;
    }
    
    const text = elements.messageInput.value.trim();
    const hasFiles = selectedFiles.length > 0;
    
    if (!text && !hasFiles) {
        showToast('Lütfen mesaj yazın veya dosya seçin', 'warning');
        return;
    }
    
    showLoading();
    
    try {
        let result;
        
        if (hasFiles) {
            // Dosya gönderme - FormData kullan
            const formData = new FormData();
            formData.append('text', text || '');
            selectedFiles.forEach((file, index) => {
                formData.append('files', file);
            });
            
            result = await fetch(`${API_BASE_URL}/sleekflow/conversations/${state.currentConversation.id}/messages`, {
                method: 'POST',
                body: formData
            });
            
            if (!result.ok) {
                const errorData = await result.json().catch(() => ({ error: 'Dosya gönderilemedi' }));
                throw new Error(errorData.error || 'Dosya gönderilemedi');
            }
            
            result = await result.json();
        } else {
            // Sadece metin gönderme
            const conversationId = state.currentConversation.conversationId || state.currentConversation.id;
            if (!conversationId) {
                throw new Error('Conversation ID bulunamadı');
            }
            
            console.log('📤 Mesaj gönderiliyor:', { 
                conversationId, 
                text: text.substring(0, 50)
            });
            
            result = await apiRequest(`/sleekflow/conversations/${conversationId}/messages`, 'POST', {
                text
            });
        }
        
        // Temizle
        elements.messageInput.value = '';
        selectedFiles = [];
        updateSelectedFiles();
        
        // Reload messages
        await loadMessages(state.currentConversation.id);
        await loadConversations(); // Refresh conversation list
        
        showToast(hasFiles ? 'Dosya ve mesaj gönderildi' : 'Mesaj gönderildi', 'success');
    } catch (error) {
        showToast(`Mesaj gönderilemedi: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

// ✅ Sidebar toggle fonksiyonu - KULLANICI MANUEL AÇIP KAPATABİLİR
if (typeof window.toggleSidebar === 'undefined') {
    window.toggleSidebar = function() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) {
            console.error('❌ Sidebar elementi bulunamadı!');
            return;
        }
        
        const isOpen = sidebar.classList.contains('open');
        
        if (isOpen) {
            // KAPAT
            sidebar.classList.remove('open');
            sidebar.style.setProperty('left', '-320px', 'important');
            sidebar.style.setProperty('opacity', '0', 'important');
            sidebar.style.setProperty('visibility', 'hidden', 'important');
            sidebar.style.setProperty('pointer-events', 'none', 'important');
            sidebar.style.setProperty('display', 'none', 'important');
            document.body.style.overflow = '';
            console.log('✅ Sidebar KAPALI (kullanıcı kapattı)');
        } else {
            // AÇ
            sidebar.classList.add('open');
            sidebar.style.setProperty('left', '0', 'important');
            sidebar.style.setProperty('opacity', '1', 'important');
            sidebar.style.setProperty('visibility', 'visible', 'important');
            sidebar.style.setProperty('pointer-events', 'auto', 'important');
            sidebar.style.setProperty('display', 'flex', 'important');
            sidebar.style.setProperty('z-index', '10000', 'important');
            document.body.style.overflow = 'hidden';
            console.log('✅ Sidebar AÇIK (kullanıcı açtı)');
        }
    };
}

// ✅ Sidebar'ı zorla aç - KESIN ÇALIŞACAK
function forceOpenSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) {
        console.error('❌ Sidebar elementi bulunamadı!');
        return;
    }
    
    console.log('🔓 Sidebar ZORLA açılıyor...');
    
    // TÜM YÖNTEMLERİ DENE
    sidebar.classList.add('open');
    sidebar.classList.remove('closed');
    
    // Inline styles - ZORLA
    sidebar.style.left = '0px';
    sidebar.style.opacity = '1';
    sidebar.style.visibility = 'visible';
    sidebar.style.display = 'flex';
    sidebar.style.pointerEvents = 'auto';
    sidebar.style.zIndex = '10000';
    sidebar.style.position = 'fixed';
    sidebar.style.transform = 'translateX(0)';
    
    // !important ile ZORLA
    sidebar.style.setProperty('left', '0', 'important');
    sidebar.style.setProperty('opacity', '1', 'important');
    sidebar.style.setProperty('visibility', 'visible', 'important');
    sidebar.style.setProperty('display', 'flex', 'important');
    sidebar.style.setProperty('pointer-events', 'auto', 'important');
    sidebar.style.setProperty('z-index', '10000', 'important');
    sidebar.style.setProperty('position', 'fixed', 'important');
    sidebar.style.setProperty('transform', 'translateX(0)', 'important');
    
    document.body.style.overflow = 'hidden';
    
    // 100ms sonra tekrar kontrol et ve zorla
    setTimeout(() => {
        if (sidebar.style.left !== '0px' && sidebar.style.left !== '0') {
            console.log('⚠️ Sidebar hala kapalı, tekrar zorlanıyor...');
            sidebar.style.setProperty('left', '0', 'important');
            sidebar.style.setProperty('opacity', '1', 'important');
            sidebar.style.setProperty('visibility', 'visible', 'important');
            sidebar.style.setProperty('display', 'flex', 'important');
        }
    }, 100);
    
    console.log('✅ Sidebar açıldı (zorla)');
}

// ✅ Bağlantı durumunu kontrol et
async function checkConnectionStatus() {
    try {
        console.log('🔍 Bağlantı durumu kontrol ediliyor...');
        const result = await apiRequest('/sleekflow/conversations', 'GET');
        const isConnected = result && !result.error && (result.conversations !== undefined);
        console.log('🔍 Bağlantı durumu sonucu:', {
            isConnected: isConnected,
            hasResult: !!result,
            hasError: !!(result && result.error),
            hasConversations: !!(result && result.conversations)
        });
        return isConnected;
    } catch (error) {
        console.warn('⚠️ Bağlantı kontrolü başarısız:', {
            message: error.message,
            endpointFound: error.endpointFound
        });
        return false;
    }
}

// Event Listeners
// Auto-connect on page load
async function autoConnect() {
    try {
        // Load saved credentials from localStorage
        const savedApiKey = localStorage.getItem('sleekflowApiKey');
        const savedBaseUrl = localStorage.getItem('sleekflowBaseUrl') || 'https://api.sleekflow.io';
        const savedZohoClientId = localStorage.getItem('zohoClientId');
        const savedZohoClientSecret = localStorage.getItem('zohoClientSecret');
        const savedZohoRegion = localStorage.getItem('zohoRegion') || 'com';
        
        console.log('🔄 Auto-connect başlatılıyor:', {
            hasApiKey: !!(savedApiKey && savedApiKey.trim() !== ''),
            hasBaseUrl: !!savedBaseUrl,
            savedConnected: localStorage.getItem('sleekflowConnected')
        });
        
        if (savedApiKey && savedApiKey.trim() !== '') {
            console.log('🔄 Otomatik bağlantı başlatılıyor...');
            
            // ✅ ÖNCE BACKEND'E API KEY'I GÖNDER
            try {
                await apiRequest('/auto-connect', 'POST', {
                    sleekflowApiKey: savedApiKey,
                    sleekflowBaseUrl: savedBaseUrl,
                    zohoClientId: savedZohoClientId,
                    zohoClientSecret: savedZohoClientSecret,
                    zohoRegion: savedZohoRegion
                });
                console.log('✅ Backend\'e API key gönderildi');
            } catch (autoConnectError) {
                console.warn('⚠️ Auto-connect endpoint hatası (devam ediliyor):', autoConnectError.message);
            }
            
            // ✅ SONRA CONNECTSLEEKFLOW FONKSİYONUNU ÇAĞIR (TAM BAĞLANTI İÇİN)
            // Input alanlarını doldur
            if (elements.sleekflowApiKey) {
                elements.sleekflowApiKey.value = savedApiKey;
            }
            if (elements.sleekflowBaseUrl) {
                elements.sleekflowBaseUrl.value = savedBaseUrl;
            }
            
            // State'e kaydet
            state.sleekflow.apiKey = savedApiKey;
            state.sleekflow.baseUrl = savedBaseUrl;
            
            // ✅ ÖNCE BAĞLANTI DURUMUNU KONTROL ET
            console.log('🔍 Mevcut bağlantı durumu kontrol ediliyor...');
            const isConnected = await checkConnectionStatus();
            console.log('🔍 Bağlantı durumu sonucu:', isConnected);
            
            if (isConnected) {
                // ✅ BAĞLANTI ZATEN AKTİF - Otomatik bağlan ve sidebar'ı kapat
                console.log('✅ Bağlantı zaten aktif, otomatik bağlanıyor...');
                state.sleekflow.connected = true;
                localStorage.setItem('sleekflowConnected', 'true');
                
                // Sidebar'ı kapat
                const sidebar = document.getElementById('sidebar');
                if (sidebar) {
                    sidebar.classList.remove('open');
                    sidebar.style.setProperty('left', '-320px', 'important');
                    sidebar.style.setProperty('opacity', '0', 'important');
                    sidebar.style.setProperty('visibility', 'hidden', 'important');
                    sidebar.style.setProperty('pointer-events', 'none', 'important');
                    sidebar.style.setProperty('display', 'none', 'important');
                    document.body.style.overflow = '';
                }
                
                // Konuşmaları yükle ve polling başlat
                console.log('📥 Konuşmalar yükleniyor (auto-connect başarılı)...');
                await loadConversations(false); // false = loading göster
                startMessagePolling();
                console.log('✅ Otomatik bağlantı başarılı - UI hazır');
                return;
            }
            
            // ✅ BAĞLANTI KOPMUŞ - YENİDEN BAĞLANMAYI DENE
            console.log('⚠️ Bağlantı kopmuş - yeniden bağlanma deneniyor...');
            try {
                // connectSleekflow fonksiyonunu çağır (otomatik bağlan)
                await connectSleekflow();
                
                // Bağlantı başarılı olduysa sidebar'ı kapat
                if (state.sleekflow.connected) {
                    const sidebar = document.getElementById('sidebar');
                    if (sidebar) {
                        sidebar.classList.remove('open');
                        sidebar.style.setProperty('left', '-320px', 'important');
                        sidebar.style.setProperty('opacity', '0', 'important');
                        sidebar.style.setProperty('visibility', 'hidden', 'important');
                        sidebar.style.setProperty('pointer-events', 'none', 'important');
                        sidebar.style.setProperty('display', 'none', 'important');
                        document.body.style.overflow = '';
                    }
                    console.log('📥 Konuşmalar yükleniyor (yeniden bağlantı başarılı)...');
                    await loadConversations(false); // false = loading göster
                    startMessagePolling();
                    console.log('✅ Yeniden bağlantı başarılı');
                    return;
                }
            } catch (reconnectError) {
                console.error('❌ Yeniden bağlantı hatası:', reconnectError);
            }
            
            // ✅ BAĞLANTI KURULAMADI - SIDEBAR'I ZORLA AÇ
            console.log('⚠️ Bağlantı kurulamadı - sidebar ZORLA açılıyor...');
            localStorage.removeItem('sleekflowConnected');
            state.sleekflow.connected = false;
            forceOpenSidebar();
            console.log('ℹ️ Kullanıcı manuel olarak bağlanmalı (sidebar açık)');
            return;
        } else {
            console.log('⚠️ localStorage\'da API key bulunamadı - sidebar ZORLA açılıyor');
            localStorage.removeItem('sleekflowConnected');
            forceOpenSidebar();
        }
    } catch (error) {
        console.error('❌ Auto-connect error:', error);
        state.sleekflow.connected = false;
        forceOpenSidebar();
    }
}

// Poll for new messages
let messagePollInterval = null;

function startMessagePolling() {
    if (messagePollInterval) {
        clearInterval(messagePollInterval);
    }
    
    messagePollInterval = setInterval(async () => {
        if (!state.sleekflow.connected) {
            return;
        }
        
        try {
            // Refresh conversations to get new messages (sessiz mod)
            await loadConversations(true);
            
            // If there's an active conversation, refresh its messages (sessiz mod)
            if (state.currentConversation) {
                await loadMessages(state.currentConversation.id, true);
            }
        } catch (error) {
            console.error('Message polling error:', error);
        }
    }, 10000); // Every 10 seconds
}

// ✅ BUTON EVENT LISTENER'LARI - HEMEN KUR (DOMContentLoaded'den ÖNCE)
function setupButtonListeners() {
    // Sleekflow butonu - TÜM YÖNTEMLERLE DENE
    const connectBtn = document.getElementById('connectSleekflow');
    if (connectBtn) {
        console.log('✅ connectSleekflow butonu bulundu!');
        
        // ✅ YÖNTEM 1: Direkt onclick ekle
        connectBtn.onclick = async function(e) {
            console.log('🔵🔵🔵 BUTON TIKLANDI (onclick)! connectSleekflow çağrılıyor...');
            e.preventDefault();
            e.stopPropagation();
            try {
                await connectSleekflow();
            } catch (err) {
                console.error('❌ connectSleekflow hatası:', err);
                showToast(`Bağlantı hatası: ${err.message}`, 'error');
            }
        };
        
        // ✅ YÖNTEM 2: addEventListener ekle
        connectBtn.addEventListener('click', async (e) => {
            console.log('🔵🔵🔵 BUTON TIKLANDI (addEventListener)! connectSleekflow çağrılıyor...');
            e.preventDefault();
            e.stopPropagation();
            try {
                await connectSleekflow();
            } catch (err) {
                console.error('❌ connectSleekflow hatası:', err);
                showToast(`Bağlantı hatası: ${err.message}`, 'error');
            }
        });
        
        console.log('✅ Buton event listener'ları kuruldu!');
    } else {
        console.error('❌❌❌ connectSleekflow butonu BULUNAMADI!');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Sidebar event listener'ları HTML'deki inline script'te tanımlı
    // Burada sadece backup olarak kontrol ediyoruz
    
    // ✅ BUTON EVENT LISTENER'LARINI KUR
    setupButtonListeners();
    
    // ✅ EK GÜVENLİK: 500ms sonra tekrar dene (buton geç yüklenmiş olabilir)
    setTimeout(() => {
        setupButtonListeners();
    }, 500);
    
    // ✅ EK GÜVENLİK: 1000ms sonra tekrar dene
    setTimeout(() => {
        setupButtonListeners();
    }, 1000);
    
    // Zoho
    elements.connectZoho?.addEventListener('click', connectZoho);
    const testZohoBtn = document.getElementById('testZoho');
    if (testZohoBtn) {
        testZohoBtn.addEventListener('click', testZoho);
    }
    
    // Chat
    elements.refreshConversations?.addEventListener('click', loadConversations);
    elements.sendMessage?.addEventListener('click', sendMessage);
    elements.messageInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Channel Filter
    elements.channelFilter?.addEventListener('change', (e) => {
        state.selectedChannelFilter = e.target.value;
        loadConversations();
    });
    
    // ✅ Sender Select - Sender seçildiğinde konuşmaları filtrele
    
    // File Upload
    elements.attachFile?.addEventListener('click', () => {
        elements.fileInput?.click();
    });
    
    elements.fileInput?.addEventListener('change', handleFileSelect);
    
    // Search (case-insensitive - Türkçe karakter desteği ile)
    elements.searchConversations?.addEventListener('input', (e) => {
        // Türkçe karakterleri normalize et ve küçük harfe çevir
        const normalizeText = (text) => {
            return text
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '') // Diyakritik işaretleri kaldır
                .replace(/ı/g, 'i')
                .replace(/ğ/g, 'g')
                .replace(/ü/g, 'u')
                .replace(/ş/g, 's')
                .replace(/ö/g, 'o')
                .replace(/ç/g, 'c');
        };
        
        const search = normalizeText(e.target.value.trim());
        const items = elements.conversationsList.querySelectorAll('.conversation-item');
        items.forEach(item => {
            const nameEl = item.querySelector('.conversation-name');
            const previewEl = item.querySelector('.conversation-preview');
            
            if (!nameEl) return;
            
            const name = normalizeText(nameEl.textContent.trim());
            const preview = previewEl ? normalizeText(previewEl.textContent.trim()) : '';
            
            // İsim veya mesaj önizlemesinde ara (case-insensitive)
            const matches = search === '' || name.includes(search) || preview.includes(search);
            item.style.display = matches ? 'flex' : 'none';
        });
    });
    
        // Load saved state
        loadSavedState();
        
        // 🔥 İLK AÇILIŞTA: Zoho lead varsa otomatik filtreleme yap
        console.log('🚀 Sayfa yüklendi...');
        console.log('   window.leadName:', window.leadName);
        console.log('   window.zohoCustomerData:', window.zohoCustomerData);
        
        // Zoho lead data event listener - Her lead değişikliğinde tetiklenir
        window.addEventListener('zohoLeadDataLoaded', (event) => {
            const leadData = event.detail;
            if (leadData && leadData.id) {
                // ✅ FULL_NAME ÖNCELİKLİ - Filtreleme için Full_Name kullanılacak
                window.leadPhone = leadData.phone || leadData.Phone || '';
                window.leadName = leadData.Full_Name || leadData.full_name || leadData.name || leadData.Name || '';
                window.leadId = leadData.id || '';
                window.leadEmail = leadData.email || leadData.Email || '';
                
                console.log('✅✅✅ Zoho lead data event (YENİ LEAD):', {
                    id: window.leadId,
                    name: window.leadName,
                    phone: window.leadPhone ? window.leadPhone.substring(0, 5) + '...' : 'YOK',
                    email: window.leadEmail || 'YOK'
                });
                
                // Lead bilgileri geldi, konuşmaları yükle ve filtrele
                if (state.sleekflow.connected) {
                    console.log('🔄 Lead bilgileri yüklendi, konuşmalar filtreleniyor...');
                    loadConversations(false);
                } else {
                    console.log('⚠️ SleekFlow bağlı değil, konuşmalar yüklenemiyor');
                }
            } else if (leadData && !leadData.id) {
                // Lead bilgisi temizlendi (başka sayfaya geçildi)
                console.log('🔄 Lead bilgisi temizlendi');
                window.leadId = null;
                window.leadPhone = null;
                window.leadName = null;
                window.leadEmail = null;
                state.conversations = [];
                renderConversations();
                updateChatEmptyView();
            }
        });
        
        renderConversations();
        
        // ✅ Leads Follow-Up event listener'larını kur
        setupLeadsFollowUpEventListeners();
        
        // Auto-connect
        autoConnect().then(() => {
            if (state.sleekflow.connected) {
                console.log('✅✅✅ Auto-connect başarılı, konuşmalar yükleniyor...');
                startMessagePolling();
                // ✅ KRİTİK: showAllConversations false olduğu için otomatik filtreleme yapılacak
                state.showAllConversations = false; // Her zaman false başlat (butona basılmadıysa)
                // ✅ ESKİ MANTIK: Direkt konuşmaları yükle (filtreleme otomatik yapılacak)
                loadConversations(false).then(() => {
                    console.log('✅✅✅ Konuşmalar başarıyla yüklendi!');
                }).catch(err => {
                    console.error('❌ Konuşmalar yüklenirken hata:', err);
                });
                
                // ✅ Leads Follow-Up grubunu tekrar yükle (bağlantı kurulduktan sonra)
                loadLeadsFollowUpGroup();
                
            } else {
                console.log('⚠️ Otomatik bağlantı başarısız, konuşmalar yüklenemiyor');
            }
        }).catch(error => {
            console.error('❌ Auto-connect hatası:', error);
            // ✅ HATA OLURSA SIDEBAR'I AÇ
            forceOpenSidebar();
        });
        
        // ✅ Leads Follow-Up grup event listener'ları (YENİ)
        setupLeadsFollowUpEventListeners();
        
        const forwardToLeadsFollowUpBtn = document.getElementById('forwardToLeadsFollowUp');
        if (forwardToLeadsFollowUpBtn) {
            forwardToLeadsFollowUpBtn.addEventListener('click', forwardConversationToLeadsFollowUp);
        }
        
        // Mesaj alanına Enter tuşu ile gönderme
        const leadsFollowUpMessage = document.getElementById('leadsFollowUpMessage');
        if (leadsFollowUpMessage) {
            leadsFollowUpMessage.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                    e.preventDefault();
                    sendToLeadsFollowUpGroup();
                }
            });
        }
        
        // Check connection status periodically
        setInterval(checkConnectionStatus, 30000); // Every 30 seconds
});

async function checkConnectionStatus() {
    try {
        const result = await apiRequest('/status', 'GET');
        
        // Only load conversations if actually connected AND has valid API key
        // Don't auto-load if API key is invalid
        if (result.sleekflow?.connected && result.sleekflow?.hasApiKey && state.sleekflow.connected) {
            // Only refresh if already connected - don't auto-connect with invalid key
            if (state.sleekflow.connected) {
                // Already connected, just refresh
                // Don't auto-load - user should manually connect
            }
        } else {
            // Not connected - don't try to load conversations
            state.sleekflow.connected = false;
        }
        
        if (result.zoho?.connected && result.zoho?.hasAccessToken) {
            state.zoho.connected = true;
        } else {
            state.zoho.connected = false;
        }
    } catch (error) {
        console.error('Status check failed:', error);
        // Don't try to load conversations on error
        state.sleekflow.connected = false;
    }
}

function loadSavedState() {
    const saved = localStorage.getItem('sleekflowState');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (parsed.sleekflowApiKey) {
                elements.sleekflowApiKey.value = parsed.sleekflowApiKey;
            }
            if (parsed.zohoClientId) {
                elements.zohoClientId.value = parsed.zohoClientId;
            }
        } catch (e) {
            console.error('Failed to load saved state:', e);
        }
    }
}

// Handle Zoho callback
function handleZohoCallback(event) {
    // Only process messages from same origin or Zoho callback
    if (event.data.type === 'zoho_callback_success') {
        state.zoho.connected = true;
        updateZohoStatus(true);
        showToast('✅ Zoho bağlantısı başarılı!', 'success');
        console.log('✅ Zoho OAuth callback başarılı');
    } else if (event.data.type === 'zoho_callback_error') {
        state.zoho.connected = false;
        updateZohoStatus(false);
        showToast(`❌ Zoho bağlantı hatası: ${event.data.error || 'Bilinmeyen hata'}`, 'error');
        console.error('❌ Zoho OAuth callback hatası:', event.data.error);
    }
}

// Listen for Zoho OAuth callback messages
window.addEventListener('message', handleZohoCallback);

// Zoho lead data event handler
function handleZohoLeadDataLoaded(event) {
    const leadData = event?.detail || event;
    if (leadData) {
        // Hem phone hem name'i set et
        window.leadPhone = leadData.phone || leadData.Phone || '';
        window.leadName = leadData.name || leadData.Full_Name || leadData.Name || '';
        window.leadId = leadData.id || '';
        window.leadEmail = leadData.email || leadData.Email || '';
        
        console.log('✅✅✅ Zoho lead data yüklendi:', {
            id: window.leadId,
            name: window.leadName,
            phone: window.leadPhone,
            email: window.leadEmail
        });
        
        // SleekFlow bağlıysa konuşmaları yükle ve filtrele
        if (state.sleekflow.connected) {
            loadConversations(false);
        }
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('zohoLeadDataLoaded', handleZohoLeadDataLoaded);
}

// ============================================
// LEADS FOLLOW-UP GRUP FONKSİYONLARI (YENİ - Eski yapıya dokunmadan)
// ============================================
let leadsFollowUpContacts = [];
let selectedLeadsFollowUpContacts = new Set();

// ✅ Grupları Göster/Gizle toggle fonksiyonu
// ⚠️ ÖNEMLİ: Bu fonksiyon SADECE Leads Follow-Up bölümünü toggle eder,
// conversations listesine veya diğer öğelere dokunmaz!
function toggleLeadsFollowUpSection() {
    console.log('🔄 toggleLeadsFollowUpSection çağrıldı');
    
    // ✅ Conversations listesinin ve butonların korunduğundan emin ol
    const conversationsList = document.getElementById('conversationsList');
    const showAllBtn = conversationsList?.querySelector('.btn-primary'); // "Tüm Konuşmaları Göster" butonu
    
    const section = document.getElementById('leadsFollowUpSection');
    if (!section) {
        console.error('❌ Leads Follow-Up section elementi bulunamadı');
        // Bölümü oluşturmayı dene
        const conversationsPanel = document.getElementById('conversationsPanel');
        if (conversationsPanel) {
            console.log('⚠️ Bölüm bulunamadı, oluşturuluyor...');
            // Bölümü conversations-panel'in sonuna ekle (conversations-list'in dışında)
            const newSection = document.createElement('div');
            newSection.id = 'leadsFollowUpSection';
            newSection.style.cssText = 'display: block; margin: 0; padding: 12px 16px; background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-top: 3px solid #3b82f6; box-shadow: 0 2px 8px rgba(59,130,246,0.3); position: relative; z-index: 1000; flex-shrink: 0; width: 100%; box-sizing: border-box;';
            newSection.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid #3b82f6;">
                    <h3 style="margin: 0; font-size: 16px; color: #1e40af; font-weight: 700;">📋 Leads Follow-Up Grubu</h3>
                    <button id="refreshLeadsFollowUp" class="btn btn-icon" title="Yenile" style="padding: 5px 10px; font-size: 13px; background: #3b82f6; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 600;">🔄</button>
                </div>
                <div id="leadsFollowUpList" style="max-height: 200px; overflow-y: auto; margin-bottom: 10px; min-height: 50px; background: white; border-radius: 5px; padding: 8px; border: 2px solid #bfdbfe;">
                    <div class="empty-state">
                        <p style="font-size: 13px; color: #666; margin: 0;">⏳ Grup yükleniyor...</p>
                    </div>
                </div>
                <div id="leadsFollowUpActions" style="margin-top: 10px; display: none;">
                    <button id="selectAllLeadsFollowUp" class="btn btn-secondary" style="width: 100%; margin-bottom: 8px; padding: 8px; font-size: 13px; background: #6b7280; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 500;">✅ Tümünü Seç</button>
                    <textarea id="leadsFollowUpMessage" placeholder="Gruptaki seçili kişilere gönderilecek mesajı yazın..." style="width: 100%; min-height: 80px; padding: 10px; border: 2px solid #d1d5db; border-radius: 5px; font-size: 13px; margin-bottom: 8px; resize: vertical; box-sizing: border-box; font-family: inherit;"></textarea>
                    <button id="sendToLeadsFollowUp" class="btn btn-primary" style="width: 100%; padding: 10px; font-size: 14px; font-weight: 600; background: #3b82f6; color: white; border: none; border-radius: 5px; cursor: pointer; transition: background 0.2s;">📤 Seçili Kişilere Mesaj Gönder</button>
                </div>
            `;
            conversationsPanel.appendChild(newSection);
            console.log('✅ Bölüm oluşturuldu ve eklendi');
            // Event listener'ları ekle
            setupLeadsFollowUpEventListeners();
            loadLeadsFollowUpGroup();
            return;
        }
        return;
    }
    
    const computedStyle = window.getComputedStyle(section);
    const isVisible = computedStyle.display !== 'none' && section.style.display !== 'none';
    
    console.log('🔍 Bölüm durumu:', {
        display: section.style.display,
        computedDisplay: computedStyle.display,
        isVisible: isVisible
    });
    
    // ✅ Conversations listesinin ve butonların görünür olduğundan emin ol
    if (conversationsList) {
        conversationsList.style.display = 'flex';
        conversationsList.style.visibility = 'visible';
    }
    if (showAllBtn) {
        showAllBtn.style.display = 'block';
        showAllBtn.style.visibility = 'visible';
    }
    
    if (isVisible) {
        // Gizle - SADECE Leads Follow-Up bölümünü gizle
        section.style.display = 'none';
        console.log('👁️ Bölüm gizlendi (conversations listesi korundu)');
    } else {
        // Göster ve yükle - SADECE Leads Follow-Up bölümünü göster
        section.style.display = 'block';
        section.style.setProperty('visibility', 'visible', 'important');
        section.style.setProperty('opacity', '1', 'important');
        section.style.setProperty('z-index', '1000', 'important');
        console.log('👁️ Bölüm gösterildi (conversations listesi korundu), yükleniyor...');
        loadLeadsFollowUpGroup();
    }
}

// ✅ Event listener'ları kur
function setupLeadsFollowUpEventListeners() {
    const refreshBtn = document.getElementById('refreshLeadsFollowUp');
    const selectAllBtn = document.getElementById('selectAllLeadsFollowUp');
    const sendBtn = document.getElementById('sendToLeadsFollowUp');
    
    if (refreshBtn && !refreshBtn.hasAttribute('data-listener-added')) {
        refreshBtn.setAttribute('data-listener-added', 'true');
        refreshBtn.addEventListener('click', loadLeadsFollowUpGroup);
    }
    
    if (selectAllBtn && !selectAllBtn.hasAttribute('data-listener-added')) {
        selectAllBtn.setAttribute('data-listener-added', 'true');
        selectAllBtn.addEventListener('click', window.selectAllLeadsFollowUp);
    }
    
    if (sendBtn && !sendBtn.hasAttribute('data-listener-added')) {
        sendBtn.setAttribute('data-listener-added', 'true');
        sendBtn.addEventListener('click', () => sendToLeadsFollowUpGroup());
    }
}

// Leads Follow-Up grubunu yükle
async function loadLeadsFollowUpGroup() {
    const section = document.getElementById('leadsFollowUpSection');
    const list = document.getElementById('leadsFollowUpList');
    const actions = document.getElementById('leadsFollowUpActions');
    
    if (!section || !list) {
        console.error('❌ Leads Follow-Up section elementleri bulunamadı');
        return;
    }
    
    if (!state.sleekflow.connected) {
        list.innerHTML = '<div class="empty-state"><p style="font-size: 14px; color: #666;">⚠️ SleekFlow bağlantısı yok. Lütfen önce bağlanın.</p></div>';
        actions.style.display = 'none';
        console.log('⚠️ SleekFlow bağlantısı yok, Leads Follow-Up grubu yüklenemiyor');
        return;
    }

    try {
        list.innerHTML = '<div class="empty-state"><p style="font-size: 14px; color: #666;">⏳ Grup yükleniyor...</p></div>';
        actions.style.display = 'none';
        
        const result = await apiRequest('/sleekflow/groups/leads-follow-up/contacts', 'GET');
        
        if (result && result.contacts && Array.isArray(result.contacts)) {
            leadsFollowUpContacts = result.contacts;
            selectedLeadsFollowUpContacts.clear();
            
            if (leadsFollowUpContacts.length === 0) {
                list.innerHTML = '<div class="empty-state"><p style="font-size: 14px; color: #666;">ℹ️ Leads Follow-Up grubunda kişi bulunamadı. Grubun adının "Leads Follow-Up" olduğundan emin olun.</p></div>';
                actions.style.display = 'none';
            } else {
                renderLeadsFollowUpList();
                actions.style.display = 'block';
                console.log(`✅ ${leadsFollowUpContacts.length} kişi bulundu`);
            }
        } else {
            list.innerHTML = '<div class="empty-state"><p style="font-size: 14px; color: #ef4444;">❌ Grup yüklenemedi. API yanıtı beklenmeyen formatta.</p></div>';
            actions.style.display = 'none';
        }
    } catch (error) {
        console.error('❌ Leads Follow-Up grubu yükleme hatası:', error);
        list.innerHTML = `<div class="empty-state"><p style="font-size: 14px; color: #ef4444;">❌ Hata: ${error.message || 'Bilinmeyen hata'}</p><p style="font-size: 12px; color: #666; margin-top: 5px;">🔄 Yenile butonuna tıklayarak tekrar deneyin.</p></div>`;
        actions.style.display = 'none';
    }
}

// Leads Follow-Up listesini render et
function renderLeadsFollowUpList() {
    const list = document.getElementById('leadsFollowUpList');
    if (!list) return;

    if (leadsFollowUpContacts.length === 0) {
        list.innerHTML = '<div class="empty-state"><p style="font-size: 14px; color: #666;">Kişi bulunamadı</p></div>';
        return;
    }

    list.innerHTML = leadsFollowUpContacts.map(contact => {
        const isSelected = selectedLeadsFollowUpContacts.has(contact.contactId || contact.id);
        return `
            <div class="conversation-item" style="padding: 10px; margin-bottom: 5px; border: 1px solid ${isSelected ? '#3b82f6' : '#e0e0e0'}; border-radius: 6px; cursor: pointer; background: ${isSelected ? '#eff6ff' : '#fff'};" 
                 onclick="toggleLeadsFollowUpContact('${contact.contactId || contact.id}')">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} 
                           onclick="event.stopPropagation(); toggleLeadsFollowUpContact('${contact.contactId || contact.id}')" 
                           style="cursor: pointer;">
                    <div class="conversation-avatar" style="width: 40px; height: 40px; border-radius: 50%; background: #3b82f6; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 14px;">
                        ${getInitials(contact.name || 'U')}
                    </div>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; color: #333; margin-bottom: 2px;">${contact.name || 'Bilinmeyen'}</div>
                        <div style="font-size: 12px; color: #666;">${contact.phone || 'Telefon yok'}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Leads Follow-Up contact seçimi toggle
window.toggleLeadsFollowUpContact = function(contactId) {
    if (selectedLeadsFollowUpContacts.has(contactId)) {
        selectedLeadsFollowUpContacts.delete(contactId);
    } else {
        selectedLeadsFollowUpContacts.add(contactId);
    }
    renderLeadsFollowUpList();
    updateLeadsFollowUpSendButton();
};

// Tümünü seç/seçimi kaldır
window.selectAllLeadsFollowUp = function() {
    const allSelected = leadsFollowUpContacts.every(c => selectedLeadsFollowUpContacts.has(c.contactId || c.id));
    
    if (allSelected) {
        selectedLeadsFollowUpContacts.clear();
    } else {
        leadsFollowUpContacts.forEach(c => {
            selectedLeadsFollowUpContacts.add(c.contactId || c.id);
        });
    }
    
    renderLeadsFollowUpList();
    updateLeadsFollowUpSendButton();
};

// Gönder butonunu güncelle
function updateLeadsFollowUpSendButton() {
    const sendBtn = document.getElementById('sendToLeadsFollowUp');
    const count = selectedLeadsFollowUpContacts.size;
    
    if (sendBtn) {
        sendBtn.disabled = count === 0;
        sendBtn.textContent = count > 0 ? `📤 ${count} Kişiye Mesaj Gönder` : '📤 Seçili Kişilere Mesaj Gönder';
    }
}

// Leads Follow-Up grubuna mesaj gönder
async function sendToLeadsFollowUpGroup(messageTextParam = null, fileUrlParam = null, fileNameParam = null) {
    let messageText = messageTextParam || document.getElementById('leadsFollowUpMessage')?.value?.trim();
    
    if (!messageText && !fileUrlParam) {
        showToast('Lütfen mesaj yazın veya dosya seçin', 'warning');
        return;
    }
    
    if (selectedLeadsFollowUpContacts.size === 0) {
        showToast('Lütfen en az bir kişi seçin', 'warning');
        return;
    }
    
    const contactIds = Array.from(selectedLeadsFollowUpContacts);
    
    showLoading();
    
    try {
        // Eğer dosya varsa, önce dosyayı indirip base64'e çevir veya direkt URL'i kullan
        const payload = {
            text: messageText || '',
            contactIds: contactIds
        };
        
        if (fileUrlParam) {
            payload.fileUrl = fileUrlParam;
            payload.fileName = fileNameParam || '';
        }
        
        const result = await apiRequest('/sleekflow/groups/leads-follow-up/send-message', 'POST', payload);
        
        if (result.success) {
            showToast(`✅ ${result.sent} kişiye mesaj gönderildi${result.failed > 0 ? `, ${result.failed} başarısız` : ''}`, 'success');
            
            // Mesaj alanını temizle (sadece manuel yazılan mesajlar için)
            if (!messageTextParam && document.getElementById('leadsFollowUpMessage')) {
                document.getElementById('leadsFollowUpMessage').value = '';
            }
            
            // Seçimleri temizle
            selectedLeadsFollowUpContacts.clear();
            renderLeadsFollowUpList();
            updateLeadsFollowUpSendButton();
        } else {
            showToast(`❌ Mesaj gönderilemedi: ${result.error || 'Bilinmeyen hata'}`, 'error');
        }
    } catch (error) {
        console.error('❌ Leads Follow-Up mesaj gönderme hatası:', error);
        showToast(`Mesaj gönderilemedi: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

// ✅ YENİ: Mesajı Leads Follow-Up grubuna yönlendir
window.forwardMessageToLeadsFollowUp = async function(messageId, messageText, fileUrl, fileName) {
    console.log('📤 Mesaj yönlendiriliyor:', { messageId, messageText, fileUrl, fileName });
    
    // Onay iste
    const confirmMessage = `Bu mesajı Leads Follow-Up grubundaki tüm kişilere yönlendirmek istediğinize emin misiniz?`;
    if (!confirm(confirmMessage)) {
        return;
    }
    
    showLoading();
    
    try {
        // Önce Leads Follow-Up grubunu yükle (eğer yüklenmemişse)
        if (leadsFollowUpContacts.length === 0) {
            showToast('Leads Follow-Up grubu yükleniyor...', 'info');
            await loadLeadsFollowUpGroup();
        }
        
        // Eğer hala boşsa, hata göster
        if (leadsFollowUpContacts.length === 0) {
            showToast('Leads Follow-Up grubunda kişi bulunamadı', 'error');
            return;
        }
        
        // Tüm kişileri otomatik seç
        selectedLeadsFollowUpContacts.clear();
        leadsFollowUpContacts.forEach(c => {
            selectedLeadsFollowUpContacts.add(c.contactId || c.id);
        });
        renderLeadsFollowUpList();
        updateLeadsFollowUpSendButton();
        
        // Mesaj alanını doldur
        const messageTextarea = document.getElementById('leadsFollowUpMessage');
        if (messageTextarea) {
            if (messageText) {
                messageTextarea.value = messageText;
            } else if (fileUrl) {
                messageTextarea.value = `📎 Dosya: ${fileName || 'Dosya'}`;
            }
        }
        
        // Leads Follow-Up bölümünü göster (scroll yap)
        const section = document.getElementById('leadsFollowUpSection');
        if (section) {
            section.style.display = 'block';
            section.style.setProperty('visibility', 'visible', 'important');
            section.style.setProperty('opacity', '1', 'important');
            section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        
        // Mesajı otomatik gönder
        await sendToLeadsFollowUpGroup(messageText || '', fileUrl || null, fileName || null);
        
        showToast('✅ Mesaj Leads Follow-Up grubuna yönlendirildi!', 'success');
    } catch (error) {
        console.error('❌ Mesaj yönlendirme hatası:', error);
        showToast(`Mesaj yönlendirilemedi: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
};

// ✅ YENİ: Tüm konuşmayı Leads Follow-Up grubuna yönlendir
async function forwardConversationToLeadsFollowUp() {
    if (!state.currentConversation) {
        showToast('Lütfen bir konuşma seçin', 'warning');
        return;
    }
    
    // Onay iste
    const confirmMessage = `Bu konuşmanın en son mesajını Leads Follow-Up grubundaki tüm kişilere yönlendirmek istediğinize emin misiniz?`;
    if (!confirm(confirmMessage)) {
        return;
    }
    
    showLoading();
    
    try {
        // Tüm mesajları al (sadece gelen mesajlar)
        const conversationId = state.currentConversation.id || state.currentConversation.conversationId;
        const messages = state.messages[conversationId] || [];
        
        if (messages.length === 0) {
            showToast('Bu konuşmada mesaj bulunamadı', 'warning');
            return;
        }
        
        // Sadece gelen mesajları filtrele
        const receivedMessages = messages.filter(msg => msg.direction === 'received');
        
        if (receivedMessages.length === 0) {
            showToast('Bu konuşmada yönlendirilecek mesaj bulunamadı', 'warning');
            return;
        }
        
        // En son gelen mesajı al
        const lastMessage = receivedMessages[receivedMessages.length - 1];
        
        // Mesajı yönlendir
        await window.forwardMessageToLeadsFollowUp(
            lastMessage.id,
            lastMessage.text || '',
            lastMessage.fileUrl || null,
            lastMessage.fileName || null
        );
    } catch (error) {
        console.error('❌ Konuşma yönlendirme hatası:', error);
        showToast(`Konuşma yönlendirilemedi: ${error.message}`, 'error');
    } finally {
        hideLoading();
    }
}

