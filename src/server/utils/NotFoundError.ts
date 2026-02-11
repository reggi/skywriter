class StatusError extends Error {
  status: number

  constructor(messageOrError: string | Error, status: number) {
    super(typeof messageOrError === 'string' ? messageOrError : messageOrError.message)
    if (typeof messageOrError !== 'string' && messageOrError.stack) {
      this.stack = messageOrError.stack
    }
    this.status = status
  }
}

export class NotFoundError extends StatusError {
  constructor(messageOrError: string | Error) {
    super(messageOrError, 404)
  }
}
