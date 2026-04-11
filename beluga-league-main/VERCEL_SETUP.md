# Vercel Deployment Setup Guide

## Environment Variables Required

You need to add the following environment variables to your Vercel project:

### 1. Google Sheets IDs
```
SHEET_ID_MAJORS=1YJLb2ise0BM2wIv5ZsZQSFsm6LA_F6jJC3i32fYh7II
SHEET_ID_AAA=10l6mfJOcKGuhp3_LYVC1Y9MigdaeQTULEdTdGNELTOc
SHEET_ID_AA=1GFziMfAJK8GblQoL7-qvxu1mI40uV2hhBQkX7TpTdlc
SHEET_ID_PLAYERS=1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs
```

### 2. Google Service Account Credentials
```
GOOGLE_CLIENT_EMAIL=beluga-league@beluga-league-468319.iam.gserviceaccount.com

GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC64gurmiJ5i2Xn
J7i7VWSyGSzYGkC8LcH5lYAbCoCBsvjqXKXWa2hcyNHNt8FmW5u8F2PvWm8I0oMZ
WTxYrgk9XunkFzvNvi7BTv5Zzu6kD9Bm4krMTurZPBXFDiPdvvkPi3cQxuHFVBTt
VanMMwk+/xX8bS36ltkOkYY4X0rnlXX7eI5dUDxa0Hz/FJk9iKWG5qDg5HyIurlb
9zsUvP+Ds03iSfW0id5Qt2h6bwfqz31Ei8RjBQaqmBb5BMfOaW50unaNGg91bahW
ODnuwdW0m5ClFS9QItSeS0rGyX5TgqGWAou6R41pvZfoozKStp08bBthj3kkyo78
/gzaPTybAgMBAAECggEAL4o0PM2Dapbu78wXfrQ83t9vnHOlNxmOyC5jPb3Arf24
u2mhGDgPftbpJCNUE/VG2yS6G9fN+hkPF4IvS0HOgOmlpwvP/0kbfLpbEr6Ez4Bk
W9/B9lI3BNb3lL7BmfWsRuuL+N0W7ssyXaOWg6cR+ZALaEDf2ujHw6B6W9nF5L4d
0kAhlEsBGyO2dwBVrBPTP4USKDV8aGvL6GWuFwLjijiT47rNHaZ5HAhAAgQO+jkj
Zj2bhh3xwaIPEEYjEIGAUuOuulc8ko3/mK/kFxVCtD75H+R4nYwq/SMlhq4XbvvC
MB3IEQ0EckiS+pdKkY5qFPaeg8JUIZnTOXqyoXAJ4QKBgQDax16zrU3QgBpRPV21
V3HVYfV9XTGp5kbeeFeCKYitJaoURyY3aEZlifCG2+HuU5mUnl+8QacJ2GrbHupL
cS/1S2WeV6CH4bTVdqEa6U6zv5JLtJqpXpjp6Gyu/WjKLjk17uzdJ2BK4tVlEa3U
/pG3rOg0/STkCS0RFZeA87MkoQKBgQDarX64QvX0Q1zI4Qj+YXqI37jP1nhsgZqZ
hnnPR/ug1xT+TFT/puASQ0Q2cm0NlAup7mWOqCaj9Q9FqLeJgZ27dfCttFHcIL0R
NNY6bHUAabJ/QQ4soqcnOsj8RKhvdYokOm/es2EJfeqBbUUO8f1kd+khulsm3SJX
z08U3rSbuwKBgGnkgBEFvBlEN/jEdBv29FEs9e608fnjTMAXjXuh8Nal2VmxSm0d
Gp3BE1ujCAscCcUmlv3+5QPd7XKb1xmm8miPEuN+VGQQuj9sCPSGoqJcAkqEYyvB
btAgwKI+Y78gem6Bc8Jjcbctbc5arUHf6dX2afpj4LxDOL4BLnCrBDWhAoGBAJoe
ftoEr23I8CLPn1QRhZfj/U/V+yeWLEyZn038kJaqH6yeRaWsie21JOUuvjc8qP/J
+h+R2THi7DGPGFO8W1ucYtU56hu3oyj2USn5+HgjBl9zjTbeJ+qZHr/U79UmRQcF
fIS7bd+Ps/Al/+7plEnzzQYtXkLExYiXnke6MhYzAoGBAJcYfKTKrNXPFyUCeo/1
bSzFkpbSo2YRN9fx3RMyn0hkwVvwhGCC6SUm74+11DODG+8H2+h1YYKfgCu8Q0cl
dxVTn5x1v/7GlYD7Yot0ZtI9rr+XY/5vTGFuONyRSJl7jfxgjQZKKxhDy+IVTXNb
yCEaKb6Me6RfYmidw/x4BQnu
-----END PRIVATE KEY-----
```

## Steps to Add Environment Variables on Vercel

1. **Go to your Vercel Dashboard**
   - Visit https://vercel.com/dashboard
   - Select your project (beluga-league)

2. **Navigate to Settings**
   - Click on the "Settings" tab at the top

3. **Go to Environment Variables**
   - Click on "Environment Variables" in the left sidebar

4. **Add Each Variable**
   For each variable above:
   - Click "Add New" button
   - Enter the **Key** (variable name like `SHEET_ID_MAJORS`)
   - Enter the **Value** (the value from above)
   - Select which environments (Production, Preview, Development) - **Select all three**
   - Click "Save"

5. **Important for GOOGLE_PRIVATE_KEY**
   - When pasting the private key, make sure to include the full key including:
     - `-----BEGIN PRIVATE KEY-----`
     - All the key content
     - `-----END PRIVATE KEY-----`
   - Vercel will handle the newline characters (`\n`) automatically

6. **Redeploy Your Application**
   - After adding all environment variables, go to the "Deployments" tab
   - Click on the three dots (...) next to your latest deployment
   - Click "Redeploy"
   - This will rebuild your app with the new environment variables

## Troubleshooting

### If you still see "Failed to fetch player data":

1. **Check Vercel Function Logs**
   - Go to your deployment
   - Click on "Functions" tab
   - Look for `/api/players` function
   - Check the logs for specific errors

2. **Verify Google Sheets API Access**
   - Make sure the service account email (`beluga-league@beluga-league-468319.iam.gserviceaccount.com`) has access to all your Google Sheets
   - Go to each sheet, click "Share", and make sure this email is added with "Viewer" or "Editor" permissions

3. **Check the API Route**
   - Visit your deployed site at `/api/players` (e.g., `https://your-site.vercel.app/api/players`)
   - You should see JSON data or an error message

4. **Environment Variable Formatting**
   - Make sure there are no extra spaces or quotes around the values
   - The private key should be the full key including BEGIN/END markers

## Testing Locally vs Production

- **Local**: Uses `credentials.json` file directly
- **Production (Vercel)**: Uses environment variables (`GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY`)

Your code already handles both scenarios correctly in `/app/api/players/route.js`.

## After Setup

Once all environment variables are added and you've redeployed:
- The player directory page should load correctly
- The API should return player data from Google Sheets
- All features should work as they do locally
