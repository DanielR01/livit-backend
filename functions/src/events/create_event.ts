import * as functions from "firebase-functions";
import admin from '../firebase-admin';
import { ErrorCode } from "../errors";
import { EventDate, EventLocation, EventTicket, EventData, EventDateTimeSlot, EventDataDeserialized, serializeEventData } from "./event_interface";
import { debugLog, debugError } from "../utils/debug";

const db = admin.firestore();

// Define a context name for debugging
const DEBUG_CONTEXT = 'CreateEvent';

/**
 * Validates basic event data structure and required fields
 */
function validateInitialEventData(eventData: EventData): {isValid: boolean, error?: string} {
  debugLog(DEBUG_CONTEXT, 'Performing initial event validation');
  
  // Check required fields
  if (!eventData.name || eventData.name.trim() === '') {
    return { isValid: false, error: 'Event name is required' };
  } else if (eventData.name.length > 100) {
    return { isValid: false, error: 'Event name must be less than 100 characters' };
  }
  
  if (!eventData.dates || eventData.dates.length === 0) {
    return { isValid: false, error: 'Event must have at least one date' };
  }
  
  if (!eventData.locations || eventData.locations.length === 0) {
    return { isValid: false, error: 'Event must have at least one location' };
  }
  
  if (!eventData.tickets || eventData.tickets.length === 0) {
    return { isValid: false, error: 'Event must have at least one ticket type' };
  }
  
  if (!eventData.promoterIds || eventData.promoterIds.length === 0) {
    return { isValid: false, error: 'Event must have at least one promoter' };
  }

  if (!eventData.description || eventData.description.trim() === '') {
    return { isValid: false, error: 'Event description is required' };
  } else if (eventData.description.length > 200) {
    return { isValid: false, error: 'Event description must be less than 200 characters' };
  }
  
  return { isValid: true };
}

/**
 * Performs detailed validation on event data including relationships between dates, locations, and tickets
 */
function validateFullEventData(eventData: EventData): {isValid: boolean, error?: string} {
  debugLog(DEBUG_CONTEXT, 'Performing full event validation');
  
  const now = admin.firestore.Timestamp.now();
  
  // Validate each date
  for (const date of eventData.dates) {
    // Check that start time is before end time
    if (date.startTime.toMillis() >= date.endTime.toMillis()) {
      return { isValid: false, error: 'Date start time must be before end time' };
    }
    
    // Check that start time is in the future
    if (date.startTime.toMillis() <= now.toMillis()) {
      return { isValid: false, error: 'Date start time must be in the future' };
    }
    
    // Check that each date has at least one location
    const hasLocation = eventData.locations.some((location: EventLocation) => location.dateName === date.name);
    if (!hasLocation) {
      return { isValid: false, error: `No location found for date: ${date.name}` };
    }
    
    // Check that each date has at least one ticket type
    const hasTicket = eventData.tickets.some((ticket: EventTicket) => 
      ticket.validTimeSlots && ticket.validTimeSlots.some((slot: EventDateTimeSlot) => slot.dateName === date.name)
    );
    
    if (!hasTicket) {
      return { isValid: false, error: `No ticket type found for date: ${date.name}` };
    }
  }
  
  // Validate tickets
  for (const ticket of eventData.tickets) {
    if (!ticket.name || ticket.name.trim() === '') {
      return { isValid: false, error: 'Ticket name is required' };
    }
    
    if (ticket.price.amount < 0) {
      return { isValid: false, error: 'Ticket price cannot be negative' };
    }
    
    if (ticket.totalQuantity <= 0) {
      return { isValid: false, error: 'Ticket quantity must be greater than zero' };
    }

    if (ticket.validTimeSlots.length === 0) {
      return { isValid: false, error: 'Ticket must have at least one valid time slot' };
    }

    if (ticket.validTimeSlots.some((slot: EventDateTimeSlot) => slot.startTime.toMillis() >= slot.endTime.toMillis())) {
      return { isValid: false, error: 'Ticket time slot start time must be before end time' };
    }

    if (ticket.validTimeSlots.some((slot: EventDateTimeSlot) => slot.startTime.toMillis() <= now.toMillis())) {
      return { isValid: false, error: 'Ticket time slot start time must be in the future' };
    }

    if (!ticket.validTimeSlots.every((slot: EventDateTimeSlot) => {
        const slotStartTime = slot.startTime.toMillis();
        const slotEndTime = slot.endTime.toMillis();
        const dateOfTicket = eventData.dates.find((date: EventDate) => date.name === slot.dateName);
        if (!dateOfTicket) {
            return false;
        }
        const dateStartTime = dateOfTicket.startTime.toMillis();
        const dateEndTime = dateOfTicket.endTime.toMillis();
        return slotStartTime <= dateStartTime && slotEndTime <= dateEndTime;
    })) {
      return { isValid: false, error: 'Ticket valid time must start and end before start and end of date respectively' };
    }
  }

  for (const location of eventData.locations) {
    if (!location.locationId) {
      if (!location.name || location.name.trim() === '') {
        return { isValid: false, error: 'Location must have a name' };
      } else if (location.name.length > 100) {
        return { isValid: false, error: 'Location name must be less than 100 characters' };
      }

      if (!location.dateName || location.dateName.trim() === '') {
        return { isValid: false, error: 'Location must have a date name' };
      }

      if (!location.geopoint) {
        return { isValid: false, error: 'Location must have a geopoint' };
      }

      if (!location.address || location.address.trim() === '') {
        return { isValid: false, error: 'Location must have an address' };
      } else if (location.address.length > 100) {
        return { isValid: false, error: 'Location address must be less than 100 characters' };
      }

      if (!location.city || location.city.trim() === '') {
        return { isValid: false, error: 'Location must have a city' };
      }
    }
    if (location.description) {
      if (location.description.length > 200) {
        return { isValid: false, error: 'Location description must be less than 200 characters' };
      }
    }
    
    
  }
  
  return { isValid: true };
}

