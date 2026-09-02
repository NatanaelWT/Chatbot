# RouterChat

Chatbot Next.js gratis dengan login wajib, history persisten, streaming SSE, serta provider AI OpenAI-compatible.

## Fitur tersedia

- Login/registrasi tunggal melalui Google OAuth untuk akun Gmail, hashed session, RBAC admin.
- Chat tanpa kuota untuk semua pengguna terautentikasi.
- Percakapan persisten dengan ownership server-side.
- Allowlist model provider AI dan streaming SSE.
- PGlite persisten untuk lokal; PostgreSQL tetap didukung untuk deployment.
- Dashboard `/admin` untuk metrik penggunaan, pengguna, dan error generasi.
- Pencarian judul percakapan dan Markdown.

## Prasyarat

- Node.js 20.9+
- Google Cloud OAuth 2.0 Web client.
- Provider AI OpenAI-compatible yang dapat diakses aplikasi.
- PostgreSQL tidak wajib untuk pengujian lokal; mode PGlite persisten sudah tersedia.

## Menjalankan lokal

Konfigurasi lokal tersedia di `.env.local` (file ini diabaikan Git). Untuk menyiapkan ulang:

```powershell
Copy-Item .env.example .env.local
# Isi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ROUTER9_BASE_URL,
# ROUTER9_API_KEY, dan ROUTER9_ALLOWED_MODELS.
npm install
npm run db:migrate
```

Jalankan aplikasi:

```powershell
npm run dev
```

Buka `http://localhost:3000`, klik **Lanjutkan dengan Gmail**, pilih akun, lalu kirim pesan. Login pertama otomatis membuat akun gratis tanpa kuota; tidak ada form daftar atau password aplikasi. History tersimpan di `.routerchat/pgdata`.

Di Google Cloud Console, buat **OAuth client ID** bertipe **Web application**. Tambahkan `http://localhost:3000` sebagai **Authorized JavaScript origin** dan `http://localhost:3000/api/auth/google/callback` sebagai **Authorized redirect URI**. Nilai ini harus cocok dengan `APP_URL`; gunakan HTTPS saat production. Simpan Client ID/Secret hanya di `.env.local`.

## Provisioning admin

Masuk sekali dengan Gmail agar akun dibuat. Setelah itu, promosikan role melalui CLI server-side:

```powershell
npm run admin:promote -- natanaelhdxd25@gmail.com
```

CLI menolak email yang belum masuk melalui Google, serta mencatat promosi ke `audit_logs`. Admin mendapat menu `/admin` dan tetap dapat memakai chatbot. Batas panjang pesan, konteks, output, serta infrastruktur provider tetap berlaku.

`ROUTER9_ALLOWED_MODELS` wajib berisi ID model yang diizinkan; model pertama yang tersedia menjadi default. Secret tidak boleh memakai awalan `NEXT_PUBLIC_`. Isi `ROUTER9_BASE_URL`, `ROUTER9_API_KEY`, serta allowlist di `.env.local`; tidak diperlukan runtime atau model AI lokal.

## Verifikasi

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

## Akses chat

Semua pengguna terautentikasi mendapat akses chat gratis tanpa kredit atau kuota penggunaan. Rate-limit burst untuk perlindungan spam serta batas infrastruktur provider tetap berlaku. Generasi tetap dicatat untuk riwayat dan monitoring operasional.

## Batasan MVP

Attachment, Regenerate, export, file/web search, RAG, voice, vision, image, email verification, password reset, Redis rate-limit, dan observability belum tersedia.

Sebelum produksi: validasi model, uji `stream_options.include_usage`, HTTPS, rotasi secret, backup PostgreSQL, cleanup session/rate-limit, monitoring, kebijakan privasi, dan abuse controls.
