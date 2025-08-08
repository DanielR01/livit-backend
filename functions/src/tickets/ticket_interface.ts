import { Timestamp } from "firebase-admin/firestore";

export interface TicketStatus {
  available: number;
  reserved: number;
  sold: number;
}

export interface TicketReservation {
  userId: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  reservationTime: Timestamp;
  expirationTime: Timestamp;
  status: 'pending' | 'completed' | 'expired' | 'cancelled';
}

export interface TicketWaitlist {
  userId: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  requestTime: Timestamp;
  notificationSent: boolean;
  notificationTime?: Timestamp;
  expirationTime?: Timestamp;
  status: 'waiting' | 'notified' | 'expired' | 'completed';
}

export interface TicketPurchaseRequest {
  userId: string;
  eventId: string;
  tickets: {
    ticketTypeId: string;
    quantity: number;
  }[];
}

export interface TicketReservationResult {
  success: boolean;
  reservationId?: string;
  error?: string;
  waitlisted?: boolean;
  waitlistId?: string;
  expiresAt?: Timestamp;
}

export interface TicketInventory {
  eventId: string;
  ticketTypeId: string;
  totalQuantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  soldQuantity: number;
  lastUpdated: Timestamp;
} 