export const createEvent = functions.https.onCall(async (request: functions.https.CallableRequest) => {
  try {
    debugLog(DEBUG_CONTEXT, 'Function called', { userId: request.auth?.uid });
    
    // Validate that the user is authenticated
    if (!request.auth) {
      debugError(DEBUG_CONTEXT, 'Authentication required');
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    // Extract and deserialize event data
    const deserializedEventData: EventDataDeserialized = request.data;
    debugLog(DEBUG_CONTEXT, 'Received event data', { 
      name: deserializedEventData.name,
      dateCount: deserializedEventData.dates?.length,
      locationCount: deserializedEventData.locations?.length,
      ticketCount: deserializedEventData.tickets?.length
    });
    
    // Log a sample date for debugging timestamp format
    if (deserializedEventData.dates && deserializedEventData.dates.length > 0) {
      const sampleDate = deserializedEventData.dates[0];
      debugLog(DEBUG_CONTEXT, 'Sample date before serialization', {
        name: sampleDate.name,
        startTime: sampleDate.startTime,
        endTime: sampleDate.endTime
      });
    }
    
    // Convert deserialized data to proper EventData with Timestamp objects
    debugLog(DEBUG_CONTEXT, 'Starting event data serialization');
    let eventData: EventData;
    try {
      eventData = serializeEventData(deserializedEventData);
      debugLog(DEBUG_CONTEXT, 'Event data serialized successfully');
      
      // Log a sample date for debugging timestamp conversion
      if (eventData.dates && eventData.dates.length > 0) {
        const sampleDate = eventData.dates[0];
        debugLog(DEBUG_CONTEXT, 'Sample date after serialization', {
          name: sampleDate.name,
          startTime: sampleDate.startTime.toDate().toISOString(),
          endTime: sampleDate.endTime.toDate().toISOString(),
          startTimeMillis: sampleDate.startTime.toMillis(),
          endTimeMillis: sampleDate.endTime.toMillis()
        });
      }
    } catch (error) {
      debugError(DEBUG_CONTEXT, 'Failed to serialize event data', error);
      throw new functions.https.HttpsError('invalid-argument', 'Invalid timestamp format in event data');
    }
    
    // Perform initial validation
    debugLog(DEBUG_CONTEXT, 'Starting initial validation');
    const initialValidation = validateInitialEventData(eventData);
    if (!initialValidation.isValid) {
      debugError(DEBUG_CONTEXT, 'Initial validation failed', { error: initialValidation.error });
      throw new functions.https.HttpsError('invalid-argument', initialValidation.error || ErrorCode.MISSING_PARAMS);
    }
    debugLog(DEBUG_CONTEXT, 'Initial validation passed');
    
    // Perform full validation
    debugLog(DEBUG_CONTEXT, 'Starting full validation');
    const fullValidation = validateFullEventData(eventData);
    if (!fullValidation.isValid) {
      debugError(DEBUG_CONTEXT, 'Full validation failed', { error: fullValidation.error });
      throw new functions.https.HttpsError('invalid-argument', fullValidation.error || 'Event validation failed');
    }
    debugLog(DEBUG_CONTEXT, 'Full validation passed');

    // Validate that the user is a promoter
    debugLog(DEBUG_CONTEXT, 'Validating user permissions', { userId: request.auth.uid });
    const userRef = db.collection('users').doc(request.auth.uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      debugError(DEBUG_CONTEXT, 'User not found', { userId: request.auth.uid });
      throw new functions.https.HttpsError('not-found', ErrorCode.USER_NOT_FOUND);
    }
    
    const userData = userDoc.data();
    if (userData?.userType !== 'promoter') {
      debugError(DEBUG_CONTEXT, 'User is not a promoter', { userId: request.auth.uid, userType: userData?.userType });
      throw new functions.https.HttpsError('permission-denied', ErrorCode.PERMISSION_DENIED);
    }
    debugLog(DEBUG_CONTEXT, 'User is a valid promoter', { userId: request.auth.uid, promoterId: userData.id });

    const promoterIdFromRequest = request.auth.uid;
    const promoterIdFromEventData = eventData.promoterIds[0];

    const promoterIdMatch = promoterIdFromRequest === promoterIdFromEventData;

    debugLog(DEBUG_CONTEXT, 'Promoter IDs match', { 
      promoterIdFromRequest, 
      promoterIdFromEventData,
      promoterIdMatch
    });

    if (eventData.promoterIds.length !== 1 || !promoterIdMatch) {
      debugError(DEBUG_CONTEXT, 'Promoter IDs mismatch', { 
        providedIds: eventData.promoterIds, 
        actualId: userData.id 
      });
      throw new functions.https.HttpsError('permission-denied', ErrorCode.PERMISSION_DENIED);
    }

    const promoterId = promoterIdFromRequest;

    // Check if the provided locations exist and belong to the promoter
    const locationIds = eventData.locations.map((location: EventLocation) => location.locationId);
    const uniqueLocationIds = [...new Set(locationIds)].filter(id => id !== undefined) as string[];
    
    debugLog(DEBUG_CONTEXT, 'Validating locations', { uniqueLocationIds });
    if (uniqueLocationIds.length > 0) {
      const locationsSnapshot = await db.collection('locations')
        .where(admin.firestore.FieldPath.documentId(), 'in', uniqueLocationIds)
        .get();
      
      if (locationsSnapshot.size !== uniqueLocationIds.length) {
        const foundIds = locationsSnapshot.docs.map(doc => doc.id);
        const missingIds = uniqueLocationIds.filter(id => !foundIds.includes(id));
        debugError(DEBUG_CONTEXT, 'Some locations not found', { missingIds });
        throw new functions.https.HttpsError('not-found', ErrorCode.LOCATION_NOT_FOUND);
      }
      
      // Check if all locations belong to the promoter
      const locationsPromoterId : string[] = locationsSnapshot.docs.map(doc => doc.data().userId as string);
      debugLog(DEBUG_CONTEXT, 'Locations Promoter ID', { locationsPromoterId });
      debugLog(DEBUG_CONTEXT, 'Promoter ID', { promoterId });
      if (!locationsPromoterId.every((id: string) => {
        const match = id === promoterId;
        debugLog(DEBUG_CONTEXT, 'Promoter ID from locations and request match', { id, promoterId, match });
        return match;
      })) {
        debugError(DEBUG_CONTEXT, 'Some locations do not belong to the promoter', {
          locationPromoterIds: locationsPromoterId,
          eventPromoterIds: eventData.promoterIds
        });
        throw new functions.https.HttpsError('permission-denied', ErrorCode.PERMISSION_DENIED);
      }
      debugLog(DEBUG_CONTEXT, 'All locations validated successfully');
    }

    const { name, description, dates, locations, tickets, promoterIds } = eventData;
    
    // Calculate event start and end times by finding earliest start and latest end across all dates and ticket slots    
    debugLog(DEBUG_CONTEXT, 'Calculating event time range');
    // Initialize with the first date's times
    let earliestTime = dates[0].startTime.toMillis();
    let latestTime = dates[0].endTime.toMillis();
    
    // Check all dates
    for (const date of dates) {
      if (date.startTime.toMillis() < earliestTime) {
        earliestTime = date.startTime.toMillis();
      }
      if (date.endTime.toMillis() > latestTime) {
        latestTime = date.endTime.toMillis();
      }
    }
    
    const eventStartTime = admin.firestore.Timestamp.fromMillis(earliestTime);
    const eventEndTime = admin.firestore.Timestamp.fromMillis(latestTime);
    
    debugLog(DEBUG_CONTEXT, 'Calculated event time range', {
      startTime: eventStartTime.toDate().toISOString(),
      endTime: eventEndTime.toDate().toISOString()
    });
    
    const eventDataToStore = {
      name,
      description: description || null,
      dates: dates || [],
      locations: locations || [],
      locationIds: uniqueLocationIds || [],
      tickets: tickets || [],
      promoterIds: promoterIds || [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      startTime: eventStartTime,
      endTime: eventEndTime,
      isActive: true,
      isFeatured: false,
      reviewStatus: 'completed',
    };
    
    debugLog(DEBUG_CONTEXT, 'Creating event document', {
      eventName: name, 
      dateCount: dates.length,
      ticketCount: tickets.length
    });
    
    try {
      // Create event document
      const eventRef = db.collection('events').doc();
      await eventRef.set(eventDataToStore);
      debugLog(DEBUG_CONTEXT, 'Event document created successfully', { eventId: eventRef.id });

      // Create tickets collection inside event document
      const ticketsCollectionRef = eventRef.collection('tickets');
      const ticketCreationPromises = tickets.map(async (ticket: EventTicket) => {
        const ticketRef = ticketsCollectionRef.doc();
        const ticketData = {
          ...ticket,
          eventId: eventRef.id,
          soldQuantity: 0,
          isActive: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await ticketRef.set(ticketData);
        debugLog(DEBUG_CONTEXT, 'Ticket created', { 
          eventId: eventRef.id, 
          ticketId: ticketRef.id, 
          ticketName: ticket.name 
        });
        return ticketRef.id;
      });
      
      await Promise.all(ticketCreationPromises);
      debugLog(DEBUG_CONTEXT, 'All tickets created successfully');
      
      // Return success with event ID
      const result = {
        status: 'success',
        eventId: eventRef.id,
      };
      debugLog(DEBUG_CONTEXT, 'Event creation completed successfully', result);
      return result;
    } catch (error) {
      debugError(DEBUG_CONTEXT, 'Failed to create event document in Firestore', error);
      throw new functions.https.HttpsError('internal', 'Failed to create event');
    }
  } catch (error) {
    // Handle general errors
    if (error instanceof functions.https.HttpsError) {
      // Re-throw HttpsErrors as they already have the proper format
      throw error;
    }
    
    // Log and convert other errors
    debugError(DEBUG_CONTEXT, 'Unhandled error in createEvent', error);
    throw new functions.https.HttpsError(
      'internal',
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
});
