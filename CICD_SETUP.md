# CI/CD Setup Instructions for CV Optimizer

This guide will help you set up CI/CD for your CV Optimizer application using GitHub Actions to deploy to Google Cloud Run.

## Prerequisites

1. GitHub repository with your code
2. Google Cloud Project (vaulted-bivouac-417511)
3. Google Cloud CLI installed locally
4. Appropriate permissions in Google Cloud

## Setup Steps

### 1. Enable Required Google Cloud APIs

```bash
gcloud config set project vaulted-bivouac-417511

# Enable required APIs
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com
```

### 2. Set up Workload Identity Federation

This allows GitHub Actions to authenticate with Google Cloud without using service account keys.

```bash
# Create a Workload Identity Pool
gcloud iam workload-identity-pools create "github-pool" \
  --location="global" \
  --display-name="GitHub Actions Pool"

# Create a Workload Identity Provider
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Get the Workload Identity Provider resource name
export WORKLOAD_IDENTITY_PROVIDER=$(gcloud iam workload-identity-pools providers describe "github-provider" \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --format="value(name)")

# Grant the service account permissions to be impersonated
gcloud iam service-accounts add-iam-policy-binding \
  "cv-opt@vaulted-bivouac-417511.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${WORKLOAD_IDENTITY_PROVIDER}/attribute.repository/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME"
```

Replace `YOUR_GITHUB_USERNAME/YOUR_REPO_NAME` with your actual GitHub repository path.

### 3. Set up GitHub Secrets

In your GitHub repository, go to Settings > Secrets and variables > Actions, and add:

1. **WIF_PROVIDER**: The full Workload Identity Provider resource name
   ```
   projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider
   ```
   (Get PROJECT_NUMBER with: `gcloud projects describe vaulted-bivouac-417511 --format="value(projectNumber)"`)

2. **WIF_SERVICE_ACCOUNT**: `cv-opt@vaulted-bivouac-417511.iam.gserviceaccount.com`

### 4. Ensure Artifact Registry Repository Exists

```bash
# Create the repository if it doesn't exist
gcloud artifacts repositories create cv-opt-repo \
  --repository-format=docker \
  --location=us-east1 \
  --description="CV Optimizer Docker images"

# Grant the service account access to push images
gcloud artifacts repositories add-iam-policy-binding cv-opt-repo \
  --location=us-east1 \
  --member="serviceAccount:cv-opt@vaulted-bivouac-417511.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"
```

### 5. Verify Service Account Permissions

Ensure your service account has the necessary roles:

```bash
# Add required roles
gcloud projects add-iam-policy-binding vaulted-bivouac-417511 \
  --member="serviceAccount:cv-opt@vaulted-bivouac-417511.iam.gserviceaccount.com" \
  --role="roles/run.developer"

gcloud projects add-iam-policy-binding vaulted-bivouac-417511 \
  --member="serviceAccount:cv-opt@vaulted-bivouac-417511.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding vaulted-bivouac-417511 \
  --member="serviceAccount:cv-opt@vaulted-bivouac-417511.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 6. (Optional) Set up Cloud Build Trigger

If you prefer using Cloud Build instead of GitHub Actions:

```bash
# Connect your GitHub repository to Cloud Build
# This requires going through the Cloud Console UI

# Create a trigger
gcloud builds triggers create github \
  --repo-name=YOUR_REPO_NAME \
  --repo-owner=YOUR_GITHUB_USERNAME \
  --branch-pattern="^main$" \
  --build-config="cloudbuild.yaml"
```

### 7. Update Your Code

1. Add all the CI/CD files to your repository:
   - `.github/workflows/deploy.yml`
   - `.github/workflows/test.yml`
   - `cloudbuild.yaml` (optional)
   - Updated `Dockerfile`
   - `.dockerignore`
   - `healthcheck.js`

2. Commit and push to your repository:
   ```bash
   git add .
   git commit -m "Add CI/CD configuration"
   git push origin main
   ```

### 8. Monitor Your First Deployment

1. Go to your GitHub repository
2. Click on the "Actions" tab
3. Watch your workflow run
4. Check Cloud Run for your deployed service

## Troubleshooting

### Common Issues

1. **Authentication errors**: Ensure Workload Identity Federation is set up correctly
2. **Permission denied**: Check service account roles
3. **Build failures**: Check Docker build logs in GitHub Actions
4. **Deployment failures**: Check Cloud Run logs

### Useful Commands

```bash
# View Cloud Run service
gcloud run services describe cv-opt --region=us-east1

# View recent deployments
gcloud run revisions list --service=cv-opt --region=us-east1

# Stream logs
gcloud run services logs read cv-opt --region=us-east1 --limit=50

# Check Artifact Registry images
gcloud artifacts docker images list us-east1-docker.pkg.dev/vaulted-bivouac-417511/cv-opt-repo
```

## Environment-Specific Deployments

To deploy to different environments:

1. Create separate Cloud Run services (e.g., `cv-opt-staging`)
2. Use GitHub environments with different secrets
3. Modify the workflow to deploy based on branch:
   - `main` → production
   - `develop` → staging

## Rollback

To rollback to a previous version:

```bash
# List revisions
gcloud run revisions list --service=cv-opt --region=us-east1

# Update traffic to a previous revision
gcloud run services update-traffic cv-opt \
  --region=us-east1 \
  --to-revisions=cv-opt-00002-abc=100
```