import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { UsernameAlreadyTakenError, UserAlreadyExistsError, MissingParametersError, NotValidUserDataError, ErrorCode, LocationFileSizeLimitError, LocationNotFoundError, LocationPermissionDeniedError, BaseError } from "./errors";
import { getStorage } from 'firebase-admin/storage';
import { onObjectFinalized, StorageObjectData } from 'firebase-functions/v2/storage';
import { logger } from 'firebase-functions';

admin.initializeApp({
  credential: admin.credential.cert(require('../thelivitapp-firebase-adminsdk-wy62v-0e5de686ba.json')),
  storageBucket: 'thelivitapp.appspot.com'
});

const db = admin.firestore();

//Function to create user and username in a transaction
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
        transaction.set(usernameDocRef, {
          userId, 
          setAt
        });
        
        // Create user document
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

      return { 
        status: "success",
      };
    } catch (error) {
      throw error;
    }
  } catch (error) {
    if (error instanceof MissingParametersError) {
      throw new functions.https.HttpsError("invalid-argument", error.code);
    } else if (error instanceof UsernameAlreadyTakenError) {
      throw new functions.https.HttpsError("already-exists", error.code);
    } else if (error instanceof UserAlreadyExistsError) {
      throw new functions.https.HttpsError("already-exists", error.code);
    } else if (error instanceof NotValidUserDataError) {
      throw new functions.https.HttpsError("invalid-argument", error.code);
    } else {
      logger.error(`An unknown error occurred: ${error}`);
      throw new functions.https.HttpsError("internal", "An unknown error occurred:");
    }
  }
});

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

interface LocationMediaUploadRequest {
  locationId: string;
  fileSizes: number[];
  fileTypes: string[];
  names: string[];
}

export const getLocationMediaUploadUrl = functions.https.onCall(async (request) => {
  try {
    await validateUser(request);

    const { locationId, fileSizes, fileTypes, names} = request.data as LocationMediaUploadRequest;

    if (!locationId || !fileSizes || !fileTypes || fileSizes.length === 0 || fileTypes.length === 0 || !names || names.length === 0) {
      throw new MissingParametersError();
    } else if (fileSizes.length !== fileTypes.length || fileSizes.length !== names.length) {
      throw new functions.https.HttpsError('invalid-argument', ErrorCode.LOCATION_FILES_NOT_MATCH);
    }

    const locationPath = `locations/${locationId}`;
    const locationDoc = await db.doc(locationPath).get();

    if (!locationDoc.exists) {
      throw new LocationNotFoundError();
    }

    const userId = locationDoc.data()?.userId;
    
    if (userId !== request.auth?.uid) {
      throw new LocationPermissionDeniedError();
    }

    for (let i = 0; i < fileSizes.length; i++) {
      const fileSize = fileSizes[i];
      const fileType = fileTypes[i].split('/')[0];
      const fileCategory = fileType.toUpperCase() as 'VIDEO' | 'IMAGE';
      const MAX_SIZE_MB = FILE_LIMITS[fileCategory].MAX_SIZE_MB;
      const fileSizeMB = fileSize / (1024 * 1024);

      if (fileSizeMB > MAX_SIZE_MB) {
        throw new LocationFileSizeLimitError();
      }
    }

    const signedUrls = [];
    for (let i = 0; i < fileSizes.length; i++) {
      const path = `locations/${locationId}/${names[i]}`;

      const file = admin.storage().bucket().file(path);
      
      const [signedUrl] = await file.getSignedUrl({
          version: 'v4',
          action: 'write',
          expires: Date.now() + 2 * 60 * 1000,
          contentType: fileTypes[i],
        });
      console.log(`📑 Signed URL: ${signedUrl}`);
      signedUrls.push({ signedUrl, path });
    }
    return signedUrls;
  } catch (error) {
    return handleError(error);
  }
});

export const setUserProfileCompleted = functions.https.onCall(async (request) => {
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
  const privateDataDocRef = userDocRef.collection('private').doc('privateData');
  const privateData = (await privateDataDocRef.get()).data();
  if (!privateData) {
    throw new functions.https.HttpsError('not-found', ErrorCode.USER_PRIVATE_DATA_NOT_FOUND);
  }
  if (userData.interests == null || ((userData.description == null || userData.locations == null) && userData.userType === 'promoter') ) {
    throw new functions.https.HttpsError('invalid-argument', ErrorCode.USER_NOT_COMPLETED);
  }
  await userDocRef.update({ isProfileCompleted: true });
});

