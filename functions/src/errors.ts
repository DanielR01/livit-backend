// Define error codes as an enum for type safety
export enum ErrorCode {
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  USERNAME_TAKEN = 'username-taken',
  USER_EXISTS = 'user-exists',
  MISSING_PARAMS = 'missing-params',
  INVALID_USER_DATA = 'invalid-user-data',
  LOCATION_NOT_FOUND = 'location-not-found',
  PERMISSION_DENIED = 'permission-denied',
  FILE_SIZE_LIMIT = 'file-size-limit',
  FILES_LIMIT = 'files-limit',
  LOCATION_NAME_NOT_VALID = 'location-name-not-valid',
  LOCATION_DESCRIPTION_TOO_LONG = 'location-description-too-long',
  LOCATION_ALREADY_EXISTS = 'location-already-exists',
  USER_NOT_FOUND = 'user-not-found',
  USER_PRIVATE_DATA_NOT_FOUND = 'user-private-data-not-found',
  USER_NOT_COMPLETED = 'user-not-completed',
  USER_NOT_PROMOTER = 'user-not-promoter',
  LOCATION_ID_NOT_FOUND = 'location-id-not-found',
  USER_DOES_NOT_HAVE_PERMISSION = 'user-does-not-have-permission',
  LOCATION_FILES_NOT_MATCH = 'location-files-not-match'
}

// Base custom error class
export class BaseError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpCode: 'invalid-argument' | 'already-exists' | 'not-found' | 'permission-denied' | 'failed-precondition' = 'invalid-argument'
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

// Specific error classes
export class UsernameAlreadyTakenError extends BaseError {
  constructor() {
    super(
      ErrorCode.USERNAME_TAKEN,
      'Username already taken',
      'already-exists'
    );
  }
}

export class UserAlreadyExistsError extends BaseError {
  constructor() {
    super(
      ErrorCode.USER_EXISTS,
      'User already exists',
      'already-exists'
    );
  }
}

export class MissingParametersError extends BaseError {
  constructor(params?: string[]) {
    super(
      ErrorCode.MISSING_PARAMS,
      params ? `Missing parameters: ${params.join(', ')}` : 'Missing parameters'
    );
  }
}

export class NotValidUserDataError extends BaseError {
  constructor() {
    super(
      ErrorCode.INVALID_USER_DATA,
      'Invalid user data',
      'invalid-argument'
    );
  }
}

export class LocationNameNotValidError extends BaseError {
  constructor() {
    super(
      ErrorCode.LOCATION_NAME_NOT_VALID,
      'Location name not valid',
      'invalid-argument'
    );
  }
}

export class LocationFileSizeLimitError extends BaseError {
  constructor() {
    super(
      ErrorCode.FILE_SIZE_LIMIT,
      'File size exceeds limit',
      'invalid-argument'
    );
  }
}

export class LocationFilesLimitError extends BaseError {
  constructor() {
    super(
      ErrorCode.FILES_LIMIT,
      'Location exceeds files limit',
      'invalid-argument'
    );
  }
}

export class LocationNotFoundError extends BaseError {
  constructor() {
    super(
      ErrorCode.LOCATION_NOT_FOUND,
      'Location not found',
      'not-found'
    );
  }
}

export class LocationPermissionDeniedError extends BaseError {
  constructor() {
    super(
      ErrorCode.PERMISSION_DENIED,
      'User does not have permission to upload media to this location',
      'permission-denied'
    );
  }
}