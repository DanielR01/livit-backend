class UsernameAlreadyTakenError extends Error {
  constructor() {
    super("Username already taken");
    this.name = "UsernameAlreadyTakenError";
    }
  }

class UserAlreadyExistsError extends Error {
  constructor() {
    super("User already exists");
    this.name = "UserAlreadyExistsError";
  }
}

class MissingParametersError extends Error {
  constructor() {
    super("Missing parameters");
    this.name = "MissingParametersError";
  }
}

class NotValidUserDataError extends Error {
  constructor() {
    super("Not valid user data");
    this.name = "NotValidUserDataError";
  }
}

export { UsernameAlreadyTakenError, UserAlreadyExistsError, MissingParametersError, NotValidUserDataError };