import type { Metadata } from 'next';
import './globals.css';
import ClientWrapper from './auth/ClientWrapper';

export const metadata: Metadata = {
  title: 'Animation Studio',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><ClientWrapper>{children}</ClientWrapper></body>
    </html>
  );
}
