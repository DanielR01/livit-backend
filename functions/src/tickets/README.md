# Ticket Reservation System

This module implements a robust ticket reservation system for events with the following features:

1. Ticket inventory management with concurrency control
2. Transaction-based reservations to prevent overselling
3. Time-limited reservations (10 minutes)
4. Waitlist for sold-out events
5. Notification system for reservation status

## Architecture

The system uses a combination of Firebase Cloud Functions, Cloud Firestore, and Cloud Tasks to ensure reliable operation:

- **Cloud Functions** handle the API endpoints for ticket reservations, purchases, and waitlist management.
- **Cloud Firestore** stores ticket inventory, reservations, and waitlist data with transactions for data consistency.
- **Cloud Tasks** manages reservation expirations and waitlist notifications in a reliable way.

## Database Collections

- `ticketInventory`: Tracks available, reserved, and sold quantities for each ticket type
- `ticketReservations`: Stores active ticket reservations with expiration timestamps
- `ticketWaitlist`: Manages waitlist entries for sold-out ticket types
- `tickets`: Contains actual tickets after successful purchase

## Flow

### Reservation Process

1. User selects tickets in the app
2. Front-end calls `requestTicketReservation` function
3. Request is queued in Cloud Tasks to be processed one at a time
4. Cloud Function processes the reservation using Firestore transaction
5. If tickets are available:
   - Inventory is updated
   - Reservation is created with 10-minute expiration
   - User is notified
   - Task is scheduled to expire the reservation
6. If tickets are not available:
   - User is added to the waitlist
   - User is notified

### Purchase Process

1. User completes payment through PayU within the 10-minute window
2. Front-end calls `completeTicketPurchase` function
3. Reservation is marked as completed
4. Inventory is updated (reserved → sold)
5. Tickets are created in the `tickets` collection

### Reservation Expiration

1. Cloud Task triggers at reservation expiration time
2. `processReservationExpiry` function is executed
3. If reservation is still pending:
   - Reservation is marked as expired
   - Inventory is updated (reserved → available)
   - Waitlist is processed to notify next users

### Waitlist Process

1. When tickets become available (e.g., from expired reservations)
2. System checks the waitlist for the ticket type
3. First users in the waitlist are notified
4. Notified users have 30 minutes to claim their tickets
5. If not claimed within 30 minutes, next users in waitlist are notified

## Setup

1. Deploy Cloud Functions:
   ```
   firebase deploy --only functions
   ```

2. Create Cloud Tasks queues:
   ```
   ./setup-queues.sh
   ```

## Front-end Integration

The front-end needs to:

1. Call `requestTicketReservation` with eventId and tickets info
2. Listen for FCM notifications about reservation status
3. Direct user to payment with `reservationId` when reservation is successful
4. Call `completeTicketPurchase` after successful payment
5. Display waitlist status if added to waitlist

## Troubleshooting

- Check Cloud Functions logs for errors
- Verify Cloud Tasks queues are properly set up
- Ensure Firebase project permissions are correctly configured 