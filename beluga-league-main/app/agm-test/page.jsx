import CertTest from '../components/cert/CertTest'

// Link-only (no nav, footer or sitemap entry) — shared with Assistant GMs directly.
export const metadata = {
  title: 'Assistant GM Rulebook Test — Beluga League',
  robots: { index: false, follow: false },
}

export default function AGMTestPage() {
  return <CertTest test="agm" />
}
