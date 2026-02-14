/**
 * Standardized Error Handling for AgentPay
 * 
 * @example
 * // In routes
 * import { AppError, ErrorCodes, asyncHandler, sendSuccess } from "../errors";
 * 
 * router.get("/agent/:id", asyncHandler(async (req, res) => {
 *   const agent = await getAgent(req.params.id);
 *   if (!agent) throw AppError.agentNotFound(req.params.id);
 *   sendSuccess(res, agent);
 * }));
 * 
 * // Manual error throwing
 * throw new AppError("PAYMENT_INSUFFICIENT_FUNDS", {
 *   required: 10000,
 *   available: 5000,
 * });
 * 
 * // In app.ts
 * import { errorHandler, requestIdMiddleware, notFoundHandler } from "./errors";
 * 
 * app.use(requestIdMiddleware);
 * // ... routes ...
 * app.use(notFoundHandler);
 * app.use(errorHandler);
 */

export { ErrorCodes, ErrorHttpStatus, ErrorMessages } from "./codes";
export type { ErrorCode } from "./codes";

export { AppError, ApiErrorResponse } from "./AppError";

export {
  errorHandler,
  asyncHandler,
  requestIdMiddleware,
  notFoundHandler,
  sendSuccess,
  sendError,
  getRequestId,
} from "./middleware";
