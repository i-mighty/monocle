import { query } from "../db/client.js";

type IdentityInput = {
  firstName: string;
  lastName: string;
  dob: string;
  idNumber: string;
};

export async function verifyIdentity(input: IdentityInput) {
  // Placeholder verification: always succeed and echo back.
  const details = {
    firstName: input.firstName,
    lastName: input.lastName,
    dob: input.dob,
    idNumber: input.idNumber,
    verifiedAt: new Date().toISOString()
  };
  return { status: "verified", details };
}

