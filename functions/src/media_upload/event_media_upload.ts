import admin from '../firebase-admin';
import { StorageObjectData } from 'firebase-functions/v2/storage';
import { FILE_LIMITS } from './constants';
import { debugLog } from '../utils/debug';

const DEBUG_CONTEXT = 'EventMediaUpload';

// Function to validate event media file and update the event document
export const validateEventMediaUploadedFile = async (data: StorageObjectData) => {
  const filePath = data.name;
  if (!filePath) return;

  // Expected path format: events/{eventId}/{$index}/{fileType}.{extension}
  const pathParts = filePath.split('/');
  
  if (pathParts[0] !== 'events') {
    debugLog(DEBUG_CONTEXT, 'Not an event media file, ignoring:', filePath);
    return;
  }

  if (pathParts.length !== 4) {
    debugLog(DEBUG_CONTEXT, 'Invalid path format, ignoring:', filePath);
    throw new Error('INVALID_PATH_FORMAT');
  }

  const eventId = pathParts[1];
  const index = pathParts[2];
  const fileName = pathParts[3];
  
  debugLog(DEBUG_CONTEXT, `Processing event media file: ${fileName} for event: ${eventId}`);

  const fileNameParts = fileName.split('.');
  const fileType = fileNameParts[0];

  // Get file metadata
  const contentType = data.contentType || '';
  const isVideo = contentType.startsWith('video/');
  const isImage = contentType.startsWith('image/');
  
  const fileSizeMB = data.size / (1024 * 1024);

  if (isImage) {
    if (!(fileType === 'image' || fileType === 'cover')) {
      debugLog(DEBUG_CONTEXT, 'Invalid file type:', contentType);
      throw new Error('INVALID_FILE_TYPE');
    }
    if (!FILE_LIMITS.IMAGE.ALLOWED_TYPES.includes(contentType as any)) {
      debugLog(DEBUG_CONTEXT, 'Invalid file content type:', contentType);
      throw new Error('INVALID_FILE_EXTENSION');
    }
    if (fileSizeMB > FILE_LIMITS.IMAGE.MAX_SIZE_MB) {
      debugLog(DEBUG_CONTEXT, 'File size exceeds limit:', fileSizeMB);
      throw new Error('FILE_TOO_LARGE');
    }
  }
  if (isVideo) {
    if (fileType !== 'video') {
      debugLog(DEBUG_CONTEXT, 'Invalid file type:', contentType);
      throw new Error('INVALID_FILE_TYPE');
    }
    if (!FILE_LIMITS.VIDEO.ALLOWED_TYPES.includes(contentType as any)) {
      debugLog(DEBUG_CONTEXT, 'Invalid file content type:', contentType);
      throw new Error('INVALID_FILE_EXTENSION');
    }
    if (fileSizeMB > FILE_LIMITS.VIDEO.MAX_SIZE_MB) {
      debugLog(DEBUG_CONTEXT, 'File size exceeds limit:', fileSizeMB);
      throw new Error('FILE_TOO_LARGE');
    }
  }

  // Count existing files
  const [files] = await admin.storage()
  .bucket()
  .getFiles({ prefix: `events/${eventId}/` });
        
  const actualFolders = files.filter(file => 
    file.name.startsWith(`events/${eventId}/`) && 
    file.name !== `events/${eventId}/`
  ).reduce((folders, file) => {
    const folderPath = file.name.split('/').slice(0, 3).join('/');
    folders.add(folderPath);
    return folders;
  }, new Set()).size;
  
  // Check if we've exceeded the maximum allowed files
  if (actualFolders > FILE_LIMITS.MAX_FILES) {
    debugLog(DEBUG_CONTEXT, 'File limit exceeded:', actualFolders);
    throw new Error('FILES_LIMIT_EXCEEDED');
  }
  
  // Check files in the current folder
  const folderPrefix = `events/${eventId}/${index}/`;
  const filesInFolder = files.filter(file => 
    file.name.startsWith(folderPrefix) && 
    file.name !== folderPrefix
  );
  
  // Validate based on file type
  if (fileType === 'image') {
    // Image folders should only contain a single image file
    // Need to exclude the current file being processed, which might not be in filesInFolder yet
    const otherFilesInFolder = filesInFolder.filter(file => file.name !== filePath);
    
    if (otherFilesInFolder.length > 0) {
      debugLog(DEBUG_CONTEXT, 'Folder already contains other files, cannot add image:', otherFilesInFolder.map(f => f.name));
      throw new Error('FOLDER_ALREADY_HAS_FILES');
    }
  } else if (fileType === 'cover') {
    // Cover folders can only have a cover + video, or just the cover
    const otherFilesInFolder = filesInFolder.filter(file => file.name !== filePath);
    
    // There should only be at most one other file, and it must be a video
    if (otherFilesInFolder.length > 1) {
      debugLog(DEBUG_CONTEXT, 'Too many files in folder with cover:', otherFilesInFolder.map(f => f.name));
      throw new Error('TOO_MANY_FILES_IN_FOLDER');
    }
    
    if (otherFilesInFolder.length === 1) {
      // The one other file must be a video
      const otherFile = otherFilesInFolder[0];
      if (!otherFile.name.includes('/video.')) {
        debugLog(DEBUG_CONTEXT, 'Non-video file found with cover:', otherFile.name);
        throw new Error('INVALID_FILE_WITH_COVER');
      }
    }
  } else if (fileType === 'video') {
    // Video folders should only contain a video and optionally a cover
    const otherFilesInFolder = filesInFolder.filter(file => file.name !== filePath);
    
    // There should only be at most one other file, and it must be a cover
    if (otherFilesInFolder.length > 1) {
      debugLog(DEBUG_CONTEXT, 'Too many files in folder with video:', otherFilesInFolder.map(f => f.name));
      throw new Error('TOO_MANY_FILES_IN_FOLDER');
    }
    
    if (otherFilesInFolder.length === 1) {
      // The one other file must be a cover
      const otherFile = otherFilesInFolder[0];
      if (!otherFile.name.includes('/cover.')) {
        debugLog(DEBUG_CONTEXT, 'Non-cover file found with video:', otherFile.name);
        throw new Error('INVALID_FILE_WITH_VIDEO');
      }
    }
  } else if (!isVideo && !isImage) {
    debugLog(DEBUG_CONTEXT, 'Invalid file type:', contentType);
    throw new Error('INVALID_FILE_TYPE');
  }

  // Get the event document
  const eventRef = admin.firestore().collection('events').doc(eventId);
  const eventDoc = await eventRef.get();
  
  if (!eventDoc.exists) {
    debugLog(DEBUG_CONTEXT, `Event ${eventId} not found`);
    throw new Error('EVENT_NOT_FOUND');
  }

  const eventData = eventDoc.data();
  if (!eventData) {
    debugLog(DEBUG_CONTEXT, `Event ${eventId} has no data`);
    throw new Error('EVENT_NO_DATA');
  }

  // Initialize media array if it doesn't exist
  if (!eventData.media) {
    eventData.media = { media: [] };
  } else if (!eventData.media.media) {
    eventData.media.media = [];
  }

  // Check if this is a video cover or a standalone file
  const isCover = fileType === 'cover';

  const otherFilesInFolder = filesInFolder.filter(file => file.name !== filePath);
  
  if (isVideo) {    
    if (otherFilesInFolder.length === 1 && otherFilesInFolder[0].name.includes('/cover.')) {
      // This is a video with a cover
      const coverFilePath = otherFilesInFolder[0].name;
      // Add video with cover to the media array
      eventData.media.media[index] = {
        url: filePath,
        filePath: null,
        type: 'video',
        cover: {
          url: coverFilePath,
          filePath: null,
          type: 'image'
        }
      };
      
      debugLog(DEBUG_CONTEXT, 'Added video with cover to event media');
    } else if (otherFilesInFolder.length === 0) {
      // This is a standalone video
      eventData.media.media[index] = {
        url: filePath,
        filePath: null,
        type: 'video',
        cover: null
      };
    }
  } else if (isImage && !isCover) {
    eventData.media.media[index] = {
      url: filePath,
      filePath: null,
      type: 'image',
    };
  } else if (isCover) {
    if (otherFilesInFolder.length === 1 && otherFilesInFolder[0].name.includes('/video.')) {
      // This is a cover with a video
      const videoFilePath = otherFilesInFolder[0].name;
      eventData.media.media[index] = {
        url: videoFilePath,
        filePath: null,
        type: 'video',
        cover: {
          url: filePath,
          filePath: null,
          type: 'image'
        }
      };
    } else {
      // This is a standalone cover
      eventData.media.media[index] = {
        url: null,
        filePath: null,
        type: 'video',
        cover: {
          url: filePath,
          filePath: null,
          type: 'image'
        }
      };
    }
  }

  // Update the event document
  await eventRef.update({
    media: eventData.media,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  debugLog(DEBUG_CONTEXT, `Successfully updated event ${eventId} with new media: ${JSON.stringify(eventData.media)}`);
}; 