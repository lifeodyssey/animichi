# Deployment Guide - Seichijunrei Bot

This guide explains how to deploy the Seichijunrei Bot to Google Vertex AI Agent Engine using the existing GitHub Actions workflow.

---

## Overview

The project includes a pre-configured GitHub Actions workflow (`.github/workflows/deploy.yml`) that automatically deploys the agent to Google Cloud's Vertex AI Agent Engine.

**Deployment Features:**
- ✅ Automated deployment via GitHub Actions
- ✅ Support for staging and production environments
- ✅ Built-in health checks and smoke tests
- ✅ Easy rollback and cleanup

---

## Prerequisites

Before deploying, ensure you have:

1. **Google Cloud Project**
   - Active GCP project with billing enabled
   - Project ID ready (e.g., `my-seichijunrei-project`)

2. **Required APIs Enabled**
   - Vertex AI API
   - Cloud Storage API
   - Agent Engine API (part of Vertex AI)

3. **GitHub Repository**
   - Admin access to set repository secrets
   - Actions enabled

---

## Step 1: Set Up Google Cloud Project

### 1.1 Create or Select a GCP Project

```bash
# Create a new project (optional)
gcloud projects create YOUR_PROJECT_ID --name="Seichijunrei Bot"

# Set the project as default
gcloud config set project YOUR_PROJECT_ID
```

### 1.2 Enable Required APIs

```bash
# Enable Vertex AI and related APIs
gcloud services enable aiplatform.googleapis.com
gcloud services enable storage.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
```

### 1.3 Create a Cloud Storage Bucket for Staging

```bash
# Create staging bucket (must be globally unique)
gsutil mb -l us-central1 gs://YOUR_PROJECT_ID-agent-staging
```

---

## Step 2: Create Service Account

### 2.1 Create Service Account

```bash
# Create service account for deployment
gcloud iam service-accounts create agent-deployer \
    --display-name="Agent Deployer" \
    --description="Service account for deploying ADK agents"
```

### 2.2 Grant Required Permissions

```bash
# Set project ID variable
export PROJECT_ID=YOUR_PROJECT_ID

# Grant necessary roles
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:agent-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:agent-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/storage.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:agent-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountUser"
```

### 2.3 Create and Download Service Account Key

```bash
# Create key file
gcloud iam service-accounts keys create agent-deployer-key.json \
    --iam-account=agent-deployer@$PROJECT_ID.iam.gserviceaccount.com

# Display the key content (copy this for GitHub Secrets)
cat agent-deployer-key.json
```

**⚠️ IMPORTANT:** Keep this key file secure and never commit it to Git!

---

## Step 3: Configure GitHub Secrets

Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions**

Click **New repository secret** and add the following:

### Required Secrets:

| Secret Name | Value | Description |
|------------|-------|-------------|
| `GCP_PROJECT_ID` | `your-project-id` | Your GCP project ID |
| `GCP_SA_KEY` | `{...json content...}` | Entire content of `agent-deployer-key.json` |

### Optional Secrets (for future features):

| Secret Name | Value | Description |
|------------|-------|-------------|
| `GOOGLE_MAPS_API_KEY` | `your-maps-key` | For future Maps integration |
| `WEATHER_API_KEY` | `your-weather-key` | For future weather features |

**How to add GCP_SA_KEY:**
1. Open `agent-deployer-key.json` in a text editor
2. Copy the **entire JSON content** (including `{` and `}`)
3. Paste it as the secret value in GitHub

---

## Step 4: Deploy Using GitHub Actions

### 4.1 Trigger Deployment Manually

1. Go to your GitHub repository
2. Click **Actions** tab
3. Select **"Deploy to Agent Engine"** workflow from the left sidebar
4. Click **"Run workflow"** button
5. Select environment:
   - **staging** - for testing
   - **production** - for final deployment
6. Click **"Run workflow"**

### 4.2 Monitor Deployment

The workflow will:
1. ✅ Install dependencies with `uv`
2. ✅ Authenticate to Google Cloud
3. ✅ Deploy agent to Vertex AI Agent Engine
4. ✅ Run smoke tests
5. ✅ Report success/failure

Check the workflow logs for deployment details and any errors.

---

## Step 5: Verify Deployment

### 5.1 Check Agent Engine Console

Visit the [Vertex AI Agent Engine Console](https://console.cloud.google.com/vertex-ai/agent-engine):

```
https://console.cloud.google.com/vertex-ai/agent-engine?project=YOUR_PROJECT_ID
```

You should see your deployed agent: `seichijunrei-bot-staging` or `seichijunrei-bot-production`

### 5.2 Test the Deployed Agent (CLI)

```bash
# Install ADK CLI locally
pip install google-adk

# Authenticate
gcloud auth application-default login

# Test the agent
adk chat \
  --project=YOUR_PROJECT_ID \
  --region=us-central1 \
  --agent=seichijunrei-bot-staging
```

### 5.3 Test via Web Interface

You can also test through the Vertex AI console's built-in chat interface.

---

## Step 6: Clean Up / Delete Deployment

### Option A: Via GitHub Actions (Recommended)

Add a cleanup step to the workflow or create a separate cleanup workflow.

### Option B: Via Cloud Console

1. Go to [Vertex AI Agent Engine Console](https://console.cloud.google.com/vertex-ai/agent-engine)
2. Find your agent (`seichijunrei-bot-staging` or `seichijunrei-bot-production`)
3. Click the three-dot menu → **Delete**
4. Confirm deletion

### Option C: Via CLI

```bash
# List deployed agents
gcloud ai agents list --region=us-central1

# Delete a specific agent
gcloud ai agents delete AGENT_ID --region=us-central1
```

**Note:** Deleting the agent will stop all costs associated with it.

---
