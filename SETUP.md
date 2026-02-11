# Outage Tracker - Setup Guide

This guide will walk you through setting up the Outage Tracker application from scratch.

## Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- A Supabase account (free tier is sufficient)
- A Mapbox account (free tier is sufficient)

## Step 1: Supabase Setup

### 1.1 Create a Supabase Project

1. Go to [https://supabase.com/](https://supabase.com/)
2. Sign in or create a free account
3. Click "New Project"
4. Fill in the project details:
   - **Name:** outage-tracker (or your preferred name)
   - **Database Password:** Choose a strong password (save this!)
   - **Region:** Select the closest region to your users
   - **Pricing Plan:** Free tier is fine for development
5. Click "Create new project" and wait 2-3 minutes for setup

### 1.2 Get Your Supabase Credentials

1. Once the project is ready, navigate to: **Project Settings** (gear icon) → **API**
2. You'll see two important sections:
   - **Project URL:** Copy this value
   - **Project API keys:**
     - `anon` `public` key - Copy this
     - `service_role` `secret` key - Copy this (keep this secure!)

3. Update your [.env.local](.env.local) file:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...your-service-role-key
   ```

### 1.3 Enable PostGIS Extension

PostGIS is required for geospatial queries (finding outages near locations).

1. In your Supabase dashboard, go to **Database** → **Extensions**
2. Search for "postgis"
3. Click the toggle to enable **postgis**
4. Wait for it to activate (should take ~10 seconds)

### 1.4 Run Database Migrations

Now we'll create the database schema (tables, indexes, etc.).

1. In your Supabase dashboard, go to **SQL Editor**
2. Click "New Query"
3. Copy the entire contents of [prisma/migrations/001_initial_schema.sql](prisma/migrations/001_initial_schema.sql)
4. Paste into the SQL editor
5. Click "Run" (or press Ctrl/Cmd + Enter)
6. You should see "Success. No rows returned"

Alternatively, you can run migrations programmatically (see Section 3).

### 1.5 Verify Database Setup

1. Go to **Table Editor** in Supabase dashboard
2. You should now see these tables:
   - `users`
   - `providers`
   - `outages`
   - `outage_confirmations`
   - `outage_comments`
   - `user_preferences`
   - `push_subscriptions`

## Step 2: Mapbox Setup

### 2.1 Create a Mapbox Account

1. Go to [https://account.mapbox.com/](https://account.mapbox.com/)
2. Sign up for a free account
3. Verify your email address

### 2.2 Get Your Mapbox Token

1. After logging in, you'll land on your **Access Tokens** page
2. You'll see a **Default public token** already created
3. Copy this token (starts with `pk.`)
4. Update your [.env.local](.env.local):
   ```bash
   NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...your-mapbox-token
   ```

**Note:** The free tier includes:
- 50,000 map loads per month
- 100,000 free geocoding requests per month
- More than enough for development and small-scale deployment

### 2.3 Configure Mapbox URL Restrictions (Optional but Recommended)

For production, restrict your token to specific URLs:

1. In Mapbox dashboard, click "Create a token" (or edit existing)
2. Under **Token restrictions**, add:
   - `http://localhost:3000/*` (for development)
   - `https://your-domain.com/*` (for production)
3. Save the token

## Step 3: NextAuth Configuration

### 3.1 Generate NextAuth Secret

Run this command in your terminal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy the output and add it to [.env.local](.env.local):

```bash
NEXTAUTH_SECRET=your-generated-secret-here
```

This secret is used to encrypt session tokens.

## Step 4: Seed Initial Data (Optional but Recommended)

Seed the database with initial provider data:

```bash
npm run db:seed
```

This will populate the `providers` table with common service providers like:
- AT&T, Verizon, T-Mobile (Cellular)
- Comcast, Spectrum, AT&T Internet (Internet)
- Local power companies

You can manually add providers later via the Supabase dashboard.

## Step 5: Run the Development Server

Now everything should be set up! Start the development server:

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.

You should see:
- A blank map (Mapbox loading correctly)
- No errors in the browser console
- The app is responsive on mobile viewports

## Step 6: Web Push Notifications Setup (Optional - For Phase 7)

Web push notifications are optional and only needed for Phase 7 of development.

### 6.1 Generate VAPID Keys

Run this command:

```bash
npx web-push generate-vapid-keys
```

You'll see output like:

```
Public Key: BBg...your-public-key
Private Key: abc...your-private-key
```

### 6.2 Update Environment Variables

Add these to [.env.local](.env.local):

```bash
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BBg...your-public-key
VAPID_PRIVATE_KEY=abc...your-private-key
VAPID_SUBJECT=mailto:youremail@example.com
```

**Note:** Keep the private key secure! Never commit it to version control.

## Troubleshooting

### Issue: "Failed to connect to Supabase"

**Solution:**
1. Double-check your `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`
2. Make sure there are no extra spaces or quotes around the values
3. Restart your Next.js dev server after changing `.env.local`

### Issue: "Map is not loading"

**Solution:**
1. Check your `NEXT_PUBLIC_MAPBOX_TOKEN` in `.env.local`
2. Make sure the token starts with `pk.` (public token)
3. Verify your Mapbox token is active in your dashboard
4. Check browser console for errors

### Issue: "PostGIS function not found"

**Solution:**
1. Ensure PostGIS extension is enabled in Supabase (Database → Extensions)
2. Run the database migration again
3. Check that you're using the correct Supabase project

### Issue: "Module not found" errors

**Solution:**
```bash
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

## Next Steps

Once setup is complete, you're ready to start development:

1. **Phase 1:** Build the core map component ([components/map/MapContainer.tsx](components/map/MapContainer.tsx))
2. **Add test data:** Manually add a few outages in Supabase Table Editor to test the map
3. **Follow the implementation plan:** See [C:\Users\Tigre\.claude\plans\jolly-hugging-parrot.md](C:\Users\Tigre\.claude\plans\jolly-hugging-parrot.md)

## Database Schema Reference

For detailed database schema information, see:
- [prisma/schema.prisma](prisma/schema.prisma) - Prisma schema definition
- [prisma/migrations/001_initial_schema.sql](prisma/migrations/001_initial_schema.sql) - Raw SQL migration

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Yes | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Yes | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Yes | Supabase service role key (server-side only) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | ✅ Yes | Mapbox public token for maps |
| `NEXTAUTH_SECRET` | ✅ Yes | Secret for NextAuth session encryption |
| `NEXTAUTH_URL` | ✅ Yes | Your app URL (localhost for dev) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Phase 7 | Public VAPID key for push notifications |
| `VAPID_PRIVATE_KEY` | Phase 7 | Private VAPID key (server-side only) |
| `VAPID_SUBJECT` | Phase 7 | Contact email for push service |

## Support

If you encounter issues not covered here:

1. Check the [implementation plan](C:\Users\Tigre\.claude\plans\jolly-hugging-parrot.md)
2. Review Supabase docs: [https://supabase.com/docs](https://supabase.com/docs)
3. Review Mapbox docs: [https://docs.mapbox.com/](https://docs.mapbox.com/)
4. Check Next.js docs: [https://nextjs.org/docs](https://nextjs.org/docs)

Happy coding! 🚀
