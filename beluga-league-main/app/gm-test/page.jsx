import CertTest from '../components/cert/CertTest'

// Link-only (no nav, footer or sitemap entry) — shared with GMs directly.
export const metadata = {
  title: 'GM Rulebook Test — Beluga League',
  robots: { index: false, follow: false },
}

export default function GMTestPage() {
  return <CertTest test="gm" />
}
