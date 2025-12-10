export class AgentSdkError extends Error {
    constructor(msg, code, cause) {
        super(msg);
        this.code = code;
        this.cause = cause;
    }
}
