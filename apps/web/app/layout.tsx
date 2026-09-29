import './globals.css';
export const metadata = { title: 'PWA Pharmacy Delivery', manifest: '/manifest.webmanifest' };
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}<script dangerouslySetInnerHTML={{__html:`if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'))}`}} /></body></html>;
}
