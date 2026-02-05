'use client'

import dynamic from 'next/dynamic'
import { memo, useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { cn } from '@/lib/utils'

export interface MarkdownProps {
  content: string
  className?: string
}

const LazyCodeBlock = dynamic(
  async () => {
    const mod = await import('./code-block')
    return mod.CodeBlock
  },
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-20 bg-bg-2 rounded-[var(--radius-md)]" />,
  }
)

export const Markdown = memo(function Markdown({ content, className }: MarkdownProps) {
  const components = useMemo<Components>(() => {
    return {
      pre: ({ children }) => <>{children}</>,
      p: ({ children }) => (
        <p className="text-sm text-fg-0 leading-relaxed mb-3 last:mb-0">{children}</p>
      ),
      ul: ({ children }) => (
        <ul className="text-sm text-fg-0 list-disc pl-5 mb-3 space-y-1">{children}</ul>
      ),
      ol: ({ children }) => (
        <ol className="text-sm text-fg-0 list-decimal pl-5 mb-3 space-y-1">{children}</ol>
      ),
      li: ({ children }) => <li className="text-fg-0">{children}</li>,
      h1: ({ children }) => (
        <h1 className="text-base font-semibold text-fg-0 mt-5 mb-2 first:mt-0">{children}</h1>
      ),
      h2: ({ children }) => (
        <h2 className="text-sm font-semibold text-fg-0 mt-4 mb-2">{children}</h2>
      ),
      h3: ({ children }) => (
        <h3 className="text-sm font-medium text-fg-0 mt-3 mb-2">{children}</h3>
      ),
      h4: ({ children }) => (
        <h4 className="text-xs font-medium text-fg-1 mt-3 mb-1">{children}</h4>
      ),
      a: ({ node: _node, ...props }) => (
        <a
          className="text-status-info hover:underline underline-offset-2"
          target="_blank"
          rel="noopener noreferrer"
          {...props}
        >
          {props.children}
        </a>
      ),
      strong: ({ children }) => (
        <strong className="font-semibold text-fg-0">{children}</strong>
      ),
      em: ({ children }) => <em className="italic text-fg-0">{children}</em>,
      blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-bd-1 pl-3 text-fg-1 italic mb-3">{children}</blockquote>
      ),
      hr: () => <hr className="border-bd-0 my-4" />,
      table: ({ children }) => (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full text-sm border-collapse">{children}</table>
        </div>
      ),
      thead: ({ children }) => <thead className="bg-bg-2">{children}</thead>,
      th: ({ children }) => (
        <th className="px-3 py-2 text-left text-xs font-medium text-fg-1 border border-bd-0 whitespace-nowrap">
          {children}
        </th>
      ),
      td: ({ children }) => (
        <td className="px-3 py-2 text-fg-0 border border-bd-0 align-top">{children}</td>
      ),
      code: ({
        node: _node,
        className,
        children,
        ...props
      }) => {
        const raw = String(children ?? '')
        const languageMatch = /language-([a-z0-9_-]+)/i.exec(className ?? '')
        const language = languageMatch?.[1] ?? null

        const isInline = !className
        if (isInline) {
          return (
            <code
              className="px-1.5 py-0.5 bg-bg-3 rounded-[var(--radius-sm)] text-[12px] font-mono text-fg-0"
              {...props}
            >
              {raw}
            </code>
          )
        }

        return <LazyCodeBlock code={raw.replace(/\n$/, '')} language={language} />
      },
    }
  }, [])

  return (
    <div className={cn('text-sm text-fg-0 leading-relaxed break-words', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
