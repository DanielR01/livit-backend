import * as functions from "firebase-functions";
import { CloudTasksClient, protos } from "@google-cloud/tasks";
import { google } from "@google-cloud/tasks/build/protos/protos";
import admin from '../firebase-admin';
import { ErrorCode } from "../errors";
import { TicketInventory, TicketPurchaseRequest, TicketReservation, TicketReservationResult, TicketWaitlist } from "./ticket_interface";

const db = admin.firestore();
const tasksClient = new CloudTasksClient();

// Helper to ensure project ID is set
function getProjectId(): string {
  const projectId = process.env.GCLOUD_PROJECT;
  if (!projectId) {
    throw new Error("GCLOUD_PROJECT environment variable not set.");
  }
  return projectId;
}

// Cloud function to handle ticket reservation requests
export const requestTicketReservation = functions.https.onCall(async (request: functions.https.CallableRequest<TicketPurchaseRequest>) => {
  // Validate user
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  const userId = request.auth.uid;

  // Validate request data
  if (!request.data.eventId || !request.data.tickets || request.data.tickets.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', ErrorCode.MISSING_PARAMS);
  }

  // Create a task for processing this reservation
  const project = getProjectId();
  const location = 'us-central1'; // Change to your Cloud Tasks location
  const queue = 'ticket-reservations';

  const parent = tasksClient.queuePath(project, location, queue);

  const taskPayload = {
    userId,
    eventId: request.data.eventId,
    tickets: request.data.tickets,
    timestamp: admin.firestore.Timestamp.now().toMillis(),
  };

  const task: google.cloud.tasks.v2.ITask = {
    httpRequest: {
      httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
      url: `https://${location}-${project}.cloudfunctions.net/processTicketReservation`,
      oidcToken: {
        serviceAccountEmail: `${project}@appspot.gserviceaccount.com`,
      },
      body: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      headers: {
        'Content-Type': 'application/json',
      },
    },
  };

  try {
    // Send the task to Cloud Tasks
    const [response] = await tasksClient.createTask({ parent, task });
    console.log(`Created task ${response.name}`);

    return {
      success: true,
      message: 'Reservation request queued for processing'
    };
  } catch (error) {
    console.error('Error creating task:', error);
    throw new functions.https.HttpsError('internal', 'Failed to process reservation request');
  }
});

// Cloud function to process ticket reservation from Cloud Tasks
export const processTicketReservation = functions.https.onRequest(async (req, res) => {
  try {
    const requestBody = req.body as TicketPurchaseRequest & { timestamp: number }; // Assume body is parsed
    
    // Process the reservation using a Firestore transaction
    const result = await processReservationTransaction(requestBody);
    
    // Send notification to user about the reservation result
    await sendReservationNotification(requestBody.userId, result);
    
    res.status(200).send({ success: true, result });
  } catch (error) {
    console.error('Error processing reservation:', error);
    res.status(500).send({ success: false, error: 'Failed to process reservation' });
  }
});

