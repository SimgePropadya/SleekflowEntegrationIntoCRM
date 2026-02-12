# Zoho CRM – SleekFlow Inbox Embed Linki

## Base URL (Zoho'da `{}` kabul edilmiyorsa bunu kullanın)

Zoho "Base URL" alanı `{{ }}` gibi karakterlere izin vermiyorsa **sadece** aşağıdaki linki yapıştırın. Widget, lead ID ve ismini sayfa referrer'ı ve backend API ile alır; **her lead için dinamik** çalışır.

```
https://sleekflowentegrationintocrm-1.onrender.com/zoho-embed
```

- Lead ID: Zoho lead sayfasının adresinden (referrer) otomatik çıkarılır.
- Lead ismi: Backend `/api/zoho/lead-info` ile Zoho'dan alınır; filtre buna göre uygulanır.

## Zoho'da parametrelere izin varsa (opsiyonel)

"Query Parameters" veya ayrı bir URL parametre alanı varsa ve merge field kullanılabiliyorsa, isim için ek parametre ekleyebilirsiniz:

```
https://sleekflowentegrationintocrm-1.onrender.com/zoho-embed?recordId={{Record.Id}}&recordName={{Lead.Full_Name}}
```

**Not:** Sadece Base URL alanı varsa ve `{}` hata veriyorsa yukarıdaki **parametresiz** linki kullanın.

## Zoho'da nereye girilir?

1. **Setup** → **Customization** → **Modules** → **Leads**
2. **Layouts** → Lead detay layout → **Web Tab** / **Widget**
3. **Base URL** alanına: `https://sleekflowentegrationintocrm-1.onrender.com/zoho-embed`

## Farklı domain

Kendi domain'inizde çalıştırıyorsanız `WIDGET_BASE_URL` ortam değişkenini kendi adresinizle set edin.

---

## Lead filtresi çalışmıyorsa – çözüm seçenekleri

1. **Manuel lead adı (widget içi)**  
   Konuşmalar listesinin üstünde **"Lead adı (filtre için)"** alanı var. Zoho'dan isim gelmiyorsa bu alana lead'in adını yazın (örn. "Adil Yaman"); liste anında o isme göre filtrelenir.

2. **Zoho API'yi düzeltmek**  
   Tarayıcıda Network sekmesinde `GET /api/zoho/lead-info?id=...` cevabına bakın. `Full_Name` dolu mu? Boşsa: Zoho token/scope/org ve lead kaydında isim alanının dolu olması gerekir.

3. **Base URL**  
   Zoho'da sadece `https://sleekflowentegrationintocrm-1.onrender.com/zoho-widget.html` veya `/zoho-embed` kullanın. Lead ID sayfa referrer'ından, isim API veya manuel alandan gelir.
