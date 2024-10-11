import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
//const  {log}= require("firebase-functions/logger");
import { UsernameAlreadyTakenError, UserAlreadyExistsError } from "./errors";

admin.initializeApp();

const db = admin.firestore();

//Function to create user and username in a transaction
export const createUserAndUsername = functions.https.onCall(async (request) => {
  const {userId, username, userType, name} = request.data;

  if (!userId) {
    throw new functions.https.HttpsError("invalid-argument", "Missing userId");
  }
  if (!username) {
    throw new functions.https.HttpsError("invalid-argument", "Missing username");
  }
  if (!userType) {
    throw new functions.https.HttpsError("invalid-argument", "Missing userType");
  }
  if (!name) {
    throw new functions.https.HttpsError("invalid-argument", "Missing name");
  }

  const usernameDocRef = db.collection("usernames").doc(username);
  const userDocRef = db.collection("users").doc(userId);

  // Firestore transaction to ensure atomic write
  try {
    await db.runTransaction(async (transaction) => {
      const usernameDoc = await transaction.get(usernameDocRef);
      if (usernameDoc.exists) {
        // eslint-disable-next-line max-len
        throw new UsernameAlreadyTakenError();
      }

      const userDoc = await transaction.get(userDocRef);
      if (userDoc.exists) {
        throw new UserAlreadyExistsError();
      }

      // Create username document
      transaction.set(usernameDocRef, {userId});

      // Create user document
      transaction.set(userDocRef, {
        userType,
        name,
        username,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    return {message: "UserAndUsernameCreatedSuccessfully"};
  } catch (error) {
    if (error instanceof UsernameAlreadyTakenError) {
      throw new functions.https.HttpsError("already-exists", error.name);
    } else if (error instanceof UserAlreadyExistsError) {
      throw new functions.https.HttpsError("already-exists", error.name);
    } else {
      // eslint-disable-next-line max-len
      throw new functions.https.HttpsError("internal", "An unknown error occurred");
    }
  }
});