// Function to handle the actual reservation logic in a transaction
async function processReservationTransaction(requestData: TicketPurchaseRequest & { timestamp: number }): Promise<TicketReservationResult> {
  const { userId, eventId, tickets, timestamp } = requestData;
  
  // Use a Firestore transaction to ensure atomicity
  return db.runTransaction(async (transaction) => {
    const results: TicketReservationResult = {
      success: false
    };
    
    try {
      // Get event data to verify it exists
      const eventRef = db.collection('events').doc(eventId);
      const eventDoc = await transaction.get(eventRef);
      
      if (!eventDoc.exists) {
        results.error = 'Event not found';
        return results;
      }
      
      // Process each ticket type in the request
      for (const ticketRequest of tickets) {
        const { ticketTypeId, quantity } = ticketRequest;
        
        // Get the inventory for this ticket type
        const inventoryRef = db.collection('ticketInventory').doc(`${eventId}_${ticketTypeId}`);
        const inventoryDoc = await transaction.get(inventoryRef);
        
        // Check if inventory exists, create it if not
        if (!inventoryDoc.exists) {
          // Get the total quantity from event data
          const eventData = eventDoc.data()!;
          const ticketType = eventData.tickets?.find((t: any) => t.name === ticketTypeId);
          
          if (!ticketType) {
            results.error = `Ticket type ${ticketTypeId} not found`;
            return results;
          }
          
          const totalQuantity = ticketType.totalQuantity || 0;
          
          // Create new inventory
          const newInventory: TicketInventory = {
            eventId,
            ticketTypeId,
            totalQuantity,
            availableQuantity: totalQuantity,
            reservedQuantity: 0,
            soldQuantity: 0,
            lastUpdated: admin.firestore.Timestamp.now()
          };
          
          transaction.set(inventoryRef, newInventory);
          
          // Check if the requested quantity is available
          if (quantity > totalQuantity) {
            // Add to waitlist since not enough tickets are available
            const waitlistId = await addToWaitlist(transaction, userId, eventId, ticketTypeId, quantity);
            results.waitlisted = true;
            results.waitlistId = waitlistId;
            results.error = 'Not enough tickets available';
            return results;
          }
          
          // Update the inventory
          transaction.update(inventoryRef, {
            availableQuantity: totalQuantity - quantity,
            reservedQuantity: quantity,
            lastUpdated: admin.firestore.Timestamp.now()
          });
        } else {
          // Inventory exists, check availability
          const inventory = inventoryDoc.data() as TicketInventory;
          
          if (inventory.availableQuantity < quantity) {
            // Add to waitlist since not enough tickets are available
            const waitlistId = await addToWaitlist(transaction, userId, eventId, ticketTypeId, quantity);
            results.waitlisted = true;
            results.waitlistId = waitlistId;
            results.error = 'Not enough tickets available';
            return results;
          }
          
          // Update the inventory
          transaction.update(inventoryRef, {
            availableQuantity: inventory.availableQuantity - quantity,
            reservedQuantity: inventory.reservedQuantity + quantity,
            lastUpdated: admin.firestore.Timestamp.now()
          });
        }
      }
      
      // Create the reservation
      const reservationExpiry = admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000); // 10 minutes
      const reservationRef = db.collection('ticketReservations').doc();
      
      const reservation: TicketReservation = {
        userId,
        eventId,
        ticketTypeId: tickets[0].ticketTypeId, // This assumes single ticket type for simplicity
        quantity: tickets[0].quantity,
        reservationTime: admin.firestore.Timestamp.fromMillis(timestamp),
        expirationTime: reservationExpiry,
        status: 'pending'
      };
      
      transaction.set(reservationRef, reservation);
      
      // Set up a scheduled task to release the tickets if not purchased
      await scheduleReservationExpiry(reservationRef.id, reservationExpiry.toMillis());
      
      results.success = true;
      results.reservationId = reservationRef.id;
      results.expiresAt = reservationExpiry;
      
      return results;
    } catch (error) {
      console.error('Transaction error:', error);
      results.error = 'Failed to process reservation';
      return results;
    }
  });
}

// Function to add a user to the waitlist
async function addToWaitlist(transaction: FirebaseFirestore.Transaction, userId: string, eventId: string, ticketTypeId: string, quantity: number): Promise<string> {
  const waitlistRef = db.collection('ticketWaitlist').doc();
  
  const waitlistEntry: TicketWaitlist = {
    userId,
    eventId,
    ticketTypeId,
    quantity,
    requestTime: admin.firestore.Timestamp.now(),
    notificationSent: false,
    status: 'waiting'
  };
  
  transaction.set(waitlistRef, waitlistEntry);
  return waitlistRef.id;
}

// Function to schedule the expiration of a reservation
async function scheduleReservationExpiry(reservationId: string, expiryTimeMillis: number): Promise<void> {
  const project = getProjectId();
  const location = 'us-central1';
  const queue = 'ticket-expirations';
  
  const parent = tasksClient.queuePath(project, location, queue);
  
  const taskPayload = { reservationId };
  
  const task: google.cloud.tasks.v2.ITask = {
    httpRequest: {
      httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
      url: `https://${location}-${project}.cloudfunctions.net/processReservationExpiry`,
      oidcToken: {
        serviceAccountEmail: `${project}@appspot.gserviceaccount.com`,
      },
      body: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      headers: {
        'Content-Type': 'application/json',
      },
    },
    scheduleTime: {
      seconds: Math.floor(expiryTimeMillis / 1000),
    },
  };
  
  try {
    const [response] = await tasksClient.createTask({ parent, task });
    console.log(`Scheduled expiration task ${response.name} for reservation ${reservationId}`);
  } catch (error) {
    console.error('Error scheduling expiration task:', error);
  }
}

// Helper function to clean data payload for FCM
function cleanDataPayload(data: Record<string, any>): { [key: string]: string } {
  const cleaned: { [key: string]: string } = {};
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined && data[key] !== null) {
      cleaned[key] = String(data[key]);
    }
  }
  return cleaned;
}

