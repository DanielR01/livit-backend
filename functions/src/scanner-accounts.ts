import * as functions from "firebase-functions";
import admin, { db } from './firebase-admin';
import { v4 as uuid } from 'uuid';
import * as nodemailer from 'nodemailer';
import { defineSecret } from 'firebase-functions/params'

const gmailEmail = process.env.GMAIL_EMAIL;
const gmailPassword = defineSecret('GMAIL_PASSWORD');

const namecheapEmail = process.env.NAMECHEAP_EMAIL;
const namecheapPassword = defineSecret('NAMECHEAP_PASSWORD');

const useGmail = process.env.USE_GMAIL;
const projectId = process.env.GCLOUD_PROJECT;

function getTransporter() {
  const useGmailb = useGmail === 'true';
  
  if (useGmailb) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailEmail,
        pass: gmailPassword.value()
      }
    });
  } else {
    return getNamecheapTransporter();
  }
}

function getNamecheapTransporter() {
  // Validate config
  if (!namecheapEmail || !namecheapPassword.value()) {
    console.error('[getNamecheapTransporter] Missing Namecheap email configuration');
    throw new functions.https.HttpsError(
      'failed-precondition', 
      'Email service not properly configured'
    );
  }
  
  // Create and return the transporter
  return nodemailer.createTransport({
    host: 'mail.privateemail.com',
    port: 465,
    secure: true,
    auth: {
      user: namecheapEmail,
      pass: namecheapPassword.value()
    },
    tls: { rejectUnauthorized: false }
  });
}

