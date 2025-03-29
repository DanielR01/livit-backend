import admin from "../firebase-admin";
import { LivitPrice } from "../price/livit_price";
import { debugLog, debugError } from "../utils/debug";

interface EventDate {
    name: string;
    startTime: admin.firestore.Timestamp;
    endTime: admin.firestore.Timestamp;
}
  
interface EventLocation {
  geopoint?: admin.firestore.GeoPoint;
  name?: string;
  locationId?: string;
  dateName: string;
  address?: string;
  city?: string;
  state?: string;
  description?: string;
}

interface EventTicket {
  name: string;
  totalQuantity: number;
  validTimeSlots: EventDateTimeSlot[];
  description?: string;
  price: LivitPrice;
}

interface EventDateTimeSlot {
  dateName: string;
  startTime: admin.firestore.Timestamp;
  endTime: admin.firestore.Timestamp;
}

interface EventData {
  name: string;
  description?: string;
  dates: EventDate[];
  locations: EventLocation[];
  tickets: EventTicket[];
  promoterIds: string[];
}

// Deserialized event data and their components 

interface EventLocationDeserialized {
  geopoint?: admin.firestore.GeoPoint;
  name?: string;
  locationId?: string;
  dateName: string;
  address?: string;
  city?: string;
  state?: string;
  description?: string;
}

interface EventTicketDeserialized {
  name: string;
  totalQuantity: number;
  validTimeSlots: EventDateTimeSlotDeserialized[];
  description?: string;
  price: LivitPrice;
}

interface EventDateTimeSlotDeserialized {
  dateName: string;
  startTime: DeserializedTimestamp;
  endTime: DeserializedTimestamp;
}

interface EventDateDeserialized {
  name: string;
  startTime: DeserializedTimestamp;
  endTime: DeserializedTimestamp;
}

interface DeserializedTimestamp {
  seconds: number;
  nanoseconds: number;
}

interface EventDataDeserialized {
  name: string;
  description?: string;
  dates: EventDateDeserialized[];
  locations: EventLocationDeserialized[];
  tickets: EventTicketDeserialized[];
}

// Define a context name for debugging
const DEBUG_CONTEXT = 'EventInterface';

