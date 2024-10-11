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

export { UsernameAlreadyTakenError, UserAlreadyExistsError };