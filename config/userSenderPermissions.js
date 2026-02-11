// Kullanıcı-Sender ve Kanal Yetkilendirme Mapping'i
// Her kullanıcı için hangi sender numaralarını ve kanalları görebileceği tanımlanır
//
// KULLANIM:
// 1. Zoho CRM'de kullanıcıların email adreslerini bulun (Settings > Users)
// 2. Bu dosyada kullanıcı email'lerini ekleyin
// 3. Her kullanıcı için görebileceği sender numaralarını ve kanalları tanımlayın
//
// SENDER NUMARALARI:
// - '908505327532' = VIP-+908505327532
// - '905421363421' = Hamzah Coexistence-+905421363421
//
// KANAL İSİMLERİ (Sleekflow'taki channel name'ler):
// - 'VIP Proje Pazarlama' = VIP kanalı
// - 'Hamzah Coexistence' = Hamzah Coexistence kanalı
// - 'Propadya® | Your All-In-One Real I' = Propadya kanalı
//
// YETKİLENDİRME FORMATLARI:
//
// ESKİ FORMAT (Geriye dönük uyumluluk için hala destekleniyor):
// - ['*'] = Tüm sender'ları görebilir (admin)
// - ['908505327532'] = Sadece VIP numarasını görebilir (tüm kanallar)
// - ['905421363421'] = Sadece Hamzah Coexistence numarasını görebilir (tüm kanallar)
//
// YENİ FORMAT (Kanal bazlı kontrol için):
// - { senders: ['*'], channels: ['*'] } = Tüm sender'lar ve tüm kanallar (admin)
// - { senders: ['908505327532'], channels: ['VIP Proje Pazarlama'] } = Sadece VIP numarası ve VIP kanalı
// - { senders: ['905421363421'], channels: ['Hamzah Coexistence'] } = Sadece Hamzah numarası ve Hamzah kanalı
// - { senders: ['908505327532'], channels: ['*'] } = VIP numarası, tüm kanallar
// - { senders: ['*'], channels: ['Hamzah Coexistence'] } = Tüm sender'lar, sadece Hamzah kanalı
//
// NOT: channels: ['*'] veya channels belirtilmemişse = O sender'daki tüm kanallar
//      senders: ['*'] = Tüm sender'lar

module.exports = {
    
    // ✅ ESKİ FORMAT (Geriye dönük uyumluluk)
    // VIP Property - VIP numarasını görebilir (tüm kanallar)
    'info@vipproperty.com': ['908505327532'], // VIP-+908505327532
    
    // Propadya - VIP numarasını görebilir (tüm kanallar)
    'hello@propadya.com': ['908505327532'], // VIP-+908505327532
    
    // ✅ YENİ FORMAT (Kanal bazlı kontrol)
    // Örnek: Hamza sadece Hamzah Coexistence kanalından mesajları görebilir
    // 'hamza@example.com': {
    //     senders: ['905421363421'],
    //     channels: ['Hamzah Coexistence']
    // },
    
    // Örnek: VIP kullanıcısı sadece VIP kanalından mesajları görebilir
    // 'vip@example.com': {
    //     senders: ['908505327532'],
    //     channels: ['VIP Proje Pazarlama']
    // },
    
    // Default: Eğer kullanıcı listede yoksa, tüm sender'ları ve tüm kanalları görebilir
    // Güvenlik için sınırlı bir değer de kullanılabilir
    'default': ['*']
};

