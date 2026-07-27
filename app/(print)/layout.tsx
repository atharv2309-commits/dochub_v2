// Minimal layout for the print/PDF route: forces a white page and sensible
// page breaks. Rendered only for /print/* and consumed by Puppeteer.
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        html, body { background: #ffffff !important; color-scheme: light !important; }
        .pdf-cover { break-after: page; }
        .pdf-section { break-before: page; }
        .pdf-section img,
        .pdf-section pre,
        .pdf-section figure,
        .pdf-section table,
        .pdf-section li { break-inside: avoid; }
        h1, h2, h3, h4 { break-after: avoid; }
        a { color: #d95b28; }
      `}</style>
      {children}
    </>
  )
}
