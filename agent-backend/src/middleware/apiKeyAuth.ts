import { Request, Response, NextFunction } from "express";
import { AppError, ErrorCodes } from "../errors";

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const provided = req.header("x-api-key");
  const expected = process.env.AGENTPAY_API_KEY;
  
  if (!expected) {
    const error = new AppError(
      ErrorCodes.AUTH_API_KEY_NOT_CONFIGURED,
      { header: "x-api-key" }
    );
    return res.status(error.httpStatus).json(error.toResponse((req as any).requestId));
  }
  
  if (provided !== expected) {
    const error = new AppError(
      ErrorCodes.AUTH_INVALID_API_KEY,
      { header: "x-api-key", provided: provided ? "[redacted]" : undefined }
    );
    return res.status(error.httpStatus).json(error.toResponse((req as any).requestId));
  }
  
  return next();
}

