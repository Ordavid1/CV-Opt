#!/bin/bash

# Exit on any error
set -e

# Configuration
PROJECT_ID="vaulted-bivouac-417511"
REGION="us-east1"
SERVICE_NAME="cv-opt"
IMAGE_NAME="us-east1-docker.pkg.dev/${PROJECT_ID}/cv-opt-repo/${SERVICE_NAME}:v1"
SERVICE_ACCOUNT="${SERVICE_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper function for logging
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%dT%H:%M:%S%z')] $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%dT%H:%M:%S%z')] ERROR: $1${NC}"
    exit 1
}

# Verify gcloud configuration
log "Verifying gcloud configuration..."
CURRENT_PROJECT=$(gcloud config get-value project)
if [ "$CURRENT_PROJECT" != "$PROJECT_ID" ]; then
    error "Wrong project configured. Expected $PROJECT_ID, got $CURRENT_PROJECT"
fi

# Configure Docker authentication
log "Configuring Docker authentication..."
gcloud auth configure-docker us-east1-docker.pkg.dev --quiet

# Build Docker image
log "Building Docker image..."
docker build --platform linux/amd64 -t $IMAGE_NAME . || error "Docker build failed"

# Push to Container Registry
log "Pushing image to Container Registry..."
docker push $IMAGE_NAME || error "Docker push failed"

# Deploy to Cloud Run using service.yaml
log "Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
    --image $IMAGE_NAME \
    --region $REGION \
    --platform managed \
    --service-account $SERVICE_ACCOUNT \
    --set-secrets=OPENAI_API_KEY=OPENAI_API_KEY:latest,APP_URL=APP_URL:latest,LEMON_SQUEEZY_STORE_ID=LEMON_SQUEEZY_STORE_ID:latest,LEMON_SQUEEZY_VARIANT_ID_BUNDLE=LEMON_SQUEEZY_VARIANT_ID_BUNDLE:latest,LEMON_SQUEEZY_VARIANT_ID=LEMON_SQUEEZY_VARIANT_ID:latest,LEMON_API_KEY=LEMON_API_KEY:latest,LEMON_SQUEEZY_WEBHOOK_SECRET=LEMON_SQUEEZY_WEBHOOK_SECRET:latest,ADMIN_API_KEY=ADMIN_API_KEY:latest \
    --set-env-vars="NODE_ENV=production,DATA_STORAGE_TYPE=memory,STORAGE_BUCKET=cv-opt-user-data" \
    --timeout=300 \
    --min-instances=1 \
    --max-instances=10 \
    --cpu=1 \
    --memory=512Mi \
    --allow-unauthenticated

# Verify deployment
log "Verifying deployment..."
gcloud run services describe $SERVICE_NAME --region $REGION || error "Service verification failed"

# Get the latest revision name and verify it's active
LATEST_REVISION=$(gcloud run services describe $SERVICE_NAME --region $REGION --format='value(status.latestCreatedRevisionName)')
log "Latest revision: ${LATEST_REVISION}"

TRAFFIC_REVISION=$(gcloud run services describe $SERVICE_NAME --region $REGION --format='value(status.traffic[0].revisionName)')
log "Current traffic is routed to: ${TRAFFIC_REVISION}"

# Ensure traffic is assigned to latest revision
if [ "$LATEST_REVISION" != "$TRAFFIC_REVISION" ]; then
    log "Updating traffic to latest revision..."
    gcloud run services update-traffic $SERVICE_NAME \
        --region $REGION \
        --to-revisions=$LATEST_REVISION=100 || error "Traffic update failed"
fi
    
# Display service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format='value(status.url)')
log "Deployment completed successfully!"
log "Service URL: ${SERVICE_URL}"

# Show logs without the --follow flag
log "Showing recent logs..."
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME" --limit=20 || true

log "Deployment process completed!"