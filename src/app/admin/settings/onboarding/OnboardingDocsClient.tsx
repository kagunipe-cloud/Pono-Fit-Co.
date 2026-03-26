"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-bold text-stone-800 mt-2 mb-4 pb-2 border-b border-stone-200">{children}</h1>
  ),
  h2: ({ children }) => <h2 className="text-xl font-semibold text-stone-800 mt-8 mb-3">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-semibold text-stone-800 mt-5 mb-2">{children}</h3>,
  p: ({ children }) => <p className="text-sm text-stone-700 leading-relaxed my-3">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1.5 my-3 text-sm text-stone-700">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1.5 my-3 text-sm text-stone-700">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-stone-800">{children}</strong>,
  hr: () => <hr className="my-8 border-stone-200" />,
  a: ({ href, children }) => (
    <a href={href} className="text-brand-600 hover:underline" target={href?.startsWith("http") ? "_blank" : undefined} rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}>
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="text-xs font-mono bg-stone-100 border border-stone-200 rounded-lg p-3 my-3 overflow-x-auto">{children}</pre>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = Boolean(className);
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="text-sm font-mono bg-stone-100 px-1.5 py-0.5 rounded text-stone-800" {...props}>
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="overflow-x-auto my-4 -mx-1">
      <table className="w-full text-sm border-collapse border border-stone-200">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-stone-50">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-stone-200 px-3 py-2 text-left font-semibold text-stone-800">{children}</th>
  ),
  td: ({ children }) => <td className="border border-stone-200 px-3 py-2 text-stone-700 align-top">{children}</td>,
};

export function OnboardingDocsClient({ markdown }: { markdown: string }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-6 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="px-4 py-2 rounded-lg bg-brand-600 text-sm font-medium text-stone-900 hover:bg-brand-700"
        >
          Print / save as PDF
        </button>
        <p className="text-xs text-stone-500">Uses your browser print dialog — choose “Save as PDF” where available.</p>
      </div>
      <article className="rounded-xl border border-stone-200 bg-white p-6 sm:p-8 shadow-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {markdown}
        </ReactMarkdown>
      </article>
    </>
  );
}
