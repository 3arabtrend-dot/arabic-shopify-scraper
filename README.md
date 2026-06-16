# arabic-shopify-scraper

سحب منتجات من متاجر OpenCart العربية، ترجمتها إنجليزي بـ Claude، ونشرها على Shopify (رويال ظفار).

## التثبيت
```bash
npm install
cp .env.example .env   # املأ المفاتيح
```

## الاختبار التدريجي (المهم)
ابدأ صغير وكبّر بالتدريج. **جرّب السحب بس الأول بدون مفاتيح:**

```bash
# 1) اكتشاف التصنيفات تلقائياً
node run.js discover "https://alwidadperfumes.com/"

# 2) سحب منتجين فقط — بدون ترجمة وبدون نشر (للتأكد من الاستخراج)
node run.js category "https://alwidadperfumes.com/index.php?route=product/category&path=8" --limit 2 --no-translate --dry

# 3) منتجين بالكامل (ترجمة + نشر Draft) — يحتاج CLAUDE_API_KEY + Shopify
node run.js category "<categoryUrl>" --limit 2

# 4) كبّر لـ 5
node run.js category "<categoryUrl>" --limit 5

# 5) التصنيف كله
node run.js category "<categoryUrl>" --limit 100000
```

الأعلام: `--limit N` | `--no-translate` (سحب فقط) | `--dry` (بدون نشر) | `--no-reviews`

## الاستئناف
كل تصنيف له ملف تقدّم في `data/progress_*.json`. لو اتقطع، شغّل نفس الأمر تاني — يكمّل من حيث وقف (المنشور لا يتكرر).

## التقييمات
بعد النشر، يتولّد ملف `data/reviews_*.csv` بصيغة **Judge.me** (التقييمات عربي).
استورده من: Shopify ← Judge.me ← Manage Reviews ← Import/Export.

## القرارات المثبتة
- الاسم/التايتل/الوصف: إنجليزي (ترجمة). التقييمات: عربي كما هي.
- السعر: قبل الخصم، بدون ضريبة (÷ 1.05).
- الصور: صور المنتج فقط (رئيسية + جاليري)، الأصل الكامل.
- SKU = رقم الموديل. المكرر (نفس SKU) = skip. متعدد الخيارات = skip مؤقتاً.
- النشر: Draft، قابل للشراء دائماً. صفر أثر لرابط المصدر على المتجر.

## كود الاختبارات
```bash
node test/unit.js
```
