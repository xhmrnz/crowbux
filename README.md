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
4. Payment gateway atau admin backend memanggil endpoint konfirmasi pembayaran menggunakan `PAYMENT_WEBHOOK_SECRET`.
5. Trigger D1 mengubah order menjadi `PAID` dan mengurangi stok tepat satu kali.
6. Admin menggunakan `ADMIN_API_SECRET` untuk mengelola stok, harga, dan konfirmasi pembayaran manual.

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
