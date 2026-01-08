type IdentityInput = {
    firstName: string;
    lastName: string;
    dob: string;
    idNumber: string;
};
export declare function verifyIdentity(input: IdentityInput): Promise<{
    status: string;
    details: {
        firstName: string;
        lastName: string;
        dob: string;
        idNumber: string;
        verifiedAt: string;
    };
}>;
export {};
//# sourceMappingURL=identityService.d.ts.map