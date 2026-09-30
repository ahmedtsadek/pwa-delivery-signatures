import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'PWA Pharmacy Delivery',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/pwa-icon/192', sizes: '192x192', type: 'image/png' },
      { url: '/icon.svg', type: 'image/svg+xml' }
    ],
    apple: [
      { url: '/pwa-icon/180', sizes: '180x180', type: 'image/png' }
    ]
  },
  appleWebApp: {
    capable: true,
    title: 'PWA Pharmacy Delivery',
    statusBarStyle: 'default'
  }
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}<script dangerouslySetInnerHTML={{__html:`if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'))}`}} /></body></html>;
}