export const validateUploadedFile = onObjectFinalized({region: 'southamerica-east1'}, async (event) => {
  const name = event.data.name;
  if (!name) return;

  const ALLOWED_PATHS = ['locations/', 'users/', 'events/', 'tickets/'];

  if (!ALLOWED_PATHS.some(path => name.startsWith(path))) {
    await reportUnauthorizedUpload('INVALID_PATH', { path: name });
    await deleteUnauthorizedFile(event.data);
    return;
  }

  try {
    if (name.startsWith('locations/')) {
      const locationId = name.split('/')[1];
      const locationDoc = await db.collection('locations').doc(locationId).get();

      // Verify location exists
      if (!locationDoc.exists) {
        await reportUnauthorizedUpload('LOCATION_NOT_FOUND', { path: name, locationId });
        await deleteUnauthorizedFile(event.data);
        return;
      }

      // Count existing files
      const [files] = await admin.storage()
        .bucket()
        .getFiles({ prefix: `locations/${locationId}/` });
      
      const actualFiles = files.filter(file => 
        !file.name.endsWith('/') && 
        file.metadata?.size && 
        Number(file.metadata.size) > 0
      );
      const imageFiles = actualFiles.filter(file => file.name?.startsWith('image/'));
      const videoFiles = actualFiles.filter(file => file.name?.startsWith('video/') && !file.name?.endsWith('/cover.'));

      if (imageFiles.length - videoFiles.length > FILE_LIMITS.MAX_FILES || videoFiles.length > FILE_LIMITS.MAX_FILES) {
        await reportUnauthorizedUpload('FILES_LIMIT_EXCEEDED', { 
          path: name,
          filesCount: actualFiles.length,
          maxFiles: FILE_LIMITS.MAX_FILES 
        });
        await deleteUnauthorizedFile(event.data);
        return;
      }

      // Validate file type and size
      const contentType = event.data.contentType || '';
      const size = event.data.size || 0;

      if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
        await reportUnauthorizedUpload('INVALID_FILE_TYPE', { path: name, contentType });
        await deleteUnauthorizedFile(event.data);
        return;
      }

      const fileSizeMB = size / (1024 * 1024);
      const isVideo = contentType.startsWith('video/');
      const maxSize = isVideo ? FILE_LIMITS.VIDEO.MAX_SIZE_MB : FILE_LIMITS.IMAGE.MAX_SIZE_MB;

      if (fileSizeMB > maxSize) {
        await reportUnauthorizedUpload('FILE_TOO_LARGE', { 
          path: name, 
          size: fileSizeMB,
          maxSize,
          fileType: isVideo ? 'VIDEO' : 'IMAGE'
        });
        await deleteUnauthorizedFile(event.data);
        return;
      }

      console.log(`✅ File validated successfully: ${name}`);
      const locationData = locationDoc.data();
      const nameParts = name.split('/');
      console.log('📝 Processing file:', { name, nameParts });
      
      if (locationData) {
        let media = locationData.media || null;
        if (media == null) {
          console.log('📁 Initializing empty media object');
          media = {
            mainFile: null,
            secondaryFiles: []
          };
        }

        if (nameParts[2] === 'main_file') {
          console.log('🎯 Processing main file:', nameParts[3]);
          if (nameParts[3].split('.')[0] === 'image') {
            console.log('🖼️ Setting main image:', name);
            media.mainFile = {
              url: name,
              type: 'image',
            }
          } else if (nameParts[3].split('.')[0] === 'cover') {
            console.log('🎬 Setting video cover:', name);
            if (media.mainFile) {
              media.mainFile.coverUrl = name;
            } else {
              media.mainFile = {
                url: null,
                type: 'video',
                coverUrl: name,
              }
            }
          } else if (nameParts[3].split('.')[0] === 'video') {
            console.log('🎥 Setting video file:', name);
            if (media.mainFile) {
              media.mainFile.videoUrl = name;
            } else {
              media.mainFile = {
                url: name,
                type: 'video',
                coverUrl: null,
              }
            }
          }
        }

        if (nameParts[2] === 'secondary_files') {
          const fileType = nameParts[4].split('.')[0];
          const index = nameParts[3].split('_')[1];
          console.log('📑 Processing secondary file:', { fileType, index });

          if (media.secondaryFiles == null) {
            media.secondaryFiles = [];
          }

          if (fileType === 'image') {
            console.log('🖼️ Adding secondary image at index', index);
            media.secondaryFiles.push({
              url: name,
              type: 'image',
            });
          } else if (fileType === 'video') {
            console.log('🎥 Setting secondary video at index', index);
            media.secondaryFiles[index].url = name;
          } else if (fileType === 'cover') {
            console.log('🎬 Adding secondary video cover at index', index);
            media.secondaryFiles.push({
              url: null,
              type: 'video',
              coverUrl: name,
            });
          }
        }
        console.log('💾 Updating location with media:', media);
        await locationDoc.ref.update({ media });
      }
    }
  } catch (error) {
    await reportUnauthorizedUpload('VALIDATION_ERROR', { 
      path: name, 
      error: error instanceof Error ? error.message : String(error) 
    });
    await deleteUnauthorizedFile(event.data);
  }
});

const deleteUnauthorizedFile = async (object: StorageObjectData) => {
  logger.info(`Deleting unauthorized file: ${object.name}`);
  const name = object.name;
  if (!name) return;
  try {
    const file = getStorage().bucket(object.bucket).file(name);
    await file.delete();
  } catch (error) {
  }
};

const validateUser = async (request: functions.https.CallableRequest) => {
  if (!request.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
};

const handleError = (error: unknown) => {
  if (error instanceof BaseError) {
    logger.error(`Error: ${error.code}`);
    throw new functions.https.HttpsError(error.httpCode, error.code);
  }
  logger.error('Unexpected error:', error);
  throw new functions.https.HttpsError('internal', 'An unexpected error occurred');
};

const reportUnauthorizedUpload = async (reason: string, details: Record<string, any>) => {
  // Create a structured log entry
  const logEntry = {
    severity: 'WARNING',
    message: 'Unauthorized upload detected',
    reason,
    timestamp: new Date().toISOString(),
    ...details,
    // Add metadata for better filtering
    labels: {
      type: 'security_event',
      category: 'unauthorized_upload',
      reason: reason
    }
  };

  // Log with structured data
  logger.warn('⚠️ Security Alert', logEntry);

  // Increment a counter in Firestore for monitoring
  try {
    const statsRef = db.collection('appStats').doc('security');
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
    logger.error('Failed to update security stats:', error);
  }
};


const FILE_LIMITS = {
  VIDEO: {
    MAX_SIZE_MB: 20,
    ALLOWED_TYPES: ['video/mp4', 'video/mov', 'video/avi', 'video/mkv']
  },
  IMAGE: {
    MAX_SIZE_MB: 5,
    ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/bmp', 'image/tiff', 'image/tif']
  },
  MAX_FILES: 7
} as const;