/**
 * URL Validation Utilities
 * 
 * Prevents SSRF (Server-Side Request Forgery) attacks by validating
 * webhook URLs against blocked networks.
 */

import { URL } from "url";
import dns from "dns";
import { promisify } from "util";

const dnsLookup = promisify(dns.lookup);

// =============================================================================
// BLOCKED PATTERNS
// =============================================================================

// Private IPv4 ranges (RFC 1918)
const PRIVATE_IP_RANGES = [
  /^127\./, // Loopback
  /^10\./, // Class A private
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // Class B private
  /^192\.168\./, // Class C private
  /^0\./, // "This" network
  /^169\.254\./, // Link-local (APIPA)
  /^224\./, // Multicast
  /^240\./, // Reserved
];

// Blocked hostnames
const BLOCKED_HOSTNAMES = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "[::]",
  "metadata.google.internal", // GCP metadata
  "metadata", // Generic cloud metadata
];

// AWS metadata IP (169.254.169.254) - critical for cloud security
const AWS_METADATA_IP = "169.254.169.254";

// Blocked URL schemes
const ALLOWED_SCHEMES = ["https", "http"];

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Check if an IP address is in a blocked private range
 */
function isPrivateIP(ip: string): boolean {
  // Check AWS metadata endpoint specifically
  if (ip === AWS_METADATA_IP) {
    return true;
  }

  // Check against private ranges
  for (const pattern of PRIVATE_IP_RANGES) {
    if (pattern.test(ip)) {
      return true;
    }
  }

  // Check IPv6 loopback
  if (ip === "::1" || ip === "::") {
    return true;
  }

  return false;
}

/**
 * Check if hostname is in blocklist
 */
function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  
  // Direct blocklist match
  if (BLOCKED_HOSTNAMES.includes(lower)) {
    return true;
  }

  // Check for localhost variations
  if (lower.endsWith(".localhost") || lower.startsWith("localhost.")) {
    return true;
  }

  // Check for metadata endpoint patterns
  if (lower.includes("metadata") && lower.includes("internal")) {
    return true;
  }

  return false;
}

/**
 * Validate a URL is safe for server-side requests (webhook delivery)
 * 
 * This prevents SSRF attacks by blocking:
 * - Private/internal IP addresses
 * - Cloud metadata endpoints
 * - Localhost variations
 */
export async function validateWebhookUrl(urlString: string): Promise<{
  valid: boolean;
  error?: string;
  resolvedIp?: string;
}> {
  // Parse URL
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  // Check scheme
  if (!ALLOWED_SCHEMES.includes(url.protocol.replace(":", ""))) {
    return { 
      valid: false, 
      error: `Invalid URL scheme. Allowed: ${ALLOWED_SCHEMES.join(", ")}` 
    };
  }

  // Check for blocked hostnames
  const hostname = url.hostname.toLowerCase();
  if (isBlockedHostname(hostname)) {
    return { 
      valid: false, 
      error: "Blocked hostname: cannot use localhost or internal addresses" 
    };
  }

  // Check if hostname is an IP address directly
  const ipv4Match = hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/);
  if (ipv4Match && isPrivateIP(hostname)) {
    return { 
      valid: false, 
      error: "Blocked IP: cannot use private or internal IP addresses" 
    };
  }

  // Resolve hostname and check resolved IP
  try {
    const { address } = await dnsLookup(hostname);
    
    if (isPrivateIP(address)) {
      return { 
        valid: false, 
        error: `Blocked: hostname resolves to private IP (${address})` 
      };
    }

    return { valid: true, resolvedIp: address };
  } catch (dnsError) {
    // DNS resolution failed - could be temporary or invalid domain
    return { 
      valid: false, 
      error: "DNS resolution failed: cannot verify hostname" 
    };
  }
}

/**
 * Synchronous URL validation (basic checks only, no DNS)
 * Use this for quick rejection of obviously bad URLs
 */
export function validateWebhookUrlSync(urlString: string): {
  valid: boolean;
  error?: string;
} {
  // Parse URL
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  // Check scheme
  if (!ALLOWED_SCHEMES.includes(url.protocol.replace(":", ""))) {
    return { 
      valid: false, 
      error: `Invalid URL scheme. Allowed: ${ALLOWED_SCHEMES.join(", ")}` 
    };
  }

  // Check for blocked hostnames
  const hostname = url.hostname.toLowerCase();
  if (isBlockedHostname(hostname)) {
    return { 
      valid: false, 
      error: "Blocked hostname: cannot use localhost or internal addresses" 
    };
  }

  // Check if hostname is an IP address directly
  const ipv4Match = hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/);
  if (ipv4Match && isPrivateIP(hostname)) {
    return { 
      valid: false, 
      error: "Blocked IP: cannot use private or internal IP addresses" 
    };
  }

  // Port restrictions (optional security hardening)
  const port = url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80);
  if (port < 80 || (port > 443 && port < 1024)) {
    return { 
      valid: false, 
      error: "Blocked: suspicious port number" 
    };
  }

  return { valid: true };
}

export default {
  validateWebhookUrl,
  validateWebhookUrlSync,
  isPrivateIP,
  isBlockedHostname,
};