// Function to send notification to the user about reservation status
async function sendReservationNotification(userId: string, result: TicketReservationResult): Promise<void> {
  try {
    // Get user's FCM token
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    
    if (!userData || !userData.fcmToken) {
      console.log('No FCM token found for user', userId);
      return;
    }
    
    const messagePayload = result.success
      ? {
        notification: {
          title: 'Ticket Reservation Successful',
          body: `You have 10 minutes to complete your purchase.`,
        },
        data: cleanDataPayload({
          type: 'TICKET_RESERVATION',
          reservationId: result.reservationId,
          expiresAt: result.expiresAt?.toMillis(),
        }),
      }
      : {
        notification: {
          title: result.waitlisted ? 'Added to Waitlist' : 'Reservation Failed',
          body: result.waitlisted
            ? 'All tickets are currently sold out. You have been added to the waitlist.'
            : `Reservation failed: ${result.error || 'Unknown error'}`,
        },
        data: cleanDataPayload({
          type: 'TICKET_RESERVATION_FAILED',
          error: result.error,
          waitlisted: result.waitlisted,
          waitlistId: result.waitlistId,
        }),
      };
    
    await admin.messaging().sendToDevice(userData.fcmToken, messagePayload);
  } catch (error) {
    console.error('Error sending notification:', error);
  }
}

// Cloud function to process reservation expiry
export const processReservationExpiry = functions.https.onRequest(async (req, res) => {
  try {
    const { reservationId } = req.body;
    
    // Use a transaction to release the tickets safely
    await db.runTransaction(async (transaction) => {
      // Get the reservation
      const reservationRef = db.collection('ticketReservations').doc(reservationId);
      const reservationDoc = await transaction.get(reservationRef);
      
      if (!reservationDoc.exists) {
        console.warn(`Reservation ${reservationId} not found for expiration.`);
        // Don't throw an error, just return success as the state is already achieved (no reservation)
        return;
      }
      
      const reservation = reservationDoc.data() as TicketReservation;
      
      // If the reservation is still pending, mark it as expired and release the tickets
      if (reservation.status === 'pending') {
        // Update reservation status
        transaction.update(reservationRef, { status: 'expired' });
        
        // Release the tickets back to inventory
        const inventoryRef = db.collection('ticketInventory').doc(`${reservation.eventId}_${reservation.ticketTypeId}`);
        const inventoryDoc = await transaction.get(inventoryRef);
        
        if (inventoryDoc.exists) {
          const inventory = inventoryDoc.data() as TicketInventory;
          
          transaction.update(inventoryRef, {
            availableQuantity: inventory.availableQuantity + reservation.quantity,
            reservedQuantity: inventory.reservedQuantity - reservation.quantity,
            lastUpdated: admin.firestore.Timestamp.now()
          });
        }
        
        // Process waitlist if there are people waiting
        await processWaitlist(transaction, reservation.eventId, reservation.ticketTypeId, reservation.quantity);
      }
    });
    
    res.status(200).send({ success: true });
  } catch (error) {
    console.error('Error processing expiration:', error);
    res.status(500).send({ success: false, error: 'Failed to process expiration' });
  }
});

