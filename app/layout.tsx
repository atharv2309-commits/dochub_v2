import type { Metadata } from 'next'
import { Geist_Mono, Lora, Inter } from 'next/font/google'
import { headers } from 'next/headers'
import './globals.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from '@/components/ThemeProvider'
import { DEFAULT_LOCALE, getDir } from '@/lib/i18n/config'

// Inter is the global UI + docs font (matches docs.flytbase.com / GitBook).
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

// Lora serif kept available for optional display use.
const lora = Lora({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'DocHub — FlytBase Documentation',
  description: 'Your organization documentation hub',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // proxy.ts sets x-locale on localized routes; default elsewhere (admin/auth).
  const locale = (await headers()).get('x-locale') || DEFAULT_LOCALE
  return (
    <html lang={locale} dir={getDir(locale)} suppressHydrationWarning>
      <body className={`${inter.variable} ${geistMono.variable} ${lora.variable} antialiased`}>
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>
            {children}
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
