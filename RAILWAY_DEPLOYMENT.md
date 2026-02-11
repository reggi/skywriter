# Railway Deployment Guide

This guide will help you deploy your Quandoc application to Railway.

## Prerequisites

1. A Railway account ([sign up at railway.app](https://railway.app))
2. Railway CLI installed (optional, but recommended)
3. Git repository pushed to GitHub/GitLab/Bitbucket

## Step-by-Step Deployment

### 1. Create a New Project on Railway

1. Go to [railway.app/new](https://railway.app/new)
2. Click "New Project"
3. Choose "Deploy from GitHub repo" (or your preferred Git provider)
4. Select your repository

### 2. Add PostgreSQL Database

1. In your Railway project, click "+ New"
2. Select "Database" → "Add PostgreSQL"
3. Railway will automatically create a PostgreSQL database and set the `DATABASE_URL` environment variable

### 3. Set Up Persistent Storage

**Railway only allows one mounted volume per service.** This application needs storage for both uploads and git repositories.

1. In your Railway service, go to "Settings" → "Volumes"
2. Click "New Volume"
3. Set mount path to `/volume`
4. Create the volume

### 4. Configure Environment Variables

Railway will automatically set `DATABASE_URL` from the PostgreSQL service. Add these required variables:

1. Go to your service settings
2. Click on "Variables" tab
3. Add the following variables:
   - `GIT_REPOS_PATH=/volume/.git-repos` - Git repositories storage
   - `UPLOADS_PATH=/volume/uploads` - Uploaded files storage
   - `PORT` - Railway injects this automatically

**Note:** Since Railway only provides one volume, we use subdirectories within `/volume` for different storage needs.

### 5. Deploy

Railway will automatically deploy your application when you push to your repository. The deployment process will:

1. Install dependencies (`npm ci`)
2. Build the editor bundle (`npm run build`)
3. Run migrations (`npm run migrate:up`)
4. Start the server (`npm start`)

## Configuration Files

The following files have been created for Railway deployment:

- **`railway.json`** - Railway-specific configuration
- **`nixpacks.toml`** - Build configuration for Nixpacks (Railway's build system)

All required code changes have been applied. The application is ready to deploy.

## Monitoring and Logs

- View logs in the Railway dashboard under your service's "Deployments" tab
- Set up health checks if needed
- Monitor database performance in the PostgreSQL service metrics

## Custom Domain (Optional)

1. Go to your service settings
2. Click on "Networking" → "Generate Domain" for a Railway subdomain
3. Or add your custom domain under "Custom Domain"

## Troubleshooting

### Migrations Failing

If migrations fail during deployment:

- Check the Railway logs for specific error messages
- Ensure `DATABASE_URL` is properly set
- Verify migration files are included in your Git repository

### Connection Issues

If the app can't connect to the database:

- Verify `DATABASE_URL` environment variable is set
- Check that the PostgreSQL service is running
- Review network policies in Railway settings

### Build Failures

If the build process fails:

- Check that all dependencies are in `package.json`
- Verify Node.js version compatibility
- Review build logs for specific errors

## Local Testing with Production-like Setup

To test locally with environment variables like Railway:

```bash
# Create a .env file
echo "DATABASE_URL=postgresql://astrodoc:astrodoc_password@localhost:5455/astrodoc" > .env
echo "PORT=3000" >> .env

# Start the database
npm run db:up

# Run migrations
npm run migrate:up

# Start the server
npm start
```

## Railway CLI (Optional)

Install and use the Railway CLI for easier management:

```bash
# Install
npm i -g @railway/cli

# Login
railway login

# Link project
railway link

# View logs
railway logs

# Run commands in Railway environment
railway run npm run migrate:up
```
