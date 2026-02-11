// Meta Instagram Messaging API Service
const axios = require('axios');
const logger = require('../utils/logger');

class MetaInstagramService {
    constructor() {
        this.pageAccessToken = null;
        this.instagramBusinessAccountId = null;
    }

    /**
     * Meta API credentials'ı set et
     */
    setCredentials(pageAccessToken, instagramBusinessAccountId) {
        this.pageAccessToken = pageAccessToken;
        this.instagramBusinessAccountId = instagramBusinessAccountId;
    }

    /**
     * Instagram mesaj gönder (Meta Instagram Messaging API)
     * https://developers.facebook.com/docs/instagram-platform/messaging
     */
    async sendMessage(recipientInstagramId, messageText) {
        if (!this.pageAccessToken) {
            throw new Error('Meta Page Access Token gerekli');
        }

        if (!this.instagramBusinessAccountId) {
            throw new Error('Instagram Business Account ID gerekli');
        }

        if (!recipientInstagramId) {
            throw new Error('Recipient Instagram ID gerekli');
        }

        const url = `https://graph.facebook.com/v18.0/${this.instagramBusinessAccountId}/messages`;
        
        const payload = {
            recipient: {
                id: recipientInstagramId
            },
            message: {
                text: messageText
            },
            messaging_type: 'RESPONSE' // 24 saat içinde gelen mesajlara cevap için
        };

        try {
            const response = await axios.post(url, payload, {
                headers: {
                    'Content-Type': 'application/json'
                },
                params: {
                    access_token: this.pageAccessToken
                },
                timeout: 10000
            });

            logger.info('✅ Meta Instagram mesaj gönderildi', {
                recipientInstagramId,
                messageId: response.data.message_id,
                response: response.data
            });

            return response.data;
        } catch (error) {
            logger.error('❌ Meta Instagram mesaj gönderme hatası', {
                error: error.message,
                response: error.response?.data,
                status: error.response?.status,
                recipientInstagramId
            });
            throw error;
        }
    }
}

module.exports = new MetaInstagramService();

