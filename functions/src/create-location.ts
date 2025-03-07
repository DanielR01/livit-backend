import * as functions from "firebase-functions";
import admin from './firebase-admin';
import { ErrorCode } from "./errors";

const db = admin.firestore();


export const createLocation = functions.https.onCall(async (request: functions.https.CallableRequest) => {
    await validateUser(request);
  
    const { name, description, address, city, state } = request.data;
    const userId = request.auth?.uid;
  
    if (!userId || !name || !address || !city || !state) {
      throw new functions.https.HttpsError('invalid-argument', ErrorCode.MISSING_PARAMS);
    }
  
    if (name.length < 3 || name.length > 30 || !/^[a-zA-Z0-9_ ]+$/.test(name)) {
      throw new functions.https.HttpsError(
        'invalid-argument', 
        ErrorCode.LOCATION_NAME_NOT_VALID
      );
    }
    if (description != null){
      if (description.length > 100) {
        throw new functions.https.HttpsError('invalid-argument', ErrorCode.LOCATION_DESCRIPTION_TOO_LONG);
      }
    }
  
    
      let locationId: string = '';
      await db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(db.collection('users').doc(userId));
        
        if (!userDoc.exists) {
          throw new functions.https.HttpsError('not-found', ErrorCode.USER_NOT_FOUND);
        }
        
        if (userDoc.data()?.userType !== 'promoter') {
          throw new functions.https.HttpsError('permission-denied', ErrorCode.USER_NOT_PROMOTER);
        }
  
        const userLocations = userDoc.data()?.locations || [];
        for (const location of userLocations) {
          if (location.name === name) {
            throw new functions.https.HttpsError('already-exists', ErrorCode.LOCATION_ALREADY_EXISTS);
          }
        }
  
        const locationData = {
          name,
          description,
          address,
          city,
          state,
          userId,
          createdAt: admin.firestore.Timestamp.now(),
          media: null,
          schedule: null,
        };
  
        const locationRef = db.collection('locations').doc();
        locationId = locationRef.id;
        transaction.set(locationRef, locationData);
        userLocations.push(locationId);
        transaction.update(userDoc.ref, { locations: userLocations });
        const privateLocationDataRef = locationRef.collection('private').doc('privateData');
        transaction.set(privateLocationDataRef, { 
          defaultScanners: [],
        });
      });
      if (locationId === '') {
        throw new functions.https.HttpsError('not-found', ErrorCode.LOCATION_ID_NOT_FOUND);
      }
      return { status: 'success', locationId };
  });
const validateUser = async (request: functions.https.CallableRequest) => {
    if (!request.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    } else if (request.auth.token.email_verified === false) {
      throw new functions.https.HttpsError('unauthenticated', 'User email not verified');
    }
  };