// ✅ ZOHO CRM MASS ACTION BUTTON - DELUGE SCRIPT
// Bu script'i Zoho CRM'de Mass Action Menu custom button oluştururken kullan
// Setup → Customization → Modules → Leads → Buttons → Create Button
// Button Type: Mass Action Menu
// Action: Custom Function
// Select Page: In List

// ✅ Seçili lead ID'lerini al (Zoho CRM otomatik olarak sağlar)
ids = requestParams.get("ids").toList(",");

// ✅ Eğer seçili lead yoksa uyarı göster
if (ids.size() == 0) {
    response = {"message": "Lütfen en az bir lead seçin!", "type": "error"};
    return response;
}

// ✅ Bulk message URL'ine yönlendir (lead ID'leri URL parametresi olarak)
baseUrl = "https://sleekflowentegrationintocrm.onrender.com";
leadIdsParam = ids.join(",");
url = baseUrl + "/bulk-message.html?leadIds=" + leadIdsParam;

// ✅ Yeni pencerede aç (JavaScript ile)
response = {
    "message": "Bulk message sayfası açılıyor...",
    "type": "success",
    "redirect": url
};

// ✅ JavaScript ile yeni pencerede aç
openUrl(url);

return response;

