# Crowbux

Crowbux adalah storefront top-up Robux dengan katalog harga dinamis, stok global, nomor antrean harian, dan validasi akun Roblox nyata.

## Halaman

- `index.html` — storefront pembeli.
- `admin.html` — dashboard admin untuk restock dan harga per 1.000 Robux.
- `worker/index.js` — Cloudflare Worker API.
- `worker/schema.sql` — skema Cloudflare D1 untuk instalasi baru.
- `worker/migrations` — migrasi untuk database produksi.

## Alur data

1. Storefront mengambil stok dan harga paket dari `GET /api/catalog`.
2. `POST /api/roblox/users/resolve` mencocokkan username melalui Roblox Users API dan menampilkan avatar dari Thumbnails API.
3. Checkout memvalidasi ulang User ID Roblox di server, lalu membuat order `PENDING` dan nomor antrean berurutan per tanggal Jakarta.
4. Untuk DANA, Worker membuat QRIS dengan nominal order dan menerima notifikasi pembayaran langsung dari DANA.
5. Payment gateway lain atau admin backend dapat memakai endpoint konfirmasi pembayaran manual.
6. Trigger D1 mengubah order menjadi `PAID` dan mengurangi stok tepat satu kali.
7. Admin menggunakan `ADMIN_API_SECRET` untuk mengelola stok, harga, dan konfirmasi pembayaran manual.

Harga paket dihitung proporsional dengan rumus `robux / 1000 × harga dasar`.

## Cloudflare

Konfigurasi Worker berada di `wrangler.jsonc`. Secrets yang diperlukan:

```text
ADMIN_API_SECRET
PAYMENT_WEBHOOK_SECRET
```

Migrasi D1 dan deploy Worker:

```powershell
npx wrangler d1 migrations apply crowbux-db --remote
npx wrangler deploy
```

Endpoint konfirmasi pembayaran sengaja tidak tersedia dari browser pembeli. Hubungkan endpoint tersebut ke webhook payment gateway agar stok hanya berkurang setelah pembayaran benar-benar terverifikasi.

## DANA QRIS

Integrasi memakai **QRIS Acquirer MPM**. Browser hanya menerima QR dan status transaksi; private key dan komunikasi ke DANA tetap berada di Cloudflare Worker.

Variable Worker yang diperlukan:

```text
DANA_API_BASE_URL=https://api.sandbox.dana.id
DANA_ORIGIN=https://xhmrnz.me
```

Simpan identitas merchant dan key sebagai Worker secrets agar tidak masuk Git:

```powershell
npx wrangler secret put DANA_PARTNER_ID
npx wrangler secret put DANA_MERCHANT_ID
npx wrangler secret put DANA_STORE_ID
npx wrangler secret put DANA_CHANNEL_ID
npx wrangler secret put DANA_PRIVATE_KEY
npx wrangler secret put DANA_PUBLIC_KEY
```

`DANA_PARTNER_ID` adalah Client ID / `X-PARTNER-ID` dari DANA Dashboard. Jika diberikan oleh DANA, `DANA_SUB_MERCHANT_ID` dan `DANA_TERMINAL_ID` juga dapat ditambahkan sebagai secrets.

`DANA_PRIVATE_KEY` harus berupa RSA 2048-bit PKCS#8 milik merchant. `DANA_PUBLIC_KEY` adalah public key yang diberikan DANA untuk memverifikasi signature notifikasi.

Callback/finish-notify yang perlu didaftarkan di DANA Dashboard:

```text
https://crowbux-api.crowbux-stock.workers.dev/api/payments/dana/notify
```

Mulai dari kredensial Sandbox di DANA Dashboard. Aktivasi production memerlukan approval serta whitelist dari DANA. Selama variable atau secret belum lengkap, opsi DANA otomatis dinonaktifkan di storefront.

Referensi resmi:

- [DANA QRIS Acquirer overview](https://dashboard.dana.id/api-docs-v2/api/qris-acquirer/overview)
- [Generate QRIS](https://dashboard.dana.id/api-docs-v2/api/qris-acquirer/generate-qris)
- [Finish Notify](https://dashboard.dana.id/api-docs-v2/api/qris-acquirer/finish-notify)
- [Asymmetric signature](https://dashboard.dana.id/api-docs-v2/guide/authentication/authentication-asymmetric)

## Roblox OAuth

Validasi username tidak memerlukan login. OAuth bersifat opsional dan dipakai untuk membuktikan bahwa pembeli benar-benar memiliki akun tersebut.

1. Daftarkan OAuth 2.0 application di Creator Dashboard Roblox.
2. Tambahkan redirect URI `https://crowbux-api.crowbux-stock.workers.dev/api/roblox/oauth/callback`.
3. Tambahkan variable `ROBLOX_OAUTH_CLIENT_ID` melalui konfigurasi Worker.
4. Jika application bertipe confidential, simpan secret dengan `npx wrangler secret put ROBLOX_OAUTH_CLIENT_SECRET`.
5. Deploy ulang Worker. Tombol **Hubungkan Roblox** akan aktif otomatis.

Implementasi menggunakan Authorization Code dengan PKCE, scope `openid profile`, User ID permanen dari claim `sub`, serta token Crowbux sekali pakai saat checkout. Access token Roblox dicabut setelah data akun diterima.

Referensi:

- [Roblox web API directory](https://github.com/matthewdean/roblox-web-apis)
- [Roblox OAuth 2.0 implementation](https://create.roblox.com/docs/cloud/auth/oauth2-develop)
- [Roblox OAuth app registration](https://create.roblox.com/docs/cloud/auth/oauth2-registration)