// Function to complete a ticket purchase
export const completeTicketPurchase = functions.https.onCall(async (request: functions.https.CallableRequest<{ reservationId: string }>) => {
  // Validate user
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  const userId = request.auth.uid;

  const { reservationId } = request.data;

  if (!reservationId) {
    throw new functions.https.HttpsError('invalid-argument', ErrorCode.MISSING_PARAMS);
  }

  // Use a transaction to safely complete the purchase
  return db.runTransaction(async (transaction) => {
    // Get the reservation
    const reservationRef = db.collection('ticketReservations').doc(reservationId);
    const reservationDoc = await transaction.get(reservationRef);

    if (!reservationDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Reservation not found');
    }

    const reservation = reservationDoc.data() as TicketReservation;

    // Verify that the reservation belongs to the user
    if (reservation.userId !== userId) {
      throw new functions.https.HttpsError('permission-denied', 'Reservation does not belong to this user');
    }

    // Check if the reservation is still valid
    if (reservation.status !== 'pending') {
      throw new functions.https.HttpsError('failed-precondition', `Reservation is ${reservation.status}`);
    }

    const now = admin.firestore.Timestamp.now();
    if (now.toMillis() > reservation.expirationTime.toMillis()) {
      throw new functions.https.HttpsError('failed-precondition', 'Reservation has expired');
    }

    // Update reservation status
    transaction.update(reservationRef, {
      status: 'completed',
    });

    // Update ticket inventory
    const inventoryRef = db.collection('ticketInventory').doc(`${reservation.eventId}_${reservation.ticketTypeId}`);
    const inventoryDoc = await transaction.get(inventoryRef);

    if (inventoryDoc.exists) {
      const inventory = inventoryDoc.data() as TicketInventory;

      transaction.update(inventoryRef, {
        reservedQuantity: inventory.reservedQuantity - reservation.quantity,
        soldQuantity: inventory.soldQuantity + reservation.quantity,
        lastUpdated: now
      });
    }

    // Create tickets for the user
    const ticketBatch = [];

    // Get event data for ticket creation
    const eventRef = db.collection('events').doc(reservation.eventId);
    const eventDoc = await transaction.get(eventRef);

    if (!eventDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Event not found');
    }

    const eventData = eventDoc.data()!;

    // Get the ticket type details
    const ticketType = eventData.tickets?.find((t: any) => t.name === reservation.ticketTypeId);

    if (!ticketType) {
      throw new functions.https.HttpsError('not-found', 'Ticket type not found');
    }

    // Get the event location
    const firstLocation = eventData.locations?.[0] || {};

    // Create the tickets
    for (let i = 0; i < reservation.quantity; i++) {
      const ticketRef = db.collection('tickets').doc();

      const ticket = {
        ticketId: ticketRef.id,
        eventId: reservation.eventId,
        ownerId: userId,
        promoterId: eventData.promoterIds[0] || 'unknown',
        ticketType: reservation.ticketTypeId,
        ticketStatus: 'active',
        ticketPrice: ticketType.price,
        description: ticketType.description || '',
        eventDateName: eventData.dates?.[0]?.name || '',
        ownedAt: now,
        purchasedAt: now,
        scannedBy: null,
        scannedAt: null,
        scanStartTime: ticketType.validTimeSlots?.[0]?.startTime || eventData.startTime,
        scanExpiryTime: ticketType.validTimeSlots?.[0]?.endTime || eventData.endTime,
        minActivationTime: now,
        activatedAt: null,
        locationId: firstLocation.locationId || null,
        entranceLocation: firstLocation.geopoint || null,
      };

      transaction.set(ticketRef, ticket);
      ticketBatch.push(ticket);
    }

    return {
      success: true,
      ticketCount: reservation.quantity,
      tickets: ticketBatch.map(t => t.ticketId)
    };
  });
});

// Function to process the waitlist when tickets become available
async function processWaitlist(transaction: FirebaseFirestore.Transaction, eventId: string, ticketTypeId: string, availableQuantity: number): Promise<void> {
  if (availableQuantity <= 0) return;

  // Query the waitlist for this ticket type, ordered by request time
  const waitlistRef = db.collection('ticketWaitlist')
    .where('eventId', '==', eventId)
    .where('ticketTypeId', '==', ticketTypeId)
    .where('status', '==', 'waiting')
    .orderBy('requestTime', 'asc')
    .limit(10); // Limit processing to avoid large transactions
  
  const waitlistDocs = await transaction.get(waitlistRef);
  
  if (waitlistDocs.empty) {
    return;
  }
  
  let remainingQuantity = availableQuantity;
  const now = admin.firestore.Timestamp.now();
  const expirationTime = admin.firestore.Timestamp.fromMillis(now.toMillis() + 30 * 60 * 1000); // 30 minutes
  
  for (const doc of waitlistDocs.docs) {
    const waitlistEntry = doc.data() as TicketWaitlist;
    
    if (remainingQuantity <= 0) {
      break;
    }
    
    // Check if we can fully satisfy this waitlist entry
    if (waitlistEntry.quantity <= remainingQuantity) {
      // Reserve inventory for this user
      const inventoryRef = db.collection('ticketInventory').doc(`${eventId}_${ticketTypeId}`);
      const inventoryDoc = await transaction.get(inventoryRef);
      
      if (!inventoryDoc.exists || (inventoryDoc.data() as TicketInventory).availableQuantity < waitlistEntry.quantity) {
        // Not enough inventory anymore (shouldn't happen with transaction but safety check)
        continue;
      }
      const inventory = inventoryDoc.data() as TicketInventory;
      
      transaction.update(inventoryRef, {
        availableQuantity: inventory.availableQuantity - waitlistEntry.quantity,
        // We don't mark as reserved here, wait for claim
        lastUpdated: now
      });
      
      // Update waitlist entry
      transaction.update(doc.ref, {
        status: 'notified',
        notificationSent: true,
        notificationTime: now,
        expirationTime: expirationTime
      });
      
      remainingQuantity -= waitlistEntry.quantity;
      
      // Schedule a task to expire this notification if not claimed
      await scheduleWaitlistNotificationExpiry(doc.id, expirationTime.toMillis());
      
      // Send notification to the user
      await sendWaitlistNotification(waitlistEntry.userId, doc.id, expirationTime);
    } else {
      // Cannot fully satisfy, break for now (could partially satisfy but adds complexity)
      break;
    }
  }
}

