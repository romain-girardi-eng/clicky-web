import type { ReactNode } from 'react'
import { ClickyShell } from './clicky-shell'

export const metadata = {
  title: 'Clicky Next.js example',
  description: 'Demo app for @clicky/react inside Next.js 15 App Router.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClickyShell>{children}</ClickyShell>
      </body>
    </html>
  )
}