export const createScanner = functions.https.onCall({secrets: [gmailPassword, namecheapPassword]},
  async (request) => {
    try {
      validateUser(request);
      console.log("[createScanner] User validation passed");

      const { promoterId, locationIds, eventIds, name } = request.data;

      // Type validation
      if (typeof promoterId !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'promoterId must be a string');
      }

      if (!Array.isArray(locationIds)) {
        throw new functions.https.HttpsError('invalid-argument', 'locationIds must be an array');
      }

      if (!locationIds.every(id => typeof id === 'string')) {
        throw new functions.https.HttpsError('invalid-argument', 'all locationIds must be strings');
      }

      if (eventIds && !Array.isArray(eventIds)) {
        throw new functions.https.HttpsError('invalid-argument', 'eventIds must be an array');
      }

      if (eventIds && !eventIds.every((id: string) => typeof id === 'string')) {
        throw new functions.https.HttpsError('invalid-argument', 'all eventIds must be strings');
      }

      if (name && typeof name !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'name must be a string');
      }

      // Rest of your existing validation
      if (!promoterId || locationIds.length === 0) {
        console.error("[createScanner] Missing required parameters");
        throw new functions.https.HttpsError('invalid-argument', 'Missing required parameters');
      }

      const userId = request.auth?.uid;

      if (!userId || !promoterId) {
        console.error("[createScanner] Missing required parameters");
        throw new functions.https.HttpsError('invalid-argument', 'Missing required parameters');
      }

      console.log("[createScanner] Fetching promoter data for:", promoterId);
      // Get promoter email
      const promoterDoc = await db.doc(`users/${promoterId}`).get();
      if (!promoterDoc.exists) {
        console.error("[createScanner] Promoter not found:", promoterId);
        throw new functions.https.HttpsError('not-found', 'Promoter not found');
      }
      
      const promoterPrivateData = await db.doc(`users/${promoterId}/private/privateData`).get();
      if (!promoterPrivateData.exists || !promoterPrivateData.data()?.email) {
        console.error("[createScanner] Promoter has no email registered");
        throw new functions.https.HttpsError('invalid-argument', 'Promoter has no email registered');
      }
      console.log("[createScanner] Promoter data retrieved successfully");

      // Create user with retry logic for duplicate IDs
      let user = null;
      let scannerId = '';
      let scannerUuid = '';
      let email = '';
      let attempts = 0;
      const maxAttempts = 10;
      
      // First try using the name if provided
      if (name && attempts === 0) {
        try {
          // Format name for email (lowercase, remove spaces, limit length)
          const formattedName = promoterDoc.data()?.name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0,10) + '-' + name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
          if (formattedName.length >= 3) { // Only use name if it's at least 3 chars after formatting
            email = `${formattedName}@scanners.${projectId}.com`;
            scannerId = uuid();
            
            console.log(`[createScanner] Trying to create scanner with name-based email: ${email}`);
            
            // Try to create user with name-based email
            user = await admin.auth().createUser({
              uid: scannerId,
              email,
              password: generatePassword(12),
              emailVerified: true,
              disabled: false,
            });
            console.log(`[createScanner] Successfully created scanner with name-based email: ${email}`);
          } else {
            console.log(`[createScanner] Name too short after formatting: ${formattedName}, using fallback method`);
          }
        } catch (error: any) {
          if (error.code === 'auth/uid-already-exists' || error.code === 'auth/email-already-exists') {
            console.log(`[createScanner] Name-based email ${email} already exists, falling back to UUID method`);
            // Will continue to the UUID-based approach below
          } else {
            // For any other error, stop and propagate
            throw error;
          }
        }
      }
      
      // Fall back to UUID method if name-based approach failed or wasn't attempted
      while (!user && attempts < maxAttempts) {
        attempts++;
        try {
      // Generate unique credentials
          scannerUuid = uuid().replace(/-/g, '').substring(0, 4 + 2 * attempts);
          scannerId = promoterDoc.data()?.name.toLowerCase().replace(/ /g, '-').substring(0,10) + '-' + scannerUuid;
          email = `${scannerId}@scanners.${projectId}.com`;
          console.log(`[createScanner] Attempt ${attempts}: Generated scanner email: ${email}`);
          
          // Try to create user with generated ID
          user = await admin.auth().createUser({
            uid: scannerId,
        email,
            password: generatePassword(12),
        emailVerified: true,
        disabled: false,
      });
          console.log(`[createScanner] Success on attempt ${attempts}: Firebase Auth user created with ID: ${user.uid}`);
        } catch (error: any) {
          if (error.code === 'auth/uid-already-exists' || error.code === 'auth/email-already-exists') {
            console.log(`[createScanner] Attempt ${attempts}: ID/Email already exists, retrying...`);
            // Continue the loop to try again with a new ID
          } else {
            // For any other error, stop retrying and propagate the error
            throw error;
          }
        }
      }
      
      // Check if we exceeded max attempts
      if (!user) {
        console.error(`[createScanner] Failed to create unique scanner after ${maxAttempts} attempts`);
        throw new functions.https.HttpsError(
          'aborted', 
          `Failed to create unique scanner after ${maxAttempts} attempts`
        );
      }

      // Set scanner name - use provided name or generate from scannerId
      const scannerName = name || `Scanner ${scannerUuid}`;
      
      console.log("[createScanner] Setting custom claims for scanner");
      // Set custom claims for scanner access
      await admin.auth().setCustomUserClaims(user.uid, {
        userType: 'scanner',
        locationIds: locationIds || [],
        eventIds: eventIds || [],
        promoterId: promoterId
      });
      console.log("[createScanner] Custom claims set successfully");
      console.log("[createScanner] Storing scanner metadata in Firestore");
    
      await db.doc(`scanners/${user.uid}`).set({
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        locationIds: locationIds || [],
        eventIds: eventIds || [],
        promoterId: promoterId,
        credentialsSent: false,
        name: scannerName,
        email: email
      });
      console.log("[createScanner] Scanner metadata stored successfully");

      console.log("[createScanner] Generating password reset link");
      // Generate password reset link
      const resetLink = await admin.auth().generatePasswordResetLink(email);
      console.log("[createScanner] Password reset link generated");

      console.log("[createScanner] Preparing email to promoter");
      // Prepare email to promoter
      const msg = {
        to: promoterPrivateData.data()?.email,
        from: `Livit Scanner Support <${useGmail === 'true' ? gmailEmail : process.env.NAMECHEAP_EMAIL}>`,
        subject: 'Scanner Account Setup',
        html: `
          <p>Scanner account created: ${email}</p>
          <p>Use this link to set the password:</p>
          <a href="${resetLink}">Set Password</a>
          <p>Link expires in 1 hour, after that you will need to request a new link from the promoter account.</p>
        `
      };

      try {
        console.log("[createScanner] Validating email configuration");
        validateEmailConfig();
            
        // Get the transporter at runtime
        const transporter = getTransporter();
        console.log("[createScanner] Sending email via:", useGmail === 'true' ? "Gmail" : "Namecheap");
        await transporter.sendMail(msg);
        console.log("[createScanner] Email sent successfully");
            
        console.log("[createScanner] Updating credentials sent status");
        // Update credentials sent status
        await db.doc(`scanners/${user.uid}`).update({
          credentialsSent: true,
          credentialsSentAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log("[createScanner] Credentials sent status updated");
            
      } catch (error) {
        // Store error in Firestore but use enhanced error handling
        await db.doc(`scanners/${user.uid}`).update({
          credentialsSent: false,
          sendError: (error as Error).message,
          errorDetails: {
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            transporterType: useGmail === 'true' ? 'Gmail' : 'Namecheap'
          }
        });
            
        // Use enhanced error handling
        handleError('Sending scanner credentials email', error, {
          scannerId: user.uid,
          email: email,
          transporterType: useGmail === 'true' ? 'Gmail' : 'Namecheap',
          promoterId
        });
      }

      console.log("[createScanner] Function completed successfully");
      return { success: true, userId: user.uid };
    } catch (error) {
      handleError('Creating scanner account', error, {
        promoterId: request.data?.promoterId,
        userId: request.auth?.uid,
        hasLocationIds: !!request.data?.locationIds,
        hasEventIds: !!request.data?.eventIds
      });
      return { success: false, error: 'Error handled and thrown' };
    }
  }
);

