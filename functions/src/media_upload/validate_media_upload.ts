import { onObjectFinalized, StorageObjectData } from "firebase-functions/storage";
import admin from "../firebase-admin";
import { getStorage } from "firebase-admin/storage";
import { validateEventMediaUploadedFile } from "./event_media_upload";
import { validateLocationMediaUploadedFile } from "./location_media_upload";
import { debugLog } from "../utils/debug";

const DEBUG_CONTEXT = 'ValidateMediaUpload';

export const validateMediaUpload = onObjectFinalized({region: 'southamerica-east1'}, async (event) => {
  debugLog(DEBUG_CONTEXT, 'Validate media upload triggered');
  const name = event.data.name;
  if (!name) return;
  debugLog(DEBUG_CONTEXT, `Validating media upload`, name);

  const ALLOWED_PATHS = ['locations/', 'users/', 'events/', 'tickets/'];

  if (!ALLOWED_PATHS.some(path => name.startsWith(path))) {
    debugLog(DEBUG_CONTEXT, `Unauthorized upload detected`, name);
    await reportUnauthorizedUpload('INVALID_PATH', { path: name });
    await deleteUnauthorizedFile(event.data);
    return;
  }

  try {
    if (name.startsWith('locations/')) {
      debugLog(DEBUG_CONTEXT, `Validating location media upload`, name);
      await validateLocationMediaUploadedFile(event.data);
    } else if (name.startsWith('events/')) {
      debugLog(DEBUG_CONTEXT, `Validating event media upload`, name);
      await validateEventMediaUploadedFile(event.data);
    } 
  } catch (error) {
    debugLog(DEBUG_CONTEXT, `Validation error`, name);
    await reportUnauthorizedUpload('VALIDATION_ERROR', { 
      path: name, 
      error: error instanceof Error ? error.message : String(error) 
    });
    await deleteUnauthorizedFile(event.data);
  }
});

const deleteUnauthorizedFile = async (object: StorageObjectData) => {
  debugLog(DEBUG_CONTEXT, `Deleting unauthorized file`, object.name);
  const name = object.name;
  if (!name) return;
  try {
    const file = getStorage().bucket(object.bucket).file(name);
    await file.delete();
  } catch (error) {
  }
};

const reportUnauthorizedUpload = async (reason: string, details: Record<string, any>) => {
  debugLog(DEBUG_CONTEXT, `Reporting unauthorized upload`, reason);
  const logEntry = {
    severity: 'WARNING',
    message: 'Unauthorized upload detected',
    reason,
    timestamp: new Date().toISOString(),
    ...details,
    labels: {
      type: 'security_event',
      category: 'unauthorized_upload',
      reason: reason
    }
  };

  debugLog(DEBUG_CONTEXT, `⚠️ Security Alert`, JSON.stringify(logEntry));

  try {
    const statsRef = admin.firestore().collection('appStats').doc('security');
    await statsRef.set({
      unauthorizedUploads: admin.firestore.FieldValue.increment(1),
      [`unauthorizedUploads_${reason}`]: admin.firestore.FieldValue.increment(1),
      lastUnauthorizedUpload: admin.firestore.Timestamp.now(),
      recentIncidents: admin.firestore.FieldValue.arrayUnion({
        timestamp: new Date().toISOString(),
        reason,
        details
      })
    }, { merge: true });
  } catch (error) {
    debugLog(DEBUG_CONTEXT, `Failed to update security stats:`, error);
  }
};
