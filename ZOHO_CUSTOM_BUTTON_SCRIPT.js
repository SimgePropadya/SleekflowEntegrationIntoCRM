// ✅ ZOHO CRM CUSTOM BUTTON SCRIPT - KESİN ÇÖZÜM
// Bu script'i Zoho CRM'de custom button oluştururken kullan
// Setup → Customization → Buttons → Create Button → Type: JavaScript

// ✅ Seçili lead ID'lerini al (5 farklı yöntemle)
function getSelectedLeadIds() {
    const leadIds = [];
    
    // ✅ Yöntem 1: Checkbox'lardan al (en yaygın)
    const checkboxes = document.querySelectorAll('input[type="checkbox"]:checked');
    console.log('✅ Seçili checkbox sayısı:', checkboxes.length);
    
    checkboxes.forEach((checkbox, index) => {
        // Checkbox'un value'sunu veya data attribute'unu al
        let leadId = checkbox.value || 
                    checkbox.getAttribute('data-id') || 
                    checkbox.getAttribute('data-record-id') ||
                    checkbox.getAttribute('id');
        
        // ✅ Yöntem 2: Parent element'ten al
        if (!leadId || leadId.length < 10) {
            const parent = checkbox.closest('tr, div, li, td');
            if (parent) {
                leadId = parent.getAttribute('data-id') || 
                        parent.getAttribute('data-record-id') ||
                        parent.getAttribute('id') ||
                        parent.getAttribute('data-entity-id');
            }
        }
        
        // ✅ Yöntem 3: Link'ten al (Zoho CRM'de lead link'leri genelde ID içerir)
        if (!leadId || leadId.length < 10) {
            const link = checkbox.closest('tr, div, li')?.querySelector('a[href*="/Leads/"], a[href*="/tab/Leads/"]');
            if (link) {
                const match = link.href.match(/\/Leads\/(\d{10,})|\/tab\/Leads\/(\d{10,})/);
                if (match && (match[1] || match[2])) {
                    leadId = match[1] || match[2];
                }
            }
        }
        
        // ✅ Yöntem 4: Checkbox'un yakınındaki span veya div'den al
        if (!leadId || leadId.length < 10) {
            const nearbyElements = checkbox.closest('tr, div, li')?.querySelectorAll('[data-id], [data-record-id], [id*="lead"], [id*="record"]');
            if (nearbyElements && nearbyElements.length > 0) {
                for (const el of nearbyElements) {
                    const id = el.getAttribute('data-id') || el.getAttribute('data-record-id') || el.id;
                    if (id && id.length >= 10 && !id.includes('select-all') && !id.includes('selectAll')) {
                        leadId = id;
                        break;
                    }
                }
            }
        }
        
        // ✅ Yöntem 5: Zoho CRM JavaScript API (eğer varsa)
        if (!leadId || leadId.length < 10) {
            try {
                if (typeof ZOHO !== 'undefined' && ZOHO.CRM && ZOHO.CRM.UI) {
                    // getSelectedRecords() kullan (async olabilir, bu yüzden burada sadece deneme)
                    console.log('Zoho CRM API mevcut, getSelectedRecords() denenebilir');
                }
            } catch (e) {
                // API yoksa devam et
            }
        }
        
        // ✅ Filtrele: Geçerli bir lead ID olmalı
        if (leadId && leadId.toString().length >= 10 && 
            !leadId.toString().includes('select-all') && 
            !leadId.toString().includes('selectAll') &&
            !leadId.toString().includes('header') &&
            !leadId.toString().includes('footer')) {
            leadIds.push(leadId.toString());
            console.log(`✅ Lead ID ${index + 1} bulundu:`, leadId);
        } else {
            console.warn(`⚠️ Checkbox ${index + 1} için geçerli lead ID bulunamadı:`, {
                leadId,
                checkboxValue: checkbox.value,
                checkboxId: checkbox.id
            });
        }
    });
    
    console.log('✅✅✅ Toplam seçili lead ID sayısı:', leadIds.length);
    return leadIds;
}

// ✅ Bulk message sayfasına yönlendir
function openBulkMessage() {
    const selectedIds = getSelectedLeadIds();
    
    if (selectedIds.length === 0) {
        alert('⚠️ Lütfen en az bir lead seçin!');
        return;
    }
    
    // ✅ Bulk message URL'ine yönlendir (lead ID'leri URL parametresi olarak)
    const baseUrl = 'https://sleekflowentegrationintocrm.onrender.com';
    const leadIdsParam = selectedIds.join(',');
    const url = `${baseUrl}/bulk-message.html?leadIds=${leadIdsParam}`;
    
    console.log('✅✅✅ Bulk message sayfası açılıyor:', {
        url,
        selectedCount: selectedIds.length,
        leadIds: selectedIds.slice(0, 5) // İlk 5'ini logla
    });
    
    // ✅ Yeni pencerede aç (veya mevcut pencerede)
    window.open(url, '_blank');
}

// ✅ Button'a tıklandığında çalıştır
try {
    openBulkMessage();
} catch (error) {
    console.error('❌ Hata:', error);
    alert('Hata: ' + error.message);
}

