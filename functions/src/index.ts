import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { UsernameAlreadyTakenError, UserAlreadyExistsError, MissingParametersError, NotValidUserDataError } from "./errors";

admin.initializeApp();

const db = admin.firestore();

//Function to create user and username in a transaction
export const createUserAndUsername = functions.https.onCall(async (request) => {
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

    const usernameDocRef = db.collection("usernames").doc(username);
    const userDocRef = db.collection("users").doc(userId);
    const privateDataDocRef = userDocRef.collection("private").doc("privateData");

    let createdAt: FirebaseFirestore.Timestamp;
    let setAt: FirebaseFirestore.Timestamp;

    createdAt = admin.firestore.Timestamp.now();
    setAt = createdAt;
    

    // Firestore transaction to ensure atomic write
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

        // Create username document
        transaction.set(usernameDocRef, {userId, 
          setAt});
        
        // Create user document
        transaction.set(userDocRef, {
          userType,
          name,
          username,
          createdAt,
        });

        // Create private data document
        transaction.set(privateDataDocRef, {
          userType,
          phoneNumber,
          email,
          isProfileCompleted: false,
        });
        
      });

      return { 
        status: "success", 
        createdAt: createdAt.toDate().toISOString()
      };
    } catch (error) {
      throw error;
    }
  } catch (error) {
    if (error instanceof MissingParametersError) {
      throw new functions.https.HttpsError("invalid-argument", error.name);
    } else if (error instanceof UsernameAlreadyTakenError) {
      throw new functions.https.HttpsError("already-exists", error.name);
    } else if (error instanceof UserAlreadyExistsError) {
      throw new functions.https.HttpsError("already-exists", error.name);
    } else if (error instanceof NotValidUserDataError) {
      throw new functions.https.HttpsError("invalid-argument", error.name);
    } else {
      throw new functions.https.HttpsError("internal", "An unknown error occurred");
    }
  }
});
