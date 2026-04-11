import Link from 'next/link'

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
}

export const themeColor = '#1e40af'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <h1 className="text-4xl font-bold mb-4">404 - Not Found</h1>
      <p className="mb-6 text-blue-300">The resource you&apos;re looking for doesn&apos;t exist.</p>
      <Link 
        href="/"
        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
      >
        Return Home
      </Link>
    </div>
  )
}