// Function to send notification to waitlisted user
async function sendWaitlistNotification(userId: string, waitlistId: string, expiryTime: admin.firestore.Timestamp): Promise<void> {
  try {
    // Get user's FCM token
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    
    if (!userData || !userData.fcmToken) {
      console.log('No FCM token found for user', userId);
      return;
    }
    
    const messagePayload = {
      notification: {
        title: 'Tickets Now Available',
        body: 'Tickets are now available for your waitlisted event. You have 30 minutes to complete your purchase.',
      },
      data: cleanDataPayload({
        type: 'WAITLIST_NOTIFICATION',
        waitlistId,
        expiresAt: expiryTime.toMillis(),
      }),
    };
    
    await admin.messaging().sendToDevice(userData.fcmToken, messagePayload);
  } catch (error) {
    console.error('Error sending waitlist notification:', error);
  }
}

// Function to schedule the expiration of a waitlist notification
async function scheduleWaitlistNotificationExpiry(waitlistId: string, expiryTimeMillis: number): Promise<void> {
  const project = getProjectId();
  const location = 'us-central1';
  const queue = 'waitlist-notifications';
  
  const parent = tasksClient.queuePath(project, location, queue);
  
  const taskPayload = { waitlistId };
  
  const task: google.cloud.tasks.v2.ITask = {
    httpRequest: {
      httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
      url: `https://${location}-${project}.cloudfunctions.net/processWaitlistNotificationExpiry`,
      oidcToken: {
        serviceAccountEmail: `${project}@appspot.gserviceaccount.com`,
      },
      body: Buffer.from(JSON.stringify(taskPayload)).toString('base64'),
      headers: {
        'Content-Type': 'application/json',
      },
    },
    scheduleTime: {
      seconds: Math.floor(expiryTimeMillis / 1000),
    },
  };
  
  try {
    const [response] = await tasksClient.createTask({ parent, task });
    console.log(`Scheduled waitlist notification expiration task ${response.name} for waitlist entry ${waitlistId}`);
  } catch (error) {
    console.error('Error scheduling waitlist notification expiration task:', error);
  }
}

// Cloud function to process waitlist notification expiry
export const processWaitlistNotificationExpiry = functions.https.onRequest(async (req, res) => {
  try {
    const { waitlistId } = req.body;
    
    // Use a transaction to safely process the expiration
    await db.runTransaction(async (transaction) => {
      // Get the waitlist entry
      const waitlistRef = db.collection('ticketWaitlist').doc(waitlistId);
      const waitlistDoc = await transaction.get(waitlistRef);
      
      if (!waitlistDoc.exists) {
        console.warn(`Waitlist entry ${waitlistId} not found for expiration.`);
        return; // Already processed or deleted
      }
      
      const waitlistEntry = waitlistDoc.data() as TicketWaitlist;
      
      // If the entry is still in notified status, expire it and release the tickets
      if (waitlistEntry.status === 'notified') {
        // Update waitlist status
        transaction.update(waitlistRef, { status: 'expired' });
        
        // Release the tickets back to inventory
        const inventoryRef = db.collection('ticketInventory').doc(`${waitlistEntry.eventId}_${waitlistEntry.ticketTypeId}`);
        const inventoryDoc = await transaction.get(inventoryRef);
        
        if (inventoryDoc.exists) {
          const inventory = inventoryDoc.data() as TicketInventory;
          
          transaction.update(inventoryRef, {
            availableQuantity: inventory.availableQuantity + waitlistEntry.quantity,
            lastUpdated: admin.firestore.Timestamp.now()
          });
          // Process next waitlist entries with the released quantity
          await processWaitlist(transaction, waitlistEntry.eventId, waitlistEntry.ticketTypeId, waitlistEntry.quantity);
        } else {
          // If inventory somehow doesn't exist, still process waitlist as if tickets became available
          console.warn(`Inventory not found for ${waitlistEntry.eventId}_${waitlistEntry.ticketTypeId} during waitlist expiry.`);
          await processWaitlist(transaction, waitlistEntry.eventId, waitlistEntry.ticketTypeId, waitlistEntry.quantity);
        }
      }
    });
    
    res.status(200).send({ success: true });
  } catch (error) {
    console.error('Error processing waitlist notification expiration:', error);
    res.status(500).send({ success: false, error: 'Failed to process waitlist notification expiration' });
  }
});

