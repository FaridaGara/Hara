# Tədbir yarat — Addım 5

Figma mənbəyi: [Final version — Update new](https://www.figma.com/design/pFXp0OVxTYfIIMePHe0Cyv/Final-version?node-id=91-3403).

Baza commit: `da6127ff070cb49e97e6be98d7b937f66a9acb1b`.

Əvvəlki wizard üçüncü addımda dayanırdı. Bu dəyişiklik tədbirin yekun yoxlanmasını, əvvəlki bölmələrə düzəlişi, iştirakçı önbaxışını və moderasiyaya göndərilməsini birləşdirir.

## İstifadəçi axını

- Beşinci addımda əsas məlumatlar, tarix/məkan, satış/biletlər və media xülasəsi görünür. Mövcud açıq/tünd rəng sistemi və Figma SVG ikonları istifadə olunur.
- Düzəliş ayrıca surətdə aparılır. Yalnız “Dəyişiklikləri tətbiq et” ilkin qaralamanı dəyişir; geri qayıtmaq düzəlişi ləğv edir.
- Önbaxış seçilmiş şəkilləri, bilet qiymətlərini, sifariş limitlərini, geri qaytarılma mətnini və oturacaq planını göstərir. Buradan alış edilmir.
- Məcburi sahələr, keçmiş tarix, satış vaxtları, tutum və üz qabığı yoxlanır. Vaxtlar Bakı vaxtı (UTC+4) kimi emal olunur.
- Göndərmə ID-si sorğudan əvvəl hesab üzrə brauzerdə saxlanır. Təkrar klik bloklanır; itmiş cavabdan sonra mövcud sorğunun statusu GET ilə yoxlanır.
- Göndərilən tədbir qaralama statusunda qalır. İctimai siyahıya və satışa yalnız əməkdaş təsdiqindən sonra çıxır.
- “Tədbirlərim” göndərilmiş tədbirləri göstərir; yeni tədbir yaratmaq və mövcud tədbiri yenidən açmaq mümkündür. Başqa qaralamanı əvəz etməzdən əvvəl xəbərdarlıq göstərilir.

## Dördüncü addımla əlaqə

Repozitoriyada media addımı olmadığı üçün üz qabığı və maksimum dörd əlavə şəkil üçün işlək yükləmə mərhələsi əlavə edilib. JPEG/PNG/WebP şəkilləri brauzerdə kiçildilir və JPEG kimi saxlanır. Bu dəyişiklik ayrıca tam Figma media redaktoru, əl ilə kəsmə və sürükləyərək sıralama funksiyalarını əhatə etmir.

## Server və moderasiya

Yeni `events.0007_eventsubmission` miqrasiyası göndərişin sahibini, tədbirini, surətini, sorğu izini və moderasiya qeydini saxlayır.

| Endpoint | Davranış |
| --- | --- |
| `GET /api/event-submissions/eligibility/` | Hesabın göndərmə hüququ |
| `GET /api/event-submissions/` | Yalnız cari hesabın göndərişləri |
| `GET /api/event-submissions/{uuid}/` | Status və saxlanmış surət |
| `PUT /api/event-submissions/{uuid}/` | Təkrarlana bilən, atomik göndərmə |
| `GET /api/event-submissions/{uuid}/images/{index}/` | Yalnız yayımlanmış tədbirin mediası; 0 üz qabığı, 1–4 qalereya, 5 plan fonu |

Göndərmək üçün təsdiqlənmiş e-poçt, ad, əlaqə nömrəsi və server tərəfindən verilmiş təşkilatçı rolu tələb olunur. Adi istifadəçi qaralama yarada bilər. Mövcud hesab modeli ayrıca təşkilatçı sənəd yoxlaması/pending statusu saxlamır; bu dəyişiklik belə bir status uydurmur və hesab rolunu yüksəltmir.

Django admin-də **Event submissions** bölməsindən:

1. Düzəliş üçün `changes_requested` seçilir və səbəb yazılır.
2. Təsdiq üçün “Yoxlamanı təsdiqlə və yayımla” əməliyyatı istifadə olunur. Tarixlər, tutum, profil və media yenidən yoxlanır.

Göndərilmiş tədbirin sahibi ümumi təşkilatçı API-si ilə gözləyən tədbiri yayımlaya və ya biletlərini dəyişə bilməz. Düzəliş tələb olunarsa eyni göndəriş ID-si və tədbir yenilənir.

Oturacaq kateqoriyaları bilet inventarına çevrilir; bağlı yerlər silinmir. Planın ilkin geometriyası surətdə saxlanır, tətbiq edilmiş çevirmə inventar koordinatlarına köçürülür. Görünən sahədən kənar yerlər düzəliş tələb edir. Sifariş limitləri serverdə bütün bilet növlərinin cəminə tətbiq olunur.

Yaş, dil, biletə daxil olanlar və geri qaytarılma mətni göndəriş surətində və önbaxışda saxlanır. Mövcud ictimai tədbir səhifəsinin bütün bu sahələri göstərməsi və avtomatik refund icrası bu dəyişiklikdə əlavə edilməyib.

## Yoxlama və tətbiq

Frontend üçün TypeScript yoxlaması, dəyişən faylların ESLint yoxlaması, testlər və istehsal build-i icra edilib. Ətraflı nəticə paketdəki `verification.json` faylındadır.

Backend Python sintaksis yoxlamasından keçib. Əlavə edilmiş 14 API/inteqrasiya testi lokal mühitdə GDAL/PostGIS olmadığı üçün icra edilməyib. Miqrasiyanın yoxlanması, tətbiqi və tam backend testləri mövcud PostGIS GitHub Actions işi ilə tamamlanmalıdır:

```bash
cd backend
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py migrate --noinput
python manage.py test --noinput
```

Brauzerin lokal dev serverə girişi `ERR_BLOCKED_BY_CLIENT` ilə bloklandığı üçün vizual müqayisə və real backend ilə brauzerdən tam axın təsdiqlənməyib. Müvəqqəti yoxlama səhifəsi son koddan çıxarılıb.

## Paketdən istifadə

Paketdə dəyişmiş mənbə faylları, bu qeyd, yoxlama nəticəsi və `changes.patch` var. Baza commit üzərində əvvəlcə `git apply --check changes.patch`, sonra `git apply changes.patch` işlədilə bilər. Mövcud lokal dəyişikliklərlə konflikt olarsa avtomatik üzərinə yazılmamalıdır.
