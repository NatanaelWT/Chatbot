import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MessageContent({ children, loading = false, errorMessage }: { children: string; loading?: boolean; errorMessage?: string }) {
  if (!children) return loading
    ? <span className="typing-dots" aria-label="AI sedang menulis"><i /><i /><i /></span>
    : <span className="message-empty">{errorMessage ?? "Jawaban tidak dapat diselesaikan. Silakan coba lagi."}</span>;
  return (
    <div className="markdown break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: linkChildren }) => <a href={href} target="_blank" rel="noreferrer noopener">{linkChildren}</a>,
          code: ({ children: codeChildren, className }) => <code className={className}>{codeChildren}</code>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
