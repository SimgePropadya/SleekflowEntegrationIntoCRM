// zohoClient.js
// Client Credentials akışı ile Zoho API erişimi
require('dotenv').config();
const axios = require('axios');

// ✅ Token cache (1 saat geçerli)
let tokenCache = {
    accessToken: null,
    expiresAt: null
};

/**
 * Client Credentials akışı ile Zoho access token al
 */
async function getZohoAccessToken() {
    // Cache'de geçerli token varsa onu kullan
    if (tokenCache.accessToken && tokenCache.expiresAt && Date.now() < tokenCache.expiresAt) {
        console.log('✅ Cache\'den Zoho access token kullanılıyor');
        return tokenCache.accessToken;
    }

    try {
        console.log('🔑 Zoho access token alınıyor (client_credentials)...');
        
        const params = new URLSearchParams();
        params.append('grant_type', 'client_credentials');
        params.append('client_id', process.env.ZOHO_CLIENT_ID);
        params.append('client_secret', process.env.ZOHO_CLIENT_SECRET);
        params.append('scope', process.env.ZOHO_SCOPE || 'ZohoCRM.modules.ALL');
        params.append('soid', `ZohoCRM.${process.env.ZOHO_ORG_ID}`);

        const response = await axios.post(
            `${process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com'}/oauth/v2/token`,
            params,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const accessToken = response.data.access_token;
        const expiresIn = response.data.expires_in || 3600; // Varsayılan 1 saat
        
        // Cache'e kaydet (5 dakika önce expire olacak şekilde)
        tokenCache.accessToken = accessToken;
        tokenCache.expiresAt = Date.now() + (expiresIn - 300) * 1000;

        console.log('✅✅✅ Zoho access token alındı (client_credentials)');
        return accessToken;
    } catch (error) {
        const errorDetails = error.response?.data || error.message;
        console.error('❌ Zoho access token alma hatası:', errorDetails);
        
        // ✅ 401 hatası için detaylı log
        if (error.response?.status === 401) {
            console.error('❌❌❌ ZOHO API CREDENTIALS HATASI:', {
                hasClientId: !!process.env.ZOHO_CLIENT_ID,
                hasClientSecret: !!process.env.ZOHO_CLIENT_SECRET,
                hasOrgId: !!process.env.ZOHO_ORG_ID,
                clientIdPrefix: process.env.ZOHO_CLIENT_ID?.substring(0, 10),
                error: errorDetails
            });
        }
        
        throw error;
    }
}

/**
 * Zoho API GET isteği
 */
async function zohoGet(path, params = {}) {
    const accessToken = await getZohoAccessToken();
    const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';

    try {
        const response = await axios.get(
            `${apiDomain}${path}`,
            {
                params,
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );

        return response.data;
    } catch (error) {
        console.error(`❌ Zoho API GET hatası (${path}):`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * Zoho API POST isteği
 */
async function zohoPost(path, data = {}, params = {}) {
    const accessToken = await getZohoAccessToken();
    const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';

    try {
        const response = await axios.post(
            `${apiDomain}${path}`,
            data,
            {
                params,
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );

        return response.data;
    } catch (error) {
        console.error(`❌ Zoho API POST hatası (${path}):`, error.response?.data || error.message);
        throw error;
    }
}

module.exports = {
    getZohoAccessToken,
    zohoGet,
    zohoPost
};

