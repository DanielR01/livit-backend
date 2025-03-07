import * as functions from "firebase-functions";
import admin from './firebase-admin';
import { ErrorCode } from "./errors";

const db = admin.firestore();


export const updatePromoterUserNoLocations = functions.https.onCall(async (request: functions.https.CallableRequest) => {
  await validateUser(request);
  const userId = request.auth?.uid;
  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', ErrorCode.MISSING_PARAMS);
  }
  const userDocRef = db.collection('users').doc(userId);
  const userData = (await userDocRef.get()).data();
  if (!userData) {
    throw new functions.https.HttpsError('not-found', ErrorCode.USER_NOT_FOUND);
  }
  if (userData.userType !== 'promoter') {
    throw new functions.https.HttpsError('permission-denied', ErrorCode.USER_NOT_PROMOTER);
  }
  await userDocRef.update({ locations: [] });
  return { status: 'success' };
});



const validateUser = async (request: functions.https.CallableRequest) => {
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  } else if (request.auth.token.email_verified === false) {
    throw new functions.https.HttpsError('unauthenticated', 'User email not verified');
  }
};

export * from './create-user';
export * from './media-upload';
export * from './scanner-accounts';
export * from './create-location';