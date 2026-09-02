import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MessageContent({ children, loading = false }: { children: string; loading?: boolean }) {
  if (!children) return loading
    ? <span className="typing-dots" aria-label="AI sedang menulis"><i /><i /><i /></span>
    : <span className="message-empty">Jawaban tidak dapat diselesaikan.</span>;
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
