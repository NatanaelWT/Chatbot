"use client";

type Props = { startupError?: string };

export function AuthPanel({ startupError }: Props) {
  return (
    <main className="auth-page">
      <section className="auth-hero" aria-labelledby="auth-title">
        <div className="brand-mark">R<span>↗</span></div>
        <p className="eyebrow">ROUTERCHAT / AI WORKSPACE</p>
        <h1 id="auth-title">Semua model.<br /><em>Satu ruang kerja.</em></h1>
        <p className="hero-copy">Chat lebih fokus dengan model AI terbaik, riwayat yang rapi, tanpa kredit atau paket langganan.</p>
        <div className="hero-points"><span>01</span><p>Multi-model lewat 9Router</p><span>02</span><p>Respons streaming real-time</p><span>03</span><p>Data &amp; penggunaan terkendali</p></div>
      </section>
      <section className="auth-card" aria-labelledby="auth-form-title">
        <div className="mobile-brand"><div className="brand-mark">R<span>↗</span></div><span>RouterChat</span></div>
        <div className="auth-heading"><p className="eyebrow">SELAMAT DATANG</p><h2 id="auth-form-title">Masuk ke workspace</h2><p>Akun baru langsung dibuat saat pertama kali masuk dengan Gmail.</p></div>
        {startupError && <p className="form-error" role="alert">{startupError}</p>}
        <a className="google-auth-button" href="/api/auth/google">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.3c1.9-1.8 2.9-4.4 2.9-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.5c-.9.6-2.1 1-3.4 1a5.9 5.9 0 0 1-5.5-4.1H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.5 14a6 6 0 0 1 0-3.9V7.4H3.1a10 10 0 0 0 0 9.2L6.5 14Z"/><path fill="#EA4335" d="M12 6a5.4 5.4 0 0 1 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.1 7.4l3.4 2.7A5.9 5.9 0 0 1 12 6Z"/></svg>
          <span>Lanjutkan dengan Gmail</span>
        </a>
        <p className="auth-footnote">Tidak ada password atau menu daftar terpisah. Dengan melanjutkan, kamu menyetujui ketentuan penggunaan dan kebijakan privasi.</p>
      </section>
    </main>
  );
}
