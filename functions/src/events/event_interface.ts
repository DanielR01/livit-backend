import admin from "../firebase-admin";
import { LivitPrice } from "../price/livit_price";

// --- Restored Timestamp Map Interface ---
interface TimestampMap {
  seconds: number;
  nanoseconds: number;
}

// --- Restored GeoPoint Map Interface ---
interface GeoPointMap {
  latitude: number;
  longitude: number;
}

interface EventDate {
    name: string;
    startTime: admin.firestore.Timestamp;
    endTime: admin.firestore.Timestamp;
}
  
interface EventLocation {
  geopoint?: admin.firestore.GeoPoint | null;
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
  maxQuantityPerUser?: number;
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

// --- Restored Deserialized Interfaces ---
interface EventDateDeserialized {
  name: string;
  startTime: TimestampMap; // Serialized format
  endTime: TimestampMap; // Serialized format
}

interface EventLocationDeserialized {
  geopoint?: GeoPointMap; // Serialized format (optional)
  name?: string;
  locationId?: string;
  dateName: string;
  address?: string;
  city?: string;
  state?: string;
  description?: string;
}

interface EventDateTimeSlotDeserialized {
  dateName: string;
  startTime: TimestampMap; // Serialized format
  endTime: TimestampMap; // Serialized format
}

interface EventTicketDeserialized {
  name: string;
  totalQuantity: number;
  validTimeSlots: EventDateTimeSlotDeserialized[]; // Uses deserialized slot
  description?: string;
  price: LivitPrice; // Assumes LivitPrice is already in correct map format from Flutter
  maxQuantityPerUser?: number;
}

interface EventDataDeserialized {
  name: string;
  description?: string;
  dates: EventDateDeserialized[];
  locations: EventLocationDeserialized[];
  tickets: EventTicketDeserialized[];
  promoterIds: string[];
}

// --- Restored serializeEventData Function ---
function serializeEventData(data: EventDataDeserialized): EventData {
  if (!data) {
    throw new Error("Input data cannot be null or undefined.");
  }

  // Helper to convert TimestampMap to Firestore Timestamp
  const toTimestamp = (tsMap: TimestampMap): admin.firestore.Timestamp => {
    if (typeof tsMap?.seconds !== 'number' || typeof tsMap?.nanoseconds !== 'number') {
      throw new Error(`Invalid Timestamp format: ${JSON.stringify(tsMap)}`);
    }
    return new admin.firestore.Timestamp(tsMap.seconds, tsMap.nanoseconds);
  };

  // Helper to convert GeoPointMap to Firestore GeoPoint
  const toGeoPoint = (geoMap?: GeoPointMap): admin.firestore.GeoPoint | null => {
    if (!geoMap) return null;
    if (typeof geoMap?.latitude !== 'number' || typeof geoMap?.longitude !== 'number') {
      throw new Error(`Invalid GeoPoint format: ${JSON.stringify(geoMap)}`);
    }
    // Validate latitude and longitude ranges if necessary
    if (geoMap.latitude < -90 || geoMap.latitude > 90 || geoMap.longitude < -180 || geoMap.longitude > 180) {
        throw new Error(`Invalid GeoPoint coordinates: lat=${geoMap.latitude}, lon=${geoMap.longitude}`);
    }
    return new admin.firestore.GeoPoint(geoMap.latitude, geoMap.longitude);
  };

  // Helper to serialize EventDateTimeSlot
  const serializeSlot = (slot: EventDateTimeSlotDeserialized): EventDateTimeSlot => ({
    ...slot,
    startTime: toTimestamp(slot.startTime),
    endTime: toTimestamp(slot.endTime),
  });

  return {
    name: data.name,
    description: data.description,
    promoterIds: data.promoterIds,
    dates: data.dates.map((date: EventDateDeserialized): EventDate => ({
      ...date,
      startTime: toTimestamp(date.startTime),
      endTime: toTimestamp(date.endTime),
    })),
    locations: data.locations.map((location: EventLocationDeserialized): EventLocation => ({
      ...location,
      geopoint: toGeoPoint(location.geopoint), // Convert GeoPoint map if it exists
    })),
    tickets: data.tickets.map((ticket: EventTicketDeserialized): EventTicket => ({
      ...ticket,
      price: ticket.price, // Assuming LivitPrice is already a map { amount: number, currency: string }
      validTimeSlots: ticket.validTimeSlots.map(serializeSlot), // Serialize nested slots
    })),
  };
}

export { 
  EventDate, 
  EventLocation, 
  EventTicket, 
  EventDateTimeSlot, 
  EventData,
  EventDateDeserialized,
  EventLocationDeserialized,
  EventTicketDeserialized,
  EventDateTimeSlotDeserialized,
  EventDataDeserialized,
  serializeEventData
};
  
  