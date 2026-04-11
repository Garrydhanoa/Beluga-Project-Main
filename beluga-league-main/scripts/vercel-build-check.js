// This script runs during Vercel build to help debug issues
// It doesn't contain any sensitive information, just diagnostics

console.log('------------- VERCEL BUILD ENVIRONMENT CHECK -------------');
console.log('Node.js version:', process.version);
console.log('Environment:', process.env.NODE_ENV);
console.log('Is Vercel:', !!process.env.VERCEL);

// Check for Google API credentials (safely)
console.log('Has Google client email:', !!process.env.GOOGLE_CLIENT_EMAIL);
console.log('Has Google private key:', !!process.env.GOOGLE_PRIVATE_KEY);
console.log('Has Sheet ID:', !!process.env.POWER_RANKINGS_SHEET_ID);

// Check for team-specific environment variables
console.log('Has Majors-specific Sheet ID:', !!process.env.MAJORS_SHEET_ID);
console.log('Has AA-specific Sheet ID:', !!process.env.AA_SHEET_ID);
console.log('Has AAA-specific Sheet ID:', !!process.env.AAA_SHEET_ID);

// Private key diagnostics (without revealing the key)
if (process.env.GOOGLE_PRIVATE_KEY) {
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  console.log('Private key length:', privateKey.length);
  console.log('Private key contains BEGIN marker:', privateKey.includes('-----BEGIN PRIVATE KEY-----'));
  console.log('Private key contains END marker:', privateKey.includes('-----END PRIVATE KEY-----'));
  console.log('Private key contains escaped newlines (\\n):', privateKey.includes('\\n'));
  console.log('Private key contains actual newlines:', privateKey.includes('\n'));
  
  // Check if the key is JSON stringified (common issue)
  const isJsonString = (
    privateKey.startsWith('"') && 
    privateKey.endsWith('"') &&
    privateKey.includes('\\n')
  );
  console.log('Private key appears to be JSON stringified:', isJsonString);
  
  // If it's JSON stringified, show how it would look parsed
  if (isJsonString) {
    try {
      const parsedKey = JSON.parse(privateKey);
      console.log('JSON parsed key length:', parsedKey.length);
      console.log('JSON parsed key contains BEGIN marker:', parsedKey.includes('-----BEGIN PRIVATE KEY-----'));
      console.log('JSON parsed key contains actual newlines:', parsedKey.includes('\n'));
    } catch (e) {
      console.log('Failed to parse private key as JSON:', e.message);
    }
  }
}

console.log('------------- END ENVIRONMENT CHECK -------------');
