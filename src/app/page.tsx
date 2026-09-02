import { ChatShell } from "@/components/chat-shell";

const authErrors: Record<string, string> = {
  configuration: "Login Google belum dikonfigurasi oleh administrator.",
  denied: "Login Google dibatalkan.",
  gmail_required: "Gunakan akun dengan alamat @gmail.com.",
  invalid: "Login Google gagal. Coba lagi.",
  rate_limited: "Terlalu banyak percobaan. Coba lagi nanti.",
  suspended: "Akun ini dinonaktifkan.",
};

export default async function Home({ searchParams }: { searchParams: Promise<{ auth_error?: string }> }) {
  const { auth_error: error } = await searchParams;
  return <ChatShell authError={error ? authErrors[error] : undefined} />;
}