function validateEmailConfig() {
  const useGmailb = useGmail === 'true';
  console.log('[validateEmailConfig] All env vars:', JSON.stringify(process.env));
  if (useGmailb) {
    // Only access the secret value when this function runs
    if (gmailEmail === '' || gmailPassword.value() === '') {
      console.error('[validateEmailConfig] Gmail email config missing');
      throw new functions.https.HttpsError('invalid-argument', 'Gmail email config missing');
    }
    console.log('[validateEmailConfig] Gmail config validated');
  } else {
    // Only validate Namecheap config when Namecheap is active
    if (!process.env.NAMECHEAP_EMAIL || !process.env.NAMECHEAP_PASSWORD) {
      console.error('[validateEmailConfig] Namecheap email config missing');
      throw new functions.https.HttpsError('invalid-argument', 'Namecheap email config missing');
    }
    console.log('[validateEmailConfig] Namecheap config validated');
  }
}

const generatePassword = (length: number) => {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789*#$%&/()=?¡¿';
  return Array.from({ length }, () => 
    charset[Math.floor(Math.random() * charset.length)]
  ).join('');
};

interface UpdateScannerAccessRequest {
  scannerId: string;
  promoterId: string;
  addLocationIds?: string[];
  removeLocationIds?: string[];
  addEventIds?: string[];
  removeEventIds?: string[];
}
  
