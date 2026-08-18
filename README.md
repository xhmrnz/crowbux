# Crowbux

Crowbux adalah storefront top-up Robux dengan katalog harga dinamis, stok global, dan nomor antrean harian.

## Halaman

- `index.html` — storefront pembeli.
- `admin.html` — dashboard admin untuk restock dan harga per 1.000 Robux.
- `worker/index.js` — Cloudflare Worker API.
- `worker/schema.sql` — skema Cloudflare D1.

## Alur data

1. Storefront mengambil stok dan harga paket dari `GET /api/catalog`.
2. Checkout membuat order `PENDING` dan nomor antrean berurutan per tanggal Jakarta.
3. Payment gateway atau admin backend memanggil endpoint konfirmasi pembayaran menggunakan `PAYMENT_WEBHOOK_SECRET`.
4. Trigger D1 mengubah order menjadi `PAID` dan mengurangi stok tepat satu kali.
5. Admin mengakses `admin.html` menggunakan `ADMIN_API_SECRET`, lalu dapat mengelola stok, harga, dan mengonfirmasi pembayaran manual.

Harga paket dihitung proporsional dengan rumus `robux / 1000 × harga dasar`.

## Cloudflare

Konfigurasi Worker berada di `wrangler.jsonc`. Secrets yang diperlukan:

```text
ADMIN_API_SECRET
PAYMENT_WEBHOOK_SECRET
```

Endpoint konfirmasi pembayaran sengaja tidak tersedia dari browser pembeli. Hubungkan endpoint tersebut ke webhook payment gateway agar stok hanya berkurang setelah pembayaran benar-benar terverifikasi.
