import { Request, Response, NextFunction } from "express";
import { AppError, ApiErrorResponse } from "./AppError";
import { ErrorCodes } from "./codes";

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get or create request ID from headers
 */
export function getRequestId(req: Request): string {
  return (req.headers["x-request-id"] as string) || generateRequestId();
}

/**
 * Middleware to attach request ID to all requests
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = getRequestId(req);
  (req as any).requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

/**
 * Global error handling middleware
 * 
 * Catches all errors and converts them to standardized API responses.
 * Must be registered AFTER all routes.
 * 
 * @example
 * app.use(errorHandler);
 */
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const requestId = (req as any).requestId || getRequestId(req);

  // Already an AppError - use directly
  if (err instanceof AppError) {
    const response = err.toResponse(requestId);
    
    // Log non-operational errors
    if (!err.isOperational) {
      console.error(`[${requestId}] Non-operational error:`, err);
    }
    
    return res.status(err.httpStatus).json(response);
  }

  // Handle SyntaxError from JSON parsing
  if (err instanceof SyntaxError && "body" in err) {
    const appError = new AppError(
      ErrorCodes.VALIDATION_INVALID_FORMAT,
      { parseError: err.message },
      "Invalid JSON in request body"
    );
    return res.status(400).json(appError.toResponse(requestId));
  }

  // Handle TypeError (often from accessing properties on undefined)
  if (err instanceof TypeError) {
    console.error(`[${requestId}] TypeError:`, err);
    const appError = new AppError(
      ErrorCodes.INTERNAL_ERROR,
      { type: "TypeError", message: err.message }
    );
    return res.status(500).json(appError.toResponse(requestId));
  }

  // Wrap unknown errors
  console.error(`[${requestId}] Unhandled error:`, err);
  const appError = AppError.from(err);
  return res.status(appError.httpStatus).json(appError.toResponse(requestId));
}

/**
 * Async route handler wrapper
 * 
 * Catches async errors and forwards them to the error handler.
 * 
 * @example
 * router.get("/agents/:id", asyncHandler(async (req, res) => {
 *   const agent = await getAgent(req.params.id);
 *   if (!agent) throw AppError.agentNotFound(req.params.id);
 *   res.json(agent);
 * }));
 */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: T, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Not found handler for unmatched routes
 */
export function notFoundHandler(req: Request, res: Response) {
  const requestId = (req as any).requestId || getRequestId(req);
  const error = new AppError(
    ErrorCodes.INTERNAL_ERROR,
    { method: req.method, path: req.path },
    `Route not found: ${req.method} ${req.path}`
  );
  res.status(404).json(error.toResponse(requestId));
}

/**
 * Helper to send standardized success responses
 */
export function sendSuccess<T>(res: Response, data: T, status = 200) {
  res.status(status).json({
    success: true,
    data,
  });
}

/**
 * Helper to send standardized error responses manually
 * (when not using throw)
 */
export function sendError(
  res: Response,
  error: AppError,
  requestId?: string
) {
  res.status(error.httpStatus).json(error.toResponse(requestId));
}
