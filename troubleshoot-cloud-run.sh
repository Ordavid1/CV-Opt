#!/bin/bash

# Fix for the timeout command in MacOS
check_timeout_command() {
  if ! command -v timeout &> /dev/null; then
    echo "The 'timeout' command is not installed. Installing via brew..."
    if command -v brew &> /dev/null; then
      brew install coreutils
      echo "Now use 'gtimeout' instead of 'timeout' in your scripts or create an alias"
    else
      echo "Homebrew not found. Please install homebrew or manually install the timeout command."
    fi
  fi
}

# View the latest logs to identify startup issues
view_cloud_run_logs() {
  echo "Fetching recent logs for cv-opt service..."
  gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=cv-opt" --limit=50 --format=json | jq .
}

# Check if the service is healthy
check_service_health() {
  SERVICE_URL="https://cv-opt-kn4i5ubmxq-ue.a.run.app"
  echo "Checking service health at $SERVICE_URL..."
  curl -v $SERVICE_URL
  
  ALTERNATE_URL="https://cv-opt-141501016926.us-east1.run.app"
  echo "Checking alternate service URL at $ALTERNATE_URL..."
  curl -v $ALTERNATE_URL
}

# Main execution
echo "=== Cloud Run Service Troubleshooting ==="
check_timeout_command
view_cloud_run_logs
check_service_health