import { NextResponse } from 'next/server';
import { getStandings } from '../../../lib/sheets';

// Tell Next.js this is a dynamic route that shouldn't be prerendered
export const dynamic = 'force-dynamic';

export async function GET(request) {
  // Get the division parameter from the URL
  const url = new URL(request.url);
  const division = url.searchParams.get('division');
  
  if (!division || !['majors', 'aaa', 'aa'].includes(division)) {
    console.log(`Invalid division parameter: ${division}`);
    return NextResponse.json(
      { error: 'Invalid division parameter. Must be one of: majors, aaa, aa' },
      { status: 400 }
    );
  }
  
  console.log(`API: Fetching standings for ${division} division`);
  
  try {
    // Fetch the standings data from Google Sheets with enhanced error handling
    const response = await getStandings(division);
    
    // Check if data exists
    if (response.data && response.data.length > 0) {
      console.log(`API: Successfully fetched ${response.data.length} teams for ${division} (${response.fromCache ? 'from cache' : 'fresh data'})`);
      
      // Return the data with status information
      return NextResponse.json({
        data: response.data,
        fromCache: response.fromCache,
        cachedAt: response.cachedAt,
        fetchError: response.fetchError,
        timestamp: new Date().toISOString()
      });
    } 
    else {
      // Empty data with possible fetch error
      const status = response.fetchError ? 503 : 200; // Service Unavailable if there was an error
      
      return NextResponse.json({
        data: [],
        fromCache: response.fromCache,
        cachedAt: response.cachedAt,
        fetchError: response.fetchError || "No data available",
        timestamp: new Date().toISOString()
      }, { status });
    }
  } catch (error) {
    console.error('API Error in standings endpoint:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return NextResponse.json(
      { 
        error: errorMessage,
        data: [],
        fromCache: false,
        cachedAt: null,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
