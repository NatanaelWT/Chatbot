"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { readSseStream } from "@/lib/sse";
import type { User } from "./chat-shell";
import { MessageContent } from "./message-content";

type Conversation = { id: string; title: string; status: string; updated_at: string };
type Message = { id: string; role: "user" | "assistant"; content_json: { text?: string }; status: string };
type Model = { id: string; name: string; provider: string | null };
type Props = { user: User; onLoggedOut: () => void };

export function ChatWorkspace({ user, onLoggedOut }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeId = searchParams.get("chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageConversationId, setMessageConversationId] = useState<string | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(activeId);
  const streamingConversationRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const activeConversation = useMemo(() => conversations.find((item) => item.id === activeId), [conversations, activeId]);
  const filteredConversations = useMemo(() => conversations.filter((item) => item.title.toLocaleLowerCase("id").includes(search.trim().toLocaleLowerCase("id"))), [conversations, search]);
  const visibleMessages = activeId && messageConversationId === activeId ? messages : [];

  useEffect(() => { activeConversationIdRef.current = activeId; }, [activeId]);

  const loadConversations = useCallback(async () => {
    const response = await fetch("/api/conversations");
    if (response.status === 401) { onLoggedOut(); return; }
    if (!response.ok) throw new Error("Riwayat tidak dapat dimuat.");
    setConversations(((await response.json()) as { conversations: Conversation[] }).conversations);
  }, [onLoggedOut]);

  useEffect(() => {
    Promise.all([
      fetch("/api/conversations").then(async (response) => {
        if (response.status === 401) { onLoggedOut(); return; }
        if (!response.ok) throw new Error("Riwayat tidak dapat dimuat.");
        setConversations(((await response.json()) as { conversations: Conversation[] }).conversations);
      }),
      fetch("/api/models").then(async (response) => {
        if (!response.ok) throw new Error("Model AI belum tersedia. Jalankan provider AI, lalu isi ROUTER9_ALLOWED_MODELS.");
        const loaded = ((await response.json()) as { models: Model[] }).models;
        if (!loaded.length) throw new Error("Tidak ada model AI yang tersedia dari ROUTER9_ALLOWED_MODELS.");
        setModels(loaded);
        setSelectedModel(loaded[0].id);
      }),
    ]).catch((reason) => setError(reason instanceof Error ? reason.message : "Workspace tidak dapat dimuat."))
      .finally(() => setLoading(false));
  }, [loadConversations, onLoggedOut]);

  useEffect(() => {
    if (!activeId || streamingConversationRef.current === activeId) return;
    fetch(`/api/conversations/${encodeURIComponent(activeId)}`).then(async (response) => {
      if (!response.ok) throw new Error("Percakapan tidak dapat dimuat.");
      const loaded = ((await response.json()) as { messages: Message[] }).messages;
      if (streamingConversationRef.current === activeId) return;
      setMessages(loaded);
      setMessageConversationId(activeId);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Percakapan tidak dapat dimuat."));
  }, [activeId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);

  function selectConversation(id: string) {
    activeConversationIdRef.current = id;
    router.push(`/?chat=${encodeURIComponent(id)}`);
    setMobileSidebar(false);
    setError("");
  }

  function newConversation() {
    activeConversationIdRef.current = null;
    setMessages([]);
    setMessageConversationId(null);
    setInput("");
    setError("");
    router.push("/");
    setMobileSidebar(false);
  }


  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending || !selectedModel) return;
    let conversationId = activeId;
    if (!conversationId) {
      const created = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!created.ok) { setError("Chat baru tidak dapat dibuat."); return; }
      const conversation = ((await created.json()) as { conversation: Conversation }).conversation;
      conversationId = conversation.id;
      activeConversationIdRef.current = conversationId;
      setConversations((current) => [conversation, ...current]);
      router.push(`/?chat=${encodeURIComponent(conversationId)}`);
    }
    streamingConversationRef.current = conversationId;
    setInput(""); setError(""); setSending(true);
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    abortRef.current = controller;
    requestIdRef.current = requestId;
    const localUser: Message = { id: `user-${requestId}`, role: "user", content_json: { text }, status: "complete" };
    const localAssistant: Message = { id: `assistant-${requestId}`, role: "assistant", content_json: { text: "" }, status: "streaming" };
    setMessageConversationId(conversationId);
    setMessages((current) => messageConversationId === conversationId ? [...current, localUser, localAssistant] : [localUser, localAssistant]);
    let assistantMessageId = localAssistant.id;
    let receivedDone = false;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, model: selectedModel, message: text, requestId }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(failure.error?.message ?? "Pesan gagal dikirim.");
      }
      await readSseStream(response, ({ event: streamEvent, data }) => {
        const payload = data as { content?: string; message?: string; messageId?: string; status?: string };
        if (streamEvent === "meta" && payload.messageId) {
          const previousId = assistantMessageId;
          assistantMessageId = payload.messageId;
          setMessages((current) => current.map((item) => item.id === previousId ? { ...item, id: assistantMessageId } : item));
        }
        if (streamEvent === "delta" && payload.content) setMessages((current) => current.map((item) => item.id === assistantMessageId ? { ...item, content_json: { text: `${item.content_json.text ?? ""}${payload.content}` } } : item));
        if (streamEvent === "error") setError(payload.message ?? "Koneksi AI terputus.");
        if (streamEvent === "done") {
          receivedDone = true;
          setMessages((current) => current.map((item) => item.id === assistantMessageId ? { ...item, status: payload.status ?? "complete" } : item));
        }
      });
      if (!receivedDone) throw new Error("Koneksi jawaban berakhir sebelum AI selesai.");
      const persistedResponse = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`);
      if (persistedResponse.ok) {
        const persistedMessages = ((await persistedResponse.json()) as { messages: Message[] }).messages;
        if (activeConversationIdRef.current === conversationId) {
          setMessages(persistedMessages);
          setMessageConversationId(conversationId);
        }
      }
      await loadConversations();
    } catch (reason) {
      setMessages((current) => current.map((item) => item.id === assistantMessageId
        ? { ...item, status: item.content_json.text ? "partial" : "failed" }
        : item));
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Pesan gagal dikirim.");
    } finally {
      if (streamingConversationRef.current === conversationId) streamingConversationRef.current = null;
      setSending(false);
      abortRef.current = null;
      requestIdRef.current = null;
    }
  }

  function stopGeneration() {
    const requestId = requestIdRef.current;
    if (requestId) void fetch(`/api/chat?requestId=${encodeURIComponent(requestId)}`, { method: "DELETE" }).catch(() => undefined);
    abortRef.current?.abort();
  }

  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); onLoggedOut(); }

  if (loading) return <main className="app-loading" aria-live="polite">Menyiapkan workspace…</main>;
  return (
    <main className="workspace">
      <aside className={`sidebar ${mobileSidebar ? "open" : ""}`}>
        <div className="sidebar-top"><div className="brand"><span className="brand-mark small">R<span>↗</span></span><strong>RouterChat</strong></div><button type="button" className="icon-button mobile-only" aria-label="Tutup sidebar" onClick={() => setMobileSidebar(false)}>×</button></div>
        <button type="button" className="new-chat" onClick={newConversation}><span aria-hidden="true">＋</span> Chat baru <kbd>⌘ K</kbd></button>
        <label className="search-box"><span aria-hidden="true">⌕</span><input aria-label="Cari percakapan" name="conversation-search" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari percakapan…" /></label>
        <div className="conversation-list"><p className="list-label">Terbaru</p>{filteredConversations.length ? filteredConversations.map((conversation) => <button type="button" className={`conversation-item ${conversation.id === activeId ? "selected" : ""}`} key={conversation.id} onClick={() => selectConversation(conversation.id)}><span>{conversation.title}</span><small>{new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(new Date(conversation.updated_at))}</small></button>) : <p className="empty-list">{search.trim() ? "Percakapan tidak ditemukan." : "Belum ada percakapan."}</p>}</div>
        <div className="sidebar-bottom">{user.role === "admin" && <Link className="admin-link" href="/admin"><span>Dashboard admin</span><span aria-hidden="true">↗</span></Link>}<div className="profile"><span className="avatar">{user.email[0].toUpperCase()}</span><span className="profile-info"><strong>{user.email.split("@")[0]}</strong><small>{user.role === "admin" ? "Admin" : "Gratis"} · Chat tanpa batas</small></span><button type="button" className="icon-button" aria-label="Keluar" onClick={logout}>↪</button></div></div>
      </aside>
      {mobileSidebar && <button type="button" className="sidebar-scrim" aria-label="Tutup sidebar" onClick={() => setMobileSidebar(false)} />}
      <section className="chat-area">
        <header className="chat-header"><button type="button" className="icon-button mobile-only" aria-label="Buka sidebar" onClick={() => setMobileSidebar(true)}>☰</button><div><p className="eyebrow">CONVERSATION / {activeConversation ? "ACTIVE" : "NEW"}</p><h2>{activeConversation?.title ?? "Percakapan baru"}</h2></div><div className="header-actions"><label className="model-select"><span>MODEL</span><select aria-label="Pilih model AI" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} disabled={!models.length}>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label></div></header>
        <div className="message-scroll"><div className="message-column">{!visibleMessages.length ? <div className="welcome"><div className="welcome-icon">✦</div><p className="eyebrow">READY WHEN YOU ARE</p><h1>Mulai dari satu<br /><em>pertanyaan.</em></h1><p className="welcome-copy">Pilih model AI lalu tulis apa yang ada di pikiranmu. RouterChat akan membantu menyusun sisanya.</p><div className="prompt-grid"><button type="button" onClick={() => setInput("Bantu saya menyusun rencana yang lebih baik untuk minggu ini")}>Rencanakan minggu ini <span>↗</span></button><button type="button" onClick={() => setInput("Jelaskan konsep ini dengan cara yang sederhana")}>Jelaskan sesuatu <span>↗</span></button></div></div> : visibleMessages.map((message) => <article className={`message ${message.role}`} key={message.id}><div className="message-meta"><span className={message.role === "assistant" ? "assistant-dot" : "avatar tiny"}>{message.role === "assistant" ? "✦" : user.email[0].toUpperCase()}</span><strong>{message.role === "assistant" ? "RouterChat" : "Kamu"}</strong></div><MessageContent loading={message.status === "streaming"}>{message.content_json.text ?? ""}</MessageContent>{message.role === "assistant" && message.content_json.text && <div className="message-tools"><button type="button" onClick={() => navigator.clipboard.writeText(message.content_json.text ?? "")}>Salin</button></div>}</article>)}<div ref={endRef} /></div></div>
        {error && <p className="workspace-error" role="alert">{error}</p>}
        <div className="composer-wrap"><form className="composer" onSubmit={sendMessage}><textarea name="message" aria-label="Tulis pesan" autoComplete="off" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Tulis pesan…" rows={1} maxLength={20000} disabled={sending} /><div className="composer-footer"><span className="composer-hint">{selectedModel ? "Enter untuk kirim · Shift + Enter untuk baris baru" : "Pilih model AI untuk memulai"}</span><div className="composer-actions">{sending ? <button type="button" className="stop-button" onClick={stopGeneration} aria-label="Hentikan jawaban">■</button> : <button type="submit" className="send-button" disabled={!input.trim() || !selectedModel} aria-label="Kirim pesan">↗</button>}</div></div></form><p className="disclaimer">RouterChat dapat membuat kesalahan. Periksa informasi penting.</p></div>
      </section>
    </main>
  );
}