export function serializeEventData(eventData: EventDataDeserialized): EventData {
  debugLog(DEBUG_CONTEXT, 'Serializing event data');
  
  // Validate that we have an event data object
  if (!eventData) {
    debugError(DEBUG_CONTEXT, 'Event data is null or undefined');
    throw new Error('Event data is required');
  }
  
  // Check required properties
  if (!eventData.name) {
    debugError(DEBUG_CONTEXT, 'Event name is missing');
    throw new Error('Event name is required');
  }
  
  // Validate dates array
  if (!eventData.dates || !Array.isArray(eventData.dates) || eventData.dates.length === 0) {
    debugError(DEBUG_CONTEXT, 'Event dates array is missing or empty', { dates: eventData.dates });
    throw new Error('Event must have at least one date');
  }
  
  // Validate tickets array
  if (!eventData.tickets || !Array.isArray(eventData.tickets) || eventData.tickets.length === 0) {
    debugError(DEBUG_CONTEXT, 'Event tickets array is missing or empty');
    throw new Error('Event must have at least one ticket');
  }
  
  // Validate locations array
  if (!eventData.locations || !Array.isArray(eventData.locations) || eventData.locations.length === 0) {
    debugError(DEBUG_CONTEXT, 'Event locations array is missing or empty');
    throw new Error('Event must have at least one location');
  }
  
  // Convert deserialized timestamps to Firestore Timestamps
  const convertTimestamp = (timestamp: DeserializedTimestamp | number): admin.firestore.Timestamp => {
    debugLog(DEBUG_CONTEXT, 'Converting timestamp', { type: typeof timestamp, value: timestamp });
    
    if (typeof timestamp === 'number') {
      // Handle case where timestamp is sent as milliseconds
      debugLog(DEBUG_CONTEXT, 'Converting from milliseconds', timestamp);
      return admin.firestore.Timestamp.fromMillis(timestamp);
    } else if (timestamp && typeof timestamp === 'object' && 'seconds' in timestamp && 'nanoseconds' in timestamp) {
      // Handle case where timestamp is sent as {seconds, nanoseconds} object
      debugLog(DEBUG_CONTEXT, 'Converting from seconds/nanoseconds', {
        seconds: timestamp.seconds,
        nanoseconds: timestamp.nanoseconds
      });
      
      try {
        return new admin.firestore.Timestamp(
          timestamp.seconds,
          timestamp.nanoseconds
        );
      } catch (error: any) {
        debugError(DEBUG_CONTEXT, 'Error creating Timestamp', {
          seconds: timestamp.seconds,
          nanoseconds: timestamp.nanoseconds,
          error
        });
        throw error;
      }
    }
    
    // Invalid format - log error and throw
    debugError(DEBUG_CONTEXT, 'Invalid timestamp format', timestamp);
    throw new Error('Invalid timestamp format');
  };

  // Convert dates with proper timestamps
  debugLog(DEBUG_CONTEXT, 'Processing dates', { count: eventData.dates?.length });
  const dates = eventData.dates.map((date, index) => {
    try {
      debugLog(DEBUG_CONTEXT, `Converting date ${index}`, { name: date.name });
      return {
        name: date.name,
        startTime: convertTimestamp(date.startTime),
        endTime: convertTimestamp(date.endTime)
      };
    } catch (error: any) {
      debugError(DEBUG_CONTEXT, `Error converting date ${index}`, { date, error });
      throw new Error(`Error converting timestamp for date '${date.name}': ${error.message}`);
    }
  });

  // Convert ticket time slots with proper timestamps
  debugLog(DEBUG_CONTEXT, 'Processing tickets', { count: eventData.tickets?.length });
  const tickets = eventData.tickets.map((ticket, ticketIndex) => {
    try {
      debugLog(DEBUG_CONTEXT, `Converting ticket ${ticketIndex}`, { 
        name: ticket.name, 
        slotCount: ticket.validTimeSlots?.length 
      });
      
      return {
        name: ticket.name,
        totalQuantity: ticket.totalQuantity,
        validTimeSlots: ticket.validTimeSlots.map((slot, slotIndex) => {
          try {
            debugLog(DEBUG_CONTEXT, `Converting time slot ${slotIndex} for ticket ${ticketIndex}`, {
              dateName: slot.dateName
            });
            
            return {
              dateName: slot.dateName,
              startTime: convertTimestamp(slot.startTime),
              endTime: convertTimestamp(slot.endTime)
            };
          } catch (error: any) {
            debugError(DEBUG_CONTEXT, `Error converting time slot ${slotIndex} for ticket ${ticketIndex}`, { 
              slot, error 
            });
            throw new Error(`Error converting timestamp for time slot in ticket '${ticket.name}': ${error.message}`);
          }
        }),
        description: ticket.description,
        price: ticket.price
      };
    } catch (error: any) {
      debugError(DEBUG_CONTEXT, `Error processing ticket ${ticketIndex}`, { ticket, error });
      throw error;
    }
  });

  // Extract promoter IDs or use an empty array if not provided
  const promoterIds = (eventData as any).promoterIds || [];
  debugLog(DEBUG_CONTEXT, 'Extracted promoter IDs', { promoterIds });

  // Return the serialized EventData object
  debugLog(DEBUG_CONTEXT, 'Event data serialization completed successfully');
  return {
    name: eventData.name,
    description: eventData.description,
    dates,
    locations: eventData.locations,
    tickets,
    promoterIds
  };
}

export { EventDate, EventLocation, EventTicket, EventDateTimeSlot, EventData, EventLocationDeserialized, EventTicketDeserialized, EventDateTimeSlotDeserialized, EventDateDeserialized, DeserializedTimestamp, EventDataDeserialized};
  
  