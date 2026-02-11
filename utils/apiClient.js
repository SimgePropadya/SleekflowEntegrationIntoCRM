// Frontend API client - Merkezi API istekleri

// API Base URL - Dinamik olarak belirlenir
const API_BASE_URL = (typeof window !== 'undefined' && window.location.origin) 
    ? `${window.location.origin}/api`
    : 'http://localhost:3000/api';

/**
 * API isteği yap
 */
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
            
            const error = new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
            error.status = response.status;
            error.data = errorData;
            throw error;
        }
        
        const result = await response.json();
        console.log(`✅ Success Response:`, result);
        return result;
    } catch (error) {
        console.error('❌ API Error:', error);
        throw error;
    }
}

// Browser'da kullanılabilir hale getir
if (typeof window !== 'undefined') {
    window.apiRequest = apiRequest;
    window.API_BASE_URL = API_BASE_URL;
}

// Node.js için export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        apiRequest,
        API_BASE_URL
    };
}