export const updateScannerAccess = functions.https.onCall(
  async (request: functions.https.CallableRequest<UpdateScannerAccessRequest>) => {
    const data = request.data;
    const auth = request.auth;
      
    try {
      validateUser(request);
      // Verify promoter permissions
      if (!auth || auth.token.promoterId !== data.promoterId) {
        throw new functions.https.HttpsError('permission-denied', 'Not authorized to modify scanner access');
      }
      
      // Get current claims
      const user = await admin.auth().getUser(data.scannerId);
      const currentClaims = user.customClaims || {};
      
      // Verify scanner belongs to promoter
      if (currentClaims.promoterId !== data.promoterId) {
        throw new functions.https.HttpsError('permission-denied', 'Scanner does not belong to this promoter');
      }
      
      // Validate all locations and events being modified
      const allLocationIds = [
        ...(data.addLocationIds || []),
        ...(data.removeLocationIds || [])
      ];
      const allEventIds = [
        ...(data.addEventIds || []),
        ...(data.removeEventIds || [])
      ];
      await verifyScannerValidity(data.promoterId, allLocationIds, allEventIds);
      
      // Update claims with helper function
      const newClaims = {
        ...currentClaims,
        locationIds: updateIds(
          currentClaims.locationIds || [],
          data.addLocationIds || [],
          data.removeLocationIds || []
        ),
        eventIds: updateIds(
          currentClaims.eventIds || [],
          data.addEventIds || [],
          data.removeEventIds || []
        )
      };
      
      // Set new claims
      await admin.auth().setCustomUserClaims(data.scannerId, newClaims);
      
      // Update Firestore document
      await db.doc(`scanners/${data.scannerId}`).update({
        locationIds: newClaims.locationIds,
        eventIds: newClaims.eventIds,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return { success: true, claims: newClaims };
    } catch (error) {
      handleError('Updating scanner access', error, {
        scannerId: data.scannerId,
        promoterId: data.promoterId,
        addLocationIds: data.addLocationIds,
        removeLocationIds: data.removeLocationIds,
        addEventIds: data.addEventIds,
        removeEventIds: data.removeEventIds
      });
      return { success: false, error: 'Error handled and thrown' };
    }
  }
);
  
// Generic version of the updateIds helper
function updateIds(
  current: string[],
  add: string[],
  remove: string[]
): string[] {
  const updated = new Set(current);
  add.forEach(id => updated.add(id));
  remove.forEach(id => updated.delete(id));
  return Array.from(updated);
}

async function verifyScannerValidity(
  promoterId: string,
  locationIds: string[] | undefined,
  eventIds: string[] | undefined
) {
  // Verify locations
  if (locationIds && locationIds.length > 0) {
    const locations = await Promise.all(
      locationIds.map(id => db.doc(`locations/${id}`).get())
    );
    
    const invalidLocation = locations.find(locationDoc => 
      !locationDoc.exists || locationDoc.data()?.promoterId !== promoterId
    );
    
    if (invalidLocation) {
      throw new functions.https.HttpsError(
        'permission-denied', 
        'One or more locations do not exist or belong to another promoter'
      );
    }
  }

  // Verify events
  if (eventIds && eventIds.length > 0) {
    const events = await Promise.all(
      eventIds.map(id => db.doc(`events/${id}`).get())
    );
    
    const invalidEvent = events.find(eventDoc => 
      !eventDoc.exists || eventDoc.data()?.promoterId !== promoterId
    );
    
    if (invalidEvent) {
      throw new functions.https.HttpsError(
        'permission-denied', 
        'One or more events do not exist or belong to another promoter'
      );
    }
  }
}

export const deleteScanner = functions.https.onCall(
  async (request) => {
    const { scannerId } = request.data;
    try {
      validateUser(request);
      if (!scannerId) {
        throw new functions.https.HttpsError('invalid-argument', 'Scanner ID is required');
      }
      const scannerDoc = await db.doc(`scanners/${scannerId}`).get();
      if (!scannerDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Scanner not found');
      }
      const promoterId = scannerDoc.data()?.promoterId;
      if (promoterId !== request.auth?.uid) {
        throw new functions.https.HttpsError('permission-denied', 'Not authorized to delete this scanner');
      }
      await admin.auth().deleteUser(scannerId);
      await db.doc(`scanners/${scannerId}`).delete();

      return { success: true };
    } catch (error) {
      handleError('Deleting scanner account with id: ' + scannerId, error);
      return { success: false, error: 'Error handled and thrown' };
    }
  }
);

function validateUser(request: any) {
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  } else if (request.auth.token.email_verified === false) {
    throw new functions.https.HttpsError('unauthenticated', 'User email not verified');
  }
}

// Add this helper function for better error handling
function handleError(operation: string, error: any, context: Record<string, any> = {}) {
  // Create detailed error object with context
  const errorDetails = {
    operation,
    timestamp: new Date().toISOString(),
    context,
    originalError: {
      message: error.message || 'Unknown error',
      code: error.code,
      stack: error.stack
    }
  };
  
  // Log detailed error information
  console.error(`[ERROR] ${operation} failed:`, JSON.stringify(errorDetails, null, 2));
  
  // Determine appropriate error code
  let code = 'internal';
  let message = `Operation failed: ${operation}`;
  
  if (error instanceof functions.https.HttpsError) {
    code = error.code;
    message = error.message;
  } else if (error.code === 'auth/user-not-found') {
    code = 'not-found';
    message = 'Scanner account not found';
  } else if (error.code === 'auth/email-already-exists') {
    code = 'already-exists';
    message = 'Scanner email already exists';
  } else if (error.code?.includes('permission')) {
    code = 'permission-denied';
    message = 'Permission denied: ' + error.message;
  }
  
  // Throw enhanced error with details
  throw new functions.https.HttpsError(code as any, message, errorDetails);
}
