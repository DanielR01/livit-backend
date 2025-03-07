import admin from './firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { onObjectFinalized, StorageObjectData } from 'firebase-functions/v2/storage';
import { logger } from 'firebase-functions';

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
        const locationDoc = await admin.firestore().collection('locations').doc(locationId).get();
  
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
  
        const locationData = locationDoc.data();
        const nameParts = name.split('/');
        
        if (locationData) {
          let media = locationData.media || null;
          if (media == null) {
            media = {
              mainFile: null,
              secondaryFiles: []
            };
          }
  
          if (nameParts[2] === 'main_file') {
            if (nameParts[3].split('.')[0] === 'image') {
              media.mainFile = {
                url: name,
                type: 'image',
              }
            } else if (nameParts[3].split('.')[0] === 'cover') {
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
              if (media.mainFile) {
                media.mainFile.url = name;
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
            if (media.secondaryFiles == null) {
              media.secondaryFiles = [];
            }
  
            if (fileType === 'image') {
              media.secondaryFiles.push({
                url: name,
                type: 'image',
              });
            } else if (fileType === 'video') {
              media.secondaryFiles[index].url = name;
            } else if (fileType === 'cover') {
              media.secondaryFiles.push({
                url: null,
                type: 'video',
                coverUrl: name,
              });
            }
          }
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

const reportUnauthorizedUpload = async (reason: string, details: Record<string, any>) => {
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

  logger.warn('⚠️ Security Alert', logEntry);

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