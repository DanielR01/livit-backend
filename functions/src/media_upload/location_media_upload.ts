import admin from '../firebase-admin';
import { StorageObjectData } from 'firebase-functions/v2/storage';
import { FILE_LIMITS } from './constants';

export const validateLocationMediaUploadedFile = async (data: StorageObjectData) => {
    const name = data.name;
    if (!name) return;
  
    const ALLOWED_PATHS = ['locations/', 'users/', 'events/', 'tickets/'];
  
    if (!ALLOWED_PATHS.some(path => name.startsWith(path))) {
      throw new Error('INVALID_PATH');
    }
  
    
      if (name.startsWith('locations/')) {
        const locationId = name.split('/')[1];
        const locationDoc = await admin.firestore().collection('locations').doc(locationId).get();
  
        // Verify location exists
        if (!locationDoc.exists) {
          throw new Error('LOCATION_NOT_FOUND');
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
          throw new Error('FILES_LIMIT_EXCEEDED');
        }
  
        // Validate file type and size
        const contentType = data.contentType || '';
        const size = data.size || 0;
  
        if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
          throw new Error('INVALID_FILE_TYPE');
        }
  
        const fileSizeMB = size / (1024 * 1024);
        const isVideo = contentType.startsWith('video/');
        const maxSize = isVideo ? FILE_LIMITS.VIDEO.MAX_SIZE_MB : FILE_LIMITS.IMAGE.MAX_SIZE_MB;
  
        if (fileSizeMB > maxSize) {
          throw new Error('FILE_TOO_LARGE');
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
                media.mainFile.cover = {
                  url: name,
                  type: 'image',
                }
              } else {
                media.mainFile = {
                  url: null,
                  type: 'video',
                  cover: {
                    url: name,
                    type: 'image',
                  },
                }
              }
            } else if (nameParts[3].split('.')[0] === 'video') {
              if (media.mainFile) {
                media.mainFile.url = name;
              } else {
                media.mainFile = {
                  url: name,
                  type: 'video',
                  cover: {
                    url: null,
                    type: 'image',
                  },
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
                cover: {
                  url: name,
                  type: 'image',
                },
              });
            }
          }
          await locationDoc.ref.update({ media });
        }
      }
    
  };
  

