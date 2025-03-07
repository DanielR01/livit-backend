import * as functions from "firebase-functions";
import admin, { db } from './firebase-admin';
import { UsernameAlreadyTakenError, UserAlreadyExistsError, MissingParametersError, NotValidUserDataError, BaseError, ErrorCode } from "./errors";

export const createUserAndUsername = functions.https.onCall(async (request) => {
  await validateUser(request);

  try {
    const {userId, username, userType, name, phoneNumber, email} = request.data;
    if (!userId || !username || !userType || !name || (!phoneNumber && !email)) {
      throw new MissingParametersError();
    } else if (userId !== request.auth?.uid || 
              (phoneNumber !== '' && phoneNumber !== request.auth?.token?.phone_number) || 
              (email !== '' && email !== request.auth?.token?.email) ||
              username.length < 6 || username.length > 15 || !/^[a-z0-9_]+$/.test(username) ||
              name.length < 3 || name.length > 30 || !/^[a-zA-Z_ ]+$/.test(name)) {
      throw new NotValidUserDataError();
    }
      
    if (!userType) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'User type is required'
      );
    }
    
    // Validate userType is one of the allowed values
    if (!['customer', 'promoter', 'scanner'].includes(userType)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Invalid user type. Must be one of: customer, promoter, scanner'
      );
    }

    const usernameDocRef = db.collection("usernames").doc(username);
    const userDocRef = db.collection("users").doc(userId);
    const privateDataDocRef = userDocRef.collection("private").doc("privateData");

    let createdAt: FirebaseFirestore.Timestamp;
    let setAt: FirebaseFirestore.Timestamp;

    createdAt = admin.firestore.Timestamp.now();
    setAt = createdAt;
    
    try {
      await db.runTransaction(async (transaction) => {
        const usernameDoc = await transaction.get(usernameDocRef);
        if (usernameDoc.exists) {
          throw new UsernameAlreadyTakenError();
        }

        const userDoc = await transaction.get(userDocRef);
        if (userDoc.exists) {
          throw new UserAlreadyExistsError();
        }

        transaction.set(usernameDocRef, {
          userId: userId,
          setAt: setAt
        });

        transaction.set(userDocRef, {
            userType,
            name,
            username: username.toLowerCase(),
            createdAt: admin.firestore.Timestamp.now(),
            locations: null,
            description: null,
            interests: null,
            isProfileCompleted: false,
          });

        if (userType === 'promoter') {
            transaction.set(privateDataDocRef, {
              userType,
              phoneNumber,
              email,
              defaultScanners: [],
              defaultTickets: [],
            });
          } else {
            transaction.set(privateDataDocRef, {
              userType,
              phoneNumber,
              email,
            });
          }
      });
      
      // Set the custom claim
      await admin.auth().setCustomUserClaims(userId, {
        userType: userType,
      });

      return { success: true, userId: userId };
    } catch (error) {
      if (error instanceof BaseError) {
        throw error;
      }
      console.error('Transaction error:', error);
      throw new BaseError(ErrorCode.UNKNOWN_ERROR, 'User creation failed');
    }
  } catch (error) {
    if (error instanceof BaseError) {
      throw error;
    }
    console.error('Unexpected error:', error);
    throw new BaseError(ErrorCode.UNKNOWN_ERROR, 'Unexpected error occurred');
  }
});

function validateUser(request: any) {
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  } else if (request.auth.token.email_verified === false) {
    throw new functions.https.HttpsError('unauthenticated', 'User email not verified');
  }
}
