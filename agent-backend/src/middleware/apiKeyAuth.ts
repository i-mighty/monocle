import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { AppError, ErrorCodes } from "../errors";

function safeEqual(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

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

  if (!safeEqual(provided, expected)) {
    const error = new AppError(
      ErrorCodes.AUTH_INVALID_API_KEY,
      { header: "x-api-key", provided: provided ? "[redacted]" : undefined }
    );
    return res.status(error.httpStatus).json(error.toResponse((req as any).requestId));
  }

  return next();
}

