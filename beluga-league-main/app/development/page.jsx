import Link from 'next/link';

export default function DevelopmentPage() {
  return (
    <div className="min-h-[calc(100vh-140px)] flex flex-col items-center justify-center p-8">
      <div className="bg-black/40 backdrop-blur-md p-12 rounded-2xl border border-white/10 shadow-xl max-w-2xl w-full text-center">
        <h1 className="text-4xl md:text-6xl font-bold mb-6 text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-purple-400 to-blue-200">
          Under Development
        </h1>
        
        <div className="w-24 h-24 mx-auto mb-6 relative">
          <div className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping"></div>
          <div className="absolute inset-4 rounded-full bg-blue-500/40"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
        </div>
        
        <p className="text-xl md:text-2xl mb-8 text-blue-100">
          This feature is currently being developed by our team.
        </p>
        
        <p className="text-lg text-blue-200 mb-10">
          Please check back soon for updates!
        </p>
        
        <Link
          href="/"
          className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full font-medium text-white hover:from-blue-600 hover:to-purple-700 transition shadow-lg inline-block"
        >
          Return to Home
        </Link>
      </div>
    </div>
  );
}