// Function to claim waitlisted tickets
export const claimWaitlistedTickets = functions.https.onCall(async (request: functions.https.CallableRequest<{ waitlistId: string }>) => {
  // Validate user
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  const userId = request.auth.uid;

  const { waitlistId } = request.data;

  if (!waitlistId) {
    throw new functions.https.HttpsError('invalid-argument', ErrorCode.MISSING_PARAMS);
  }

  // Use a transaction to safely claim the tickets
  return db.runTransaction(async (transaction) => {
    // Get the waitlist entry
    const waitlistRef = db.collection('ticketWaitlist').doc(waitlistId);
    const waitlistDoc = await transaction.get(waitlistRef);

    if (!waitlistDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Waitlist entry not found');
    }

    const waitlistEntry = waitlistDoc.data() as TicketWaitlist;

    // Verify that the waitlist entry belongs to the user
    if (waitlistEntry.userId !== userId) {
      throw new functions.https.HttpsError('permission-denied', 'Waitlist entry does not belong to this user');
    }

    // Check if the notification is still valid
    if (waitlistEntry.status !== 'notified') {
      throw new functions.https.HttpsError('failed-precondition', `Waitlist status is ${waitlistEntry.status}`);
    }

    const now = admin.firestore.Timestamp.now();
    if (!waitlistEntry.expirationTime || now.toMillis() > waitlistEntry.expirationTime.toMillis()) {
      // We need to expire this entry and release tickets if expiration hasn't run yet
      transaction.update(waitlistRef, { status: 'expired' });
      const inventoryRef = db.collection('ticketInventory').doc(`${waitlistEntry.eventId}_${waitlistEntry.ticketTypeId}`);
      const inventoryDoc = await transaction.get(inventoryRef);
      if (inventoryDoc.exists) {
        const inventory = inventoryDoc.data() as TicketInventory;
        transaction.update(inventoryRef, {
          availableQuantity: inventory.availableQuantity + waitlistEntry.quantity,
          lastUpdated: now
        });
        // Process waitlist again
        await processWaitlist(transaction, waitlistEntry.eventId, waitlistEntry.ticketTypeId, waitlistEntry.quantity);
      }
      throw new functions.https.HttpsError('failed-precondition', 'Waitlist notification has expired');
    }

    // Create a reservation for these tickets
    const reservationExpiry = admin.firestore.Timestamp.fromMillis(now.toMillis() + 10 * 60 * 1000); // 10 minutes
    const reservationRef = db.collection('ticketReservations').doc();

    const reservation: TicketReservation = {
      userId: waitlistEntry.userId,
      eventId: waitlistEntry.eventId,
      ticketTypeId: waitlistEntry.ticketTypeId,
      quantity: waitlistEntry.quantity,
      reservationTime: now,
      expirationTime: reservationExpiry,
      status: 'pending'
    };

    // Update waitlist entry status
    transaction.update(waitlistRef, {
      status: 'claimed' // Use 'claimed' instead of 'completed'
    });

    // Add the reserved quantity back to the inventory temporarily
    const inventoryRef = db.collection('ticketInventory').doc(`${waitlistEntry.eventId}_${waitlistEntry.ticketTypeId}`);
    const inventoryDoc = await transaction.get(inventoryRef);
    if (inventoryDoc.exists) {
      transaction.update(inventoryRef, {
        reservedQuantity: admin.firestore.FieldValue.increment(waitlistEntry.quantity),
        lastUpdated: now
      });
    } else {
      // Should not happen if tickets were available for waitlist
      console.error(`Inventory not found when claiming waitlist for ${waitlistEntry.eventId}_${waitlistEntry.ticketTypeId}`);
    }

    transaction.set(reservationRef, reservation);

    // Schedule a task to release the tickets if not purchased
    await scheduleReservationExpiry(reservationRef.id, reservationExpiry.toMillis());

    return {
      success: true,
      reservationId: reservationRef.id,
      expiresAt: reservationExpiry.toMillis()
    };
  });
}); 