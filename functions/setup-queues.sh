#!/bin/bash

# Set your GCP project
PROJECT_ID=$(gcloud config get-value project)
LOCATION="us-central1"  # Change to your preferred location

# Create the Cloud Tasks queues
echo "Creating Cloud Tasks queues for the ticket reservation system..."

# Ticket reservations queue
gcloud tasks queues create ticket-reservations \
  --location=${LOCATION} \
  --max-dispatches-per-second=5 \
  --max-concurrent-dispatches=10 \
  --log-sampling-ratio=1.0

# Ticket expiration queue
gcloud tasks queues create ticket-expirations \
  --location=${LOCATION} \
  --max-dispatches-per-second=5 \
  --max-concurrent-dispatches=10 \
  --log-sampling-ratio=1.0

# Waitlist notifications queue
gcloud tasks queues create waitlist-notifications \
  --location=${LOCATION} \
  --max-dispatches-per-second=5 \
  --max-concurrent-dispatches=10 \
  --log-sampling-ratio=1.0

echo "Cloud Tasks queues created successfully!"
echo "Make sure to deploy the Cloud Functions to handle tasks from these queues."
