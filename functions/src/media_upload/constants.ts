export const FILE_LIMITS = {
